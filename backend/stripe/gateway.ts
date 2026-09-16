/**
 * The only surface through which this codebase is allowed to talk to Stripe.
 *
 * Business logic (the tRPC payment router, the webhook handler) depends on
 * `PaymentGateway` and nothing else. Two implementations exist:
 *
 *  - `StripeGateway`   — real calls via the `stripe` npm package. Used only
 *                        when `STRIPE_SECRET_KEY` is set and the resolved
 *                        mode is `test` or `live`.
 *  - `FakeGateway`     — deterministic, in-memory, no network. Used in
 *                        `simulated` mode, which is what this repo runs in
 *                        today because there is no Stripe account yet.
 *
 * **Charge model: direct charges** (founder decision, 2026-09-15 — replaces
 * the earlier destination-charge shape). Every PaymentIntent is created *on
 * the seller's connected Express account* with `application_fee_amount` for
 * the platform. Consequences, all deliberate:
 *   - the seller is the merchant of record;
 *   - the seller pays Stripe's processing fee out of the charge;
 *   - a dispute debits the *seller's* balance, not the platform's;
 *   - refunds and any object retrieval must be issued on the connected
 *     account — a direct charge does not exist on the platform account;
 *   - webhooks for these charges arrive with `event.account` set to the
 *     connected account.
 *
 * Nothing in this file has ever been executed against Stripe's API. The
 * real implementation is written to Stripe's documented API shapes; it is
 * unverified until the founder adds a key. See docs/AUCTIONS.md §3.
 */

/** Resolved payments mode. Derived on the server, never sent by a client. */
export type PaymentsMode = 'simulated' | 'test' | 'live';

export interface GatewayAccount {
  id: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /**
   * The payout delay this account was created with, as this app asked for it.
   * `0` means "Stripe's minimum for the seller's country" — see
   * `env.payoutDelayDays`. Informational only; Stripe is the authority.
   */
  payoutDelayDaysRequested?: number;
}

export interface GatewayAccountLink {
  url: string;
  expiresAt: Date;
}

export interface GatewayPaymentIntent {
  id: string;
  /**
   * Handed to the client SDK in test/live; meaningless in simulated mode.
   * For a direct charge the client SDK must also be initialised with the
   * connected account id (`stripeAccount`), or confirmation will fail.
   */
  clientSecret: string | null;
  amountCents: number;
  applicationFeeCents: number;
  /** The connected account the charge lives ON. Not a transfer destination. */
  connectedAccountId: string;
  status: string;
}

export interface GatewayRefund {
  id: string;
  paymentIntentId: string;
  amountCents: number;
  status: string;
  /** The connected account the refund was issued on. */
  connectedAccountId: string;
}

/** The subset of a Stripe event this app acts on. */
export interface GatewayEvent {
  id: string;
  type: string;
  /**
   * Set by Stripe when the event originated on a **connected account**. Under
   * direct charges every payment event we care about carries this; an event
   * without it did not come from one of our sellers' accounts.
   */
  account?: string;
  data: {
    object: {
      id?: string;
      payment_intent?: string;
      charges?: { data?: { id?: string }[] };
      charges_enabled?: boolean;
      payouts_enabled?: boolean;
      details_submitted?: boolean;
      [key: string]: unknown;
    };
  };
}

export interface CreatePaymentIntentArgs {
  amountCents: number;
  applicationFeeCents: number;
  /** The seller's connected account — the charge is created ON this account. */
  connectedAccountId: string;
  /** Stripe's own idempotency key — one per reservation. */
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface RefundArgs {
  paymentIntentId: string;
  /** Required: a direct charge can only be refunded on its own account. */
  connectedAccountId: string;
  reason?: string;
}

export interface PaymentGateway {
  readonly kind: 'stripe' | 'fake';
  createExpressAccount(args: {
    userId: string;
    email: string;
    /** `settings.payouts.schedule.delay_days`; 0 ⇒ Stripe's `minimum`. */
    payoutDelayDays: number;
  }): Promise<GatewayAccount>;
  createAccountLink(args: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<GatewayAccountLink>;
  retrieveAccount(accountId: string): Promise<GatewayAccount>;
  createPaymentIntent(args: CreatePaymentIntentArgs): Promise<GatewayPaymentIntent>;
  /** Retrieval of a direct charge's intent — issued on the connected account. */
  retrievePaymentIntent(args: {
    paymentIntentId: string;
    connectedAccountId: string;
  }): Promise<GatewayPaymentIntent>;
  refund(args: RefundArgs): Promise<GatewayRefund>;
  /**
   * Verifies the Stripe signature over the RAW request body and returns the
   * parsed event. Throws when the signature does not verify.
   */
  constructWebhookEvent(args: {
    rawBody: string;
    signature: string | null;
    webhookSecret: string | undefined;
  }): GatewayEvent;
}

/** Thrown for anything the caller should see as a human message. */
export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}
