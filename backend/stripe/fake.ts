/**
 * Deterministic, in-memory stand-in for Stripe. No network, no keys, no money.
 *
 * This is what runs in `simulated` mode — which is the mode this repo is in,
 * because there is no Stripe account yet. Ids are stable and obviously fake
 * (`acct_fake_1`, `pi_fake_1`) so nothing in a log or a screenshot can be
 * mistaken for a real Stripe object.
 *
 * It implements exactly the `PaymentGateway` interface, so the payment router
 * and the webhook handler cannot tell the difference — which is the point:
 * swapping in the real gateway is a key, not a rewrite.
 *
 * It models **direct-charge** semantics on purpose, so the simulated path
 * exercises the same rules the real one will:
 *  - an intent belongs to exactly one connected account;
 *  - refunding or retrieving it from the wrong account is an error, the way a
 *    platform-account refund of a direct charge is an error at Stripe;
 *  - simulated webhook events carry `account`, as connected-account events do.
 */
import {
  GatewayError,
  type CreatePaymentIntentArgs,
  type GatewayAccount,
  type GatewayAccountLink,
  type GatewayEvent,
  type GatewayPaymentIntent,
  type GatewayRefund,
  type PaymentGateway,
  type RefundArgs,
} from './gateway';

/** Signature the local-only simulate hook sends; never accepted by the real gateway. */
export const FAKE_WEBHOOK_SIGNATURE = 'fake_signature_simulated_mode';

/** What the fake recorded about the last create call — the check script reads this. */
export interface RecordedIntentCall {
  connectedAccountId: string;
  amountCents: number;
  applicationFeeCents: number;
  /** Always false here: direct charges must not carry a transfer destination. */
  usedTransferData: false;
  /** Always false here: no `on_behalf_of` survives from the destination shape. */
  usedOnBehalfOf: false;
}

export class FakeGateway implements PaymentGateway {
  readonly kind = 'fake' as const;

  private accountSeq = 0;
  private intentSeq = 0;
  private refundSeq = 0;

  private readonly accounts = new Map<string, GatewayAccount>();
  private readonly accountByUser = new Map<string, string>();
  private readonly intents = new Map<string, GatewayPaymentIntent>();
  /** Stripe's idempotency-key semantics: same key ⇒ same object, no new charge. */
  private readonly intentByIdempotencyKey = new Map<string, string>();
  private readonly intentCalls: RecordedIntentCall[] = [];
  private readonly refundCalls: { paymentIntentId: string; connectedAccountId: string }[] = [];

  async createExpressAccount({
    userId,
    payoutDelayDays,
  }: {
    userId: string;
    email: string;
    payoutDelayDays: number;
  }): Promise<GatewayAccount> {
    const existingId = this.accountByUser.get(userId);
    if (existingId) return this.accounts.get(existingId)!;

    const id = `acct_fake_${++this.accountSeq}`;
    // A brand-new Express account has submitted nothing yet — same as Stripe.
    const account: GatewayAccount = {
      id,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      payoutDelayDaysRequested: payoutDelayDays,
    };
    this.accounts.set(id, account);
    this.accountByUser.set(userId, id);
    return account;
  }

