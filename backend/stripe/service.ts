/**
 * Payment business logic that is shared between the tRPC router and the
 * webhook route. Talks to the database and to `PaymentGateway` — never to the
 * `stripe` package directly.
 *
 * Two rules live here and are enforced nowhere else:
 *  1. Only `handleGatewayEvent` (i.e. a verified webhook) may move a payment
 *     into a terminal state — `paid`, `failed`, `refunded`. No client call,
 *     no tRPC mutation, ever.
 *  2. The 24-hour unpaid timeout is applied lazily on read, the same way
 *     `applyExpiry` works in backend/trpc/lib.ts — but implemented here so
 *     `lib.ts` (owned by the auctions agent) stays untouched.
 */
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  listings,
  payments,
  reservations,
  stripeAccounts,
  stripeEvents,
  users,
} from '../db/schema';
import { env } from '../env';
import type { GatewayEvent } from './gateway';

/** Reservation statuses that are still open, matching reservation.ts. */
export const OPEN_RESERVATION_STATUSES = ['requested', 'countered', 'accepted'] as const;

/** The winner has 24 hours from settlement to pay (docs/AUCTIONS.md §3). */
export const PAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PAYMENT_TIMEOUT_REASON = 'payment_timeout';

/* --------------------------------------------------------------- fee math */

/**
 * Stripe's standard US card pricing, **as an estimate only**.
 *
 * Under direct charges the SELLER is the merchant of record, so Stripe's
 * processing fee comes out of the seller's side of the charge, not the
 * platform's. We cannot know the exact number before settlement: it depends on
 * the card (international, Amex, card-present), on currency conversion, and on
 * whatever pricing the seller's own Stripe account ends up on. 2.9% + 30¢ is
 * the published US online-card rate and nothing more.
 *
 * Every figure derived from this MUST be labelled an estimate everywhere it is
 * shown. Never present it as the seller's net.
 */
export const STRIPE_FEE_ESTIMATE = {
  percent: 2.9,
  fixedCents: 30,
  /** Shown verbatim next to any estimated figure. */
  note: "Estimate. Stripe's exact fee is only known once the payment settles.",
} as const;

export interface FeeSplit {
  amountCents: number;
  /** The platform's `application_fee_amount`. Exact — we set it. */
  feeCents: number;
  feePercent: number;
  /** Amount minus the platform fee. Exact, but NOT what the seller pockets. */
  sellerBeforeStripeFeeCents: number;
  /** Estimated Stripe processing fee, borne by the seller under direct charges. */
  stripeFeeEstimateCents: number;
  /** Estimated seller net. An estimate — never render this without saying so. */
  sellerNetEstimateCents: number;
  estimateNote: string;
}

/** Estimated Stripe processing fee on a charge of `amountCents`. */
export function estimateStripeFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * STRIPE_FEE_ESTIMATE.percent) / 100) + STRIPE_FEE_ESTIMATE.fixedCents;
}

/**
 * The platform's cut, plus what the seller can *expect* to keep.
 *
 * `feeCents` is exact — it is the `application_fee_amount` we hand Stripe, and
 * it is the number the buyer saw on the request sheet. The seller's net is
 * not exact and cannot be: Stripe's processing fee is now the seller's cost
 * and is only known at settlement.
 */
export function feeSplit(amountCents: number): FeeSplit {
  const feePercent = env.platformFeePercent;
  const feeCents = Math.round((amountCents * feePercent) / 100);
  const sellerBeforeStripeFeeCents = amountCents - feeCents;
  const stripeFeeEstimateCents = estimateStripeFeeCents(amountCents);
  return {
    amountCents,
    feeCents,
    feePercent,
    sellerBeforeStripeFeeCents,
    stripeFeeEstimateCents,
    sellerNetEstimateCents: sellerBeforeStripeFeeCents - stripeFeeEstimateCents,
    estimateNote: STRIPE_FEE_ESTIMATE.note,
  };
}

/** When the buyer's 24-hour window closes. */
export function payDeadline(reservationCreatedAt: Date): Date {
  return new Date(reservationCreatedAt.getTime() + PAY_WINDOW_MS);
}

/* ----------------------------------------------------- 24h unpaid timeout */

