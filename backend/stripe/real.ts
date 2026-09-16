/**
 * The real Stripe implementation of `PaymentGateway` — **direct charges**.
 *
 * ⚠️ UNVERIFIED. There is no Stripe account and no API key on this project,
 * so not one line of this file has ever been executed against Stripe. It is
 * written to Stripe's documented API shapes (`stripe` npm package v22.6.2,
 * Connect Express + direct charges). Expect to debug it the first time a real
 * test key is present — that is normal, and it is the founder's step 1.
 *
 * Direct charges mean the `Stripe-Account` header (`{ stripeAccount }` in this
 * SDK) is on every call that touches a charge: create, retrieve, refund. The
 * platform never becomes the merchant of record and never sees these objects
 * on its own account.
 *
 * Everything the app actually demonstrates today runs through `FakeGateway`.
 */
import Stripe from 'stripe';

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

function toAccount(account: Stripe.Account, payoutDelayDaysRequested?: number): GatewayAccount {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    payoutDelayDaysRequested,
  };
}

export class StripeGateway implements PaymentGateway {
  readonly kind = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      // Identifies this integration in Stripe's dashboard logs.
      appInfo: { name: 'campus-swap', version: '1.0.0' },
    });
  }

  /**
   * Express account for a seller. `settings.payouts.schedule.delay_days`
   * decides how long Stripe holds the seller's funds before paying them out.
   *
   * `PAYOUT_DELAY_DAYS=0` is sent as Stripe's `'minimum'` rather than the
   * literal 0: Stripe enforces a country floor (2 days in the US) and rejects
   * a lower number, so 0 in our config means "as fast as Stripe permits",
   * which is what the founder's "immediate payout" decision actually buys.
   */
  async createExpressAccount({
    email,
    payoutDelayDays,
  }: {
    userId: string;
    email: string;
    payoutDelayDays: number;
  }): Promise<GatewayAccount> {
    const account = await this.stripe.accounts.create({
      type: 'express',
      email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
      business_type: 'individual',
      settings: {
        payouts: {
          schedule: {
            interval: 'daily',
            delay_days: payoutDelayDays === 0 ? 'minimum' : payoutDelayDays,
          },
        },
      },
    });
    return toAccount(account, payoutDelayDays);
  }

  async createAccountLink({
    accountId,
    refreshUrl,
    returnUrl,
  }: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<GatewayAccountLink> {
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async retrieveAccount(accountId: string): Promise<GatewayAccount> {
    // Account objects DO live on the platform (that is who created them), so
    // this one call is correctly made without a Stripe-Account header.
    return toAccount(await this.stripe.accounts.retrieve(accountId));
  }

  /**
   * A **direct charge**: the PaymentIntent is created ON the seller's
   * connected account (`{ stripeAccount }` → the `Stripe-Account` header).
   *
   * The seller is the merchant of record. Stripe's processing fee comes out of
   * the seller's side, `application_fee_amount` is swept to the platform, and
   * a dispute debits the seller's balance first. There is deliberately no
   * `transfer_data` and no `on_behalf_of` — those belong to the destination-
   * charge shape this replaced.
   */
  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<GatewayPaymentIntent> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: args.amountCents,
        currency: 'usd',
        application_fee_amount: args.applicationFeeCents,
        automatic_payment_methods: { enabled: true },
        metadata: args.metadata,
      },
      {
        idempotencyKey: args.idempotencyKey,
        stripeAccount: args.connectedAccountId,
      },
    );
    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      amountCents: intent.amount,
      applicationFeeCents: intent.application_fee_amount ?? args.applicationFeeCents,
      connectedAccountId: args.connectedAccountId,
      status: intent.status,
    };
  }

  /** Retrieval, also on the connected account — the object is not on ours. */
  async retrievePaymentIntent({
    paymentIntentId,
    connectedAccountId,
  }: {
    paymentIntentId: string;
    connectedAccountId: string;
  }): Promise<GatewayPaymentIntent> {
    const intent = await this.stripe.paymentIntents.retrieve(
      paymentIntentId,
      undefined,
      { stripeAccount: connectedAccountId },
    );
    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      amountCents: intent.amount,
      applicationFeeCents: intent.application_fee_amount ?? 0,
      connectedAccountId,
      status: intent.status,
    };
  }

  /**
   * Full refund, issued **on the connected account**. The money comes out of
   * the seller's balance, because that is where it landed;
   * `refund_application_fee` hands the platform's cut back too, so the
   * platform does not keep a fee on a sale that was undone.
   *
   * There is no `reverse_transfer` here: that parameter belongs to
   * destination charges, and there is no transfer to reverse.
   *
   * If the seller's balance is short, Stripe takes them negative. That can
   * fail in the real world, and the app must surface it rather than pretend.
   */
  async refund({ paymentIntentId, connectedAccountId, reason }: RefundArgs): Promise<GatewayRefund> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        refund_application_fee: true,
        metadata: reason ? { reason } : undefined,
      },
      { stripeAccount: connectedAccountId },
    );
    return {
      id: refund.id,
      paymentIntentId,
      amountCents: refund.amount,
      status: refund.status ?? 'unknown',
      connectedAccountId,
    };
  }

  /**
   * Signature verification is unchanged and stays mandatory. Connected-account
   * events are delivered to the SAME platform endpoint with the same signing
   * secret; what marks them is `event.account`, which is carried through to
   * `GatewayEvent` for the handler to match on.
   */
  constructWebhookEvent({
    rawBody,
    signature,
    webhookSecret,
  }: {
    rawBody: string;
    signature: string | null;
    webhookSecret: string | undefined;
  }): GatewayEvent {
    if (!webhookSecret) {
      throw new GatewayError('STRIPE_WEBHOOK_SECRET is not set, so webhooks cannot be verified.');
    }
    if (!signature) throw new GatewayError('That webhook had no Stripe signature.');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      throw new GatewayError('That webhook signature is not valid.');
    }
    return event as unknown as GatewayEvent;
  }
}