  async createAccountLink({
    accountId,
    returnUrl,
  }: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<GatewayAccountLink> {
    if (!this.accounts.has(accountId)) {
      throw new GatewayError('That payout account no longer exists. Start onboarding again.');
    }
    return {
      // Deliberately a local URL, not a connect.stripe.com one: opening it must
      // never look like a real onboarding flow.
      url: `${returnUrl}?simulated_onboarding=${encodeURIComponent(accountId)}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };
  }

  async retrieveAccount(accountId: string): Promise<GatewayAccount> {
    const account = this.accounts.get(accountId);
    if (!account) throw new GatewayError('That payout account no longer exists.');
    return account;
  }

  /** Direct charge: the intent is created ON `connectedAccountId`. */
  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<GatewayPaymentIntent> {
    const existingId = this.intentByIdempotencyKey.get(args.idempotencyKey);
    if (existingId) return this.intents.get(existingId)!;

    if (!this.accounts.has(args.connectedAccountId)) {
      throw new GatewayError('That seller has no payout account, so nothing can be charged.');
    }
    if (args.amountCents <= 0) throw new GatewayError('That amount is not chargeable.');
    if (args.applicationFeeCents >= args.amountCents) {
      throw new GatewayError('The platform fee cannot be the whole payment.');
    }

    const id = `pi_fake_${++this.intentSeq}`;
    const intent: GatewayPaymentIntent = {
      id,
      clientSecret: `${id}_secret_simulated`,
      amountCents: args.amountCents,
      applicationFeeCents: args.applicationFeeCents,
      connectedAccountId: args.connectedAccountId,
      status: 'requires_payment_method',
    };
    this.intents.set(id, intent);
    this.intentByIdempotencyKey.set(args.idempotencyKey, id);
    this.intentCalls.push({
      connectedAccountId: args.connectedAccountId,
      amountCents: args.amountCents,
      applicationFeeCents: args.applicationFeeCents,
      usedTransferData: false,
      usedOnBehalfOf: false,
    });
    return intent;
  }

  async retrievePaymentIntent({
    paymentIntentId,
    connectedAccountId,
  }: {
    paymentIntentId: string;
    connectedAccountId: string;
  }): Promise<GatewayPaymentIntent> {
    const intent = this.intents.get(paymentIntentId);
    // Modelled on Stripe: a direct charge does not exist on any other account,
    // so asking the wrong one returns "no such payment intent", not the object.
    if (!intent || intent.connectedAccountId !== connectedAccountId) {
      throw new GatewayError('That payment could not be found on that account.');
    }
    return intent;
  }

  async refund({ paymentIntentId, connectedAccountId }: RefundArgs): Promise<GatewayRefund> {
    const intent = this.intents.get(paymentIntentId);
    if (!intent) throw new GatewayError('That payment could not be found.');
    if (intent.connectedAccountId !== connectedAccountId) {
      // The whole point of the direct-charge switch: the platform account
      // cannot refund this charge, only the account that took it can.
      throw new GatewayError('That payment can only be refunded on the seller’s own account.');
    }
    this.refundCalls.push({ paymentIntentId, connectedAccountId });
    return {
      id: `re_fake_${++this.refundSeq}`,
      paymentIntentId,
      amountCents: intent.amountCents,
      status: 'succeeded',
      connectedAccountId,
    };
  }

  /**
   * In simulated mode there is no Stripe signing secret, so there is nothing
   * real to verify. We still go through the same raw-body → verify → parse
   * path so the flow being demonstrated is the flow that will run for real;
   * the only accepted signature is a fixed local constant that the real
   * gateway would reject outright.
   */
  constructWebhookEvent({
    rawBody,
    signature,
  }: {
    rawBody: string;
    signature: string | null;
    webhookSecret: string | undefined;
  }): GatewayEvent {
    if (signature !== FAKE_WEBHOOK_SIGNATURE) {
      throw new GatewayError('That webhook signature is not valid.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new GatewayError('That webhook body was not valid JSON.');
    }
    const event = parsed as GatewayEvent;
    if (!event?.id || !event?.type || !event?.data?.object) {
      throw new GatewayError('That webhook body was not a Stripe event.');
    }
    return event;
  }

  /* --------------------------------------------------- test-only helpers */

  /** Used by the local simulate hook to flip a fake account's flags. */
  markAccountOnboarded(accountId: string): GatewayAccount {
    const account = this.accounts.get(accountId);
    if (!account) throw new GatewayError('That payout account no longer exists.');
    const updated: GatewayAccount = {
      ...account,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    };
    this.accounts.set(accountId, updated);
    return updated;
  }

  /** Used by the local simulate hook to mint the charge id a real webhook would carry. */
  chargeIdFor(paymentIntentId: string): string {
    return `ch_fake_${paymentIntentId.replace(/^pi_fake_/, '')}`;
  }

  /** Which connected account an intent lives on — the `account` a real event would carry. */
  accountForIntent(paymentIntentId: string): string | null {
    return this.intents.get(paymentIntentId)?.connectedAccountId ?? null;
  }

  /** What was actually asked of the gateway — asserted by scripts/payments-check.ts. */
  lastIntentCall(): RecordedIntentCall | null {
    return this.intentCalls.at(-1) ?? null;
  }

  lastRefundCall(): { paymentIntentId: string; connectedAccountId: string } | null {
    return this.refundCalls.at(-1) ?? null;
  }
}