/**
 * Lazy sweep: any still-open auction reservation whose 24-hour payment window
 * has closed without a `paid` payment is cancelled with
 * `cancelReason: 'payment_timeout'`.
 *
 * Deliberately calls the reservation router's own public `cancel` mutation
 * (as the buyer) rather than writing to `reservations` here, so the listing is
 * released by the reservation agent's own `releaseListing` logic and this file
 * never has to duplicate — or fight — that state machine. The import is
 * dynamic because `app-router` imports the payment router, which imports this
 * file; a static import would be a cycle at module-init time.
 *
 * Payment state is NOT changed: per docs/AUCTIONS.md §3, only a verified
 * webhook may move a payment to a terminal state, and a timeout is not a
 * Stripe outcome. The row stays `requires_payment` and the reservation
 * carries the cancellation.
 *
 * @param scope optionally limit the sweep to one reservation (the read path
 *              that triggered it), keeping the common case cheap.
 */
export async function applyPaymentTimeouts(
  db: Db,
  scope?: { reservationId?: string; userId?: string },
): Promise<string[]> {
  const cutoff = new Date(Date.now() - PAY_WINDOW_MS);

  const filters = [
    inArray(reservations.status, [...OPEN_RESERVATION_STATUSES]),
    eq(listings.saleType, 'auction'),
    lt(reservations.createdAt, cutoff),
    // No payment row yet, or one that never reached `paid`.
    or(isNull(payments.id), eq(payments.status, 'requires_payment'))!,
  ];
  if (scope?.reservationId) filters.push(eq(reservations.id, scope.reservationId));
  if (scope?.userId) {
    filters.push(or(eq(reservations.buyerId, scope.userId), eq(reservations.sellerId, scope.userId))!);
  }

  const stale = await db
    .select({ id: reservations.id, buyerId: reservations.buyerId })
    .from(reservations)
    .innerJoin(listings, eq(listings.id, reservations.listingId))
    .leftJoin(payments, eq(payments.reservationId, reservations.id))
    .where(and(...filters));

  if (stale.length === 0) return [];

  const { appRouter } = await import('../trpc/app-router');
  const cancelled: string[] = [];

  for (const row of stale) {
    const [buyer] = await db.select().from(users).where(eq(users.id, row.buyerId)).limit(1);
    if (!buyer) continue;
    try {
      await appRouter.createCaller({ db, user: buyer }).reservation.cancel({
        id: row.id,
        reason: PAYMENT_TIMEOUT_REASON,
      });
      cancelled.push(row.id);
    } catch (err) {
      // A concurrent accept/cancel can legitimately close the window between
      // the SELECT and the call. Log and move on rather than failing a read.
      console.warn('[payments] timeout cancel skipped for', row.id, err);
    }
  }

  return cancelled;
}

/** True when this reservation's payment window has closed unpaid. */
export function isTimedOut(reservation: { createdAt: Date; status: string }, paid: boolean): boolean {
  if (paid) return false;
  if (!(OPEN_RESERVATION_STATUSES as readonly string[]).includes(reservation.status)) return false;
  return payDeadline(reservation.createdAt).getTime() < Date.now();
}

/* ------------------------------------------------------- webhook handling */

export type HandledEventOutcome =
  | { handled: true; duplicate: false; action: string }
  | { handled: true; duplicate: true; action: 'already processed' }
  | { handled: false; duplicate: false; action: string };

/**
 * Resolves the local user id behind a connected account id.
 *
 * Under direct charges the payment objects live on the seller's account, so an
 * event's `account` field is how we know whose payment it is. `payments` has
 * no connected-account column (the schema is owned elsewhere and did not need
 * changing), so we go `stripe_accounts.stripeAccountId → userId` and match on
 * `payments.sellerId`.
 */
async function sellerIdForAccount(db: Db, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: stripeAccounts.userId })
    .from(stripeAccounts)
    .where(eq(stripeAccounts.stripeAccountId, accountId))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Applies one verified Stripe event. Idempotent on the event id: the id is
 * inserted into `stripe_events` first and a conflict means Stripe is retrying
 * a delivery we already applied, so nothing else runs. That dedupe is by event
 * id alone and is unchanged by the direct-charge switch — Stripe event ids are
 * unique across the platform and its connected accounts.
 *
 * **Direct charges:** `payment_intent.*` and `charge.refunded` now arrive from
 * the seller's connected account, with `event.account` set. An event of those
 * types without an `account`, or with one we do not recognise, is not ours and
 * is not applied — it is recorded and ignored rather than matched by intent id
 * alone, so a charge on some unrelated account can never move one of our rows.
 */
