/**
 * Webhook plumbing: verify the raw body's signature, then apply the event.
 * Kept out of `backend/hono.ts` so the route there stays three lines.
 *
 * Also builds the *local-only* simulated events. That hook exists for one
 * reason: with no Stripe account, a simulated payment would otherwise have no
 * way to ever reach `paid`, and the flow could not be demonstrated at all. It
 * is guarded by `DEV_LOGIN=1` **and** `mode === 'simulated'`, it is named so
 * nobody mistakes it for a Stripe callback, and it drives exactly the same
 * handler a real webhook would.
 */
import type { Db } from '../db/client';
import { env } from '../env';
import { fakeGatewayOrNull, gateway, paymentsMode } from './client';
import { FAKE_WEBHOOK_SIGNATURE } from './fake';
import { GatewayError, type GatewayEvent } from './gateway';
import { handleGatewayEvent, type HandledEventOutcome } from './service';

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/** `POST /api/stripe/webhook`. Signature is verified before anything is read. */
export async function processWebhook(
  db: Db,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  let event: GatewayEvent;
  try {
    event = gateway().constructWebhookEvent({
      rawBody,
      signature,
      webhookSecret: env.stripeWebhookSecret,
    });
  } catch (err) {
    // 400 tells Stripe the delivery failed so it retries; never 200 a bad
    // signature, and never leak why beyond the message.
    const message = err instanceof GatewayError ? err.message : 'That webhook could not be read.';
    return { status: 400, body: { error: message } };
  }

  let outcome: HandledEventOutcome;
  try {
    outcome = await handleGatewayEvent(db, event);
  } catch (err) {
    console.error('[stripe webhook] handler failed', err);
    // 500 so Stripe retries — the event id is already stored, and the
    // idempotency check makes the retry safe.
    return { status: 500, body: { error: 'That event could not be applied.' } };
  }

  return {
    status: 200,
    body: { received: true, id: event.id, type: event.type, ...outcome },
  };
}

export type SimulatedEventKind =
  | 'payment_intent.succeeded'
  | 'payment_intent.payment_failed'
  | 'charge.refunded'
  | 'account.updated';

export interface SimulatedEventInput {
  type: SimulatedEventKind;
  /** For the payment_intent.* and charge.refunded events. */
  paymentIntentId?: string;
  /** For account.updated, and to override the connected account on any event. */
  accountId?: string;
  /** Override so a test can deliver the SAME event id twice. */
  eventId?: string;
}

/** True only when the local test hook may be used at all. */
export function simulateHookAllowed(): boolean {
  return env.devLogin && paymentsMode().mode === 'simulated';
}

/**
 * Builds the JSON body a real Stripe webhook would deliver, then runs it
 * through `processWebhook` — same raw body, same verification call, same
 * handler. Nothing here writes to the database directly.
 */
export async function processSimulatedEvent(
  db: Db,
  input: SimulatedEventInput,
): Promise<WebhookResult> {
  if (!simulateHookAllowed()) {
    return {
      status: 403,
      body: {
        error:
          'The simulated payment hook is only available with DEV_LOGIN=1 and PAYMENTS_MODE=simulated.',
      },
    };
  }

  const fake = fakeGatewayOrNull();
  if (!fake) {
    return { status: 409, body: { error: 'The simulated gateway is not in use.' } };
  }

  const id = input.eventId ?? `evt_fake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let object: Record<string, unknown>;
  /**
   * Under direct charges every payment event originates on the seller's
   * connected account, and Stripe stamps `event.account` with it. The fake
   * knows which account each intent lives on, so the simulated event carries
   * the same field a real one would — otherwise the handler's account matching
   * would never be exercised here.
   */
  let account: string | undefined;

  switch (input.type) {
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed': {
      if (!input.paymentIntentId) {
        return { status: 400, body: { error: 'paymentIntentId is required for that event.' } };
      }
      account = input.accountId ?? fake.accountForIntent(input.paymentIntentId) ?? undefined;
      object = {
        id: input.paymentIntentId,
        charges: { data: [{ id: fake.chargeIdFor(input.paymentIntentId) }] },
      };
      break;
    }
    case 'charge.refunded': {
      if (!input.paymentIntentId) {
        return { status: 400, body: { error: 'paymentIntentId is required for that event.' } };
      }
      account = input.accountId ?? fake.accountForIntent(input.paymentIntentId) ?? undefined;
      object = {
        id: fake.chargeIdFor(input.paymentIntentId),
        payment_intent: input.paymentIntentId,
        refunded: true,
      };
      break;
    }
    case 'account.updated': {
      if (!input.accountId) {
        return { status: 400, body: { error: 'accountId is required for that event.' } };
      }
      let updatedAccount;
      try {
        updatedAccount = fake.markAccountOnboarded(input.accountId);
      } catch (err) {
        return {
          status: 400,
          body: { error: err instanceof GatewayError ? err.message : 'Unknown account.' },
        };
      }
      account = updatedAccount.id;
      object = {
        id: updatedAccount.id,
        charges_enabled: updatedAccount.chargesEnabled,
        payouts_enabled: updatedAccount.payoutsEnabled,
        details_submitted: updatedAccount.detailsSubmitted,
      };
      break;
    }
    default:
      return { status: 400, body: { error: 'That event type is not supported here.' } };
  }

  const rawBody = JSON.stringify({
    id,
    type: input.type,
    ...(account ? { account } : {}),
    data: { object },
  });
  return processWebhook(db, rawBody, FAKE_WEBHOOK_SIGNATURE);
}