export async function handleGatewayEvent(db: Db, event: GatewayEvent): Promise<HandledEventOutcome> {
  const inserted = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });

  if (inserted.length === 0) {
    return { handled: true, duplicate: true, action: 'already processed' };
  }

  const obj = event.data.object;
  const now = new Date();
  const eventAccount = typeof event.account === 'string' && event.account ? event.account : null;

  /** Shared guard for the three connected-account payment events. */
  const resolveSeller = async (): Promise<
    { ok: true; sellerId: string } | { ok: false; outcome: HandledEventOutcome }
  > => {
    if (!eventAccount) {
      return {
        ok: false,
        outcome: {
          handled: false,
          duplicate: false,
          action: 'ignored: no connected account on the event',
        },
      };
    }
    const sellerId = await sellerIdForAccount(db, eventAccount);
    if (!sellerId) {
      return {
        ok: false,
        outcome: {
          handled: false,
          duplicate: false,
          action: 'ignored: unknown connected account',
        },
      };
    }
    return { ok: true, sellerId };
  };

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intentId = obj.id;
      if (!intentId) return { handled: false, duplicate: false, action: 'no payment intent id' };
      const seller = await resolveSeller();
      if (!seller.ok) return seller.outcome;
      const chargeId = obj.charges?.data?.[0]?.id ?? null;
      const updated = await db
        .update(payments)
        .set({ status: 'paid', paidAt: now, stripeChargeId: chargeId, updatedAt: now })
        .where(
          and(
            eq(payments.stripePaymentIntentId, intentId),
            eq(payments.sellerId, seller.sellerId),
            eq(payments.status, 'requires_payment'),
          ),
        )
        .returning({ id: payments.id });
      return {
        handled: true,
        duplicate: false,
        action: updated.length > 0 ? 'payment marked paid' : 'no matching unpaid payment',
      };
    }

    case 'payment_intent.payment_failed': {
      const intentId = obj.id;
      if (!intentId) return { handled: false, duplicate: false, action: 'no payment intent id' };
      const seller = await resolveSeller();
      if (!seller.ok) return seller.outcome;
      const updated = await db
        .update(payments)
        .set({ status: 'failed', updatedAt: now })
        .where(
          and(
            eq(payments.stripePaymentIntentId, intentId),
            eq(payments.sellerId, seller.sellerId),
            eq(payments.status, 'requires_payment'),
          ),
        )
        .returning({ id: payments.id });
      return {
        handled: true,
        duplicate: false,
        action: updated.length > 0 ? 'payment marked failed' : 'no matching unpaid payment',
      };
    }

    case 'charge.refunded': {
      // Stripe sends the charge object; it carries the payment intent id.
      const intentId = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
      if (!intentId) return { handled: false, duplicate: false, action: 'no payment intent id' };
      const seller = await resolveSeller();
      if (!seller.ok) return seller.outcome;
      const updated = await db
        .update(payments)
        .set({ status: 'refunded', stripeChargeId: obj.id ?? null, updatedAt: now })
        .where(
          and(
            eq(payments.stripePaymentIntentId, intentId),
            eq(payments.sellerId, seller.sellerId),
          ),
        )
        .returning({ id: payments.id });
      return {
        handled: true,
        duplicate: false,
        action: updated.length > 0 ? 'payment marked refunded' : 'no matching payment',
      };
    }

    case 'account.updated': {
      // `account.updated` for a connected account also arrives with
      // `event.account` set; the object's own id is the same account. Prefer
      // the event's account and fall back to the object id.
      const accountId = eventAccount ?? obj.id;
      if (!accountId) return { handled: false, duplicate: false, action: 'no account id' };
      if (eventAccount && obj.id && eventAccount !== obj.id) {
        return { handled: false, duplicate: false, action: 'account id mismatch' };
      }
      const updated = await db
        .update(stripeAccounts)
        .set({
          chargesEnabled: obj.charges_enabled === true,
          payoutsEnabled: obj.payouts_enabled === true,
          detailsSubmitted: obj.details_submitted === true,
          updatedAt: now,
        })
        .where(eq(stripeAccounts.stripeAccountId, accountId))
        .returning({ id: stripeAccounts.id });
      return {
        handled: true,
        duplicate: false,
        action: updated.length > 0 ? 'seller account flags updated' : 'no matching seller account',
      };
    }

    default:
      return { handled: false, duplicate: false, action: `ignored event type ${event.type}` };
  }
}
