/**
 * Payments — Stripe Connect Express, **direct charges**, configurable payout delay.
 * Specified in docs/AUCTIONS.md §3; read that before changing anything here.
 *
 * Direct charges mean the seller's connected account is the merchant of
 * record: the charge is created ON their account, they pay Stripe's
 * processing fee, a dispute debits their balance, and the platform's 10% is
 * collected purely as `application_fee_amount`. That is why no number this
 * router reports as the seller's take-home is exact — see `feeSplit`.
 *
 * What is true today: `PAYMENTS_MODE` resolves to `simulated` because there is
 * no `STRIPE_SECRET_KEY`, so every call below runs against `FakeGateway` and
 * **no money moves**. The code path is the real one; only the gateway is fake.
 *
 * Invariants:
 *  - No mutation here ever sets a terminal payment state. `paid`, `failed` and
 *    `refunded` are set only by a verified webhook (backend/stripe/service.ts).
 *  - `payment.quote` is unchanged from the original simulated fee maths — the
 *    request-meetup sheet still uses it and still says "Simulated".
 */
import { TRPCError } from '@trpc/server';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import { listings, payments, reservations, stripeAccounts, users } from '../../db/schema';
import { env } from '../../env';
import { gateway, paymentsMode, SIMULATED_BANNER } from '../../stripe/client';
import { GatewayError } from '../../stripe/gateway';
import {
  applyPaymentTimeouts,
  estimateStripeFeeCents,
  feeSplit,
  STRIPE_FEE_ESTIMATE,
  isTimedOut,
  OPEN_RESERVATION_STATUSES,
  payDeadline,
} from '../../stripe/service';
import { protectedProcedure, publicProcedure, router } from '../trpc';

/* ------------------------------------------------------------- helpers */

/** Mode + banner, stamped on every payment response so the UI never guesses. */
function modeInfo() {
  const { mode, reason } = paymentsMode();
  return {
    mode,
    simulated: mode === 'simulated',
    /** Shown verbatim; empty outside simulated mode. */
    banner: mode === 'simulated' ? SIMULATED_BANNER : '',
    reason,
  };
}

function toGatewayTrpcError(err: unknown): TRPCError {
  if (err instanceof GatewayError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
  console.error('[payments] gateway call failed', err);
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'The payment provider could not be reached. Try again in a moment.',
  });
}

async function loadParticipantReservation(db: Db, reservationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That meetup no longer exists.' });
  }
  if (row.buyerId !== userId && row.sellerId !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'That meetup is not yours.' });
  }
  return row;
}

/** Creates the Express account row on first use, or returns the stored one. */
async function ensureStripeAccount(db: Db, userId: string) {
  const [existing] = await db
    .select()
    .from(stripeAccounts)
    .where(eq(stripeAccounts.userId, userId))
    .limit(1);
  if (existing) return existing;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'That account no longer exists.' });

  let account;
  try {
    account = await gateway().createExpressAccount({
      userId,
      // Phone-first accounts may have no email yet; Stripe collects it during onboarding.
      email: user.email ?? `user+${user.id}@account.invalid`,
      payoutDelayDays: env.payoutDelayDays,
    });
  } catch (err) {
    throw toGatewayTrpcError(err);
  }

  const [inserted] = await db
    .insert(stripeAccounts)
    .values({
      userId,
      stripeAccountId: account.id,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      detailsSubmitted: account.detailsSubmitted,
    })
    .onConflictDoNothing({ target: stripeAccounts.userId })
    .returning();

  if (inserted) return inserted;

  // Lost a race with a concurrent call — re-read the winner's row.
  const [row] = await db
    .select()
    .from(stripeAccounts)
    .where(eq(stripeAccounts.userId, userId))
    .limit(1);
  return row!;
}

/* -------------------------------------------------------------- router */

export const paymentRouter = router({
  /**
   * Fee arithmetic for the request-meetup sheet. It does not touch Stripe,
   * create a record, or imply that money moves.
   *
   * Under direct charges the seller — not the platform — pays Stripe's
   * processing fee, so `sellerNetCents` (price minus the platform fee) is NOT
   * what the seller pockets. It is kept, with its original meaning and its
   * original exactness, and an explicitly-estimated pair is added alongside
   * it. Anything rendered from `sellerNetEstimateCents` must carry
   * `estimateNote` with it.
   */
  quote: publicProcedure
    .input(z.object({ priceCents: z.number().int().min(0) }))
    .query(({ input }) => {
      const feePercent = env.platformFeePercent;
      const platformFeeCents = Math.round((input.priceCents * feePercent) / 100);
      const sellerBeforeStripeFeeCents = input.priceCents - platformFeeCents;
      const stripeFeeEstimateCents = estimateStripeFeeCents(input.priceCents);
      return {
        priceCents: input.priceCents,
        platformFeeCents,
        /** Price minus the platform fee. Exact — but before Stripe's own fee. */
        sellerNetCents: sellerBeforeStripeFeeCents,
        sellerBeforeStripeFeeCents,
        /** Estimated only: Stripe's fee is not known until the payment settles. */
        stripeFeeEstimateCents,
        stripeFeePercentEstimate: STRIPE_FEE_ESTIMATE.percent,
        stripeFeeFixedCentsEstimate: STRIPE_FEE_ESTIMATE.fixedCents,
        sellerNetEstimateCents: sellerBeforeStripeFeeCents - stripeFeeEstimateCents,
        estimateNote: STRIPE_FEE_ESTIMATE.note,
        feePercent,
        simulated: true as const,
        label: 'Simulated — no money moves' as const,
      };
    }),

  /** Server-resolved mode. Every payment surface derives its label from this. */
  config: publicProcedure.query(() => ({
    ...modeInfo(),
    feePercent: env.platformFeePercent,
    /** 0 = Stripe's minimum hold for the seller's country. See docs/AUCTIONS.md §3. */
    payoutDelayDays: env.payoutDelayDays,
    stripeFeePercentEstimate: STRIPE_FEE_ESTIMATE.percent,
    stripeFeeFixedCentsEstimate: STRIPE_FEE_ESTIMATE.fixedCents,
    estimateNote: STRIPE_FEE_ESTIMATE.note,
  })),

  /**
   * Creates (or reuses) the seller's Connect Express account and returns a
   * fresh onboarding link. Links are short-lived by design — always call this
   * again rather than caching the URL.
   */
  onboardSeller: protectedProcedure.mutation(async ({ ctx }) => {
    const account = await ensureStripeAccount(ctx.db, ctx.user.id);

    let link;
    try {
      link = await gateway().createAccountLink({
        accountId: account.stripeAccountId,
        refreshUrl: `${env.publicAppUrl}/api/stripe/connect/refresh`,
        returnUrl: `${env.publicAppUrl}/api/stripe/connect/return`,
      });
    } catch (err) {
      throw toGatewayTrpcError(err);
    }

    return {
      ...modeInfo(),
      stripeAccountId: account.stripeAccountId,
      onboardingUrl: link.url,
      expiresAt: link.expiresAt,
    };
  }),

  /** The seller's payout flags, refreshed from the gateway on every read. */
  sellerStatus: protectedProcedure.query(async ({ ctx }) => {
    const [stored] = await ctx.db
      .select()
      .from(stripeAccounts)
      .where(eq(stripeAccounts.userId, ctx.user.id))
      .limit(1);

    if (!stored) {
      return {
        ...modeInfo(),
        payoutDelayDays: env.payoutDelayDays,
        onboarded: false,
        stripeAccountId: null as string | null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      };
    }

    let refreshed = {
      chargesEnabled: stored.chargesEnabled,
      payoutsEnabled: stored.payoutsEnabled,
      detailsSubmitted: stored.detailsSubmitted,
    };
    try {
      const live = await gateway().retrieveAccount(stored.stripeAccountId);
      refreshed = {
        chargesEnabled: live.chargesEnabled,
        payoutsEnabled: live.payoutsEnabled,
        detailsSubmitted: live.detailsSubmitted,
      };
      if (
        refreshed.chargesEnabled !== stored.chargesEnabled ||
        refreshed.payoutsEnabled !== stored.payoutsEnabled ||
        refreshed.detailsSubmitted !== stored.detailsSubmitted
      ) {
        await ctx.db
          .update(stripeAccounts)
          .set({ ...refreshed, updatedAt: new Date() })
          .where(eq(stripeAccounts.id, stored.id));
      }
    } catch (err) {
      // A provider hiccup must not blank out the seller's page — fall back to
      // the stored flags and say nothing optimistic.
      console.warn('[payments] could not refresh connected account', err);
    }

    return {
      ...modeInfo(),
      payoutDelayDays: env.payoutDelayDays,
      onboarded: refreshed.payoutsEnabled,
      stripeAccountId: stored.stripeAccountId,
      ...refreshed,
    };
  }),

  /**
   * Starts the buyer's payment for a won auction. Builds a **direct charge**:
   * the PaymentIntent is created ON the seller's connected account, so the
   * seller is the merchant of record, Stripe's processing fee comes out of
   * their side, and the platform takes its cut as `application_fee_amount`.
   * A dispute debits the seller's balance, not the platform's.
   *
   * Idempotent per reservation: calling it twice returns the same intent and
   * charges nothing extra (unique index on `payments.reservation_id`, plus the
   * gateway's own idempotency key).
   */
  createIntent: protectedProcedure
    .input(z.object({ reservationId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await applyPaymentTimeouts(ctx.db, { reservationId: input.reservationId });

      const reservation = await loadParticipantReservation(
        ctx.db,
        input.reservationId,
        ctx.user.id,
      );
      if (reservation.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the buyer can pay for this.' });
      }

      const [existing] = await ctx.db
        .select()
        .from(payments)
        .where(eq(payments.reservationId, reservation.id))
        .limit(1);

      if (existing?.status === 'paid') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This meetup is already paid for.' });
      }
      if (existing?.status === 'refunded') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This payment was refunded. Start a new meetup to buy it again.',
        });
      }
      if (existing && existing.status === 'requires_payment') {
        // Idempotent: same reservation, same intent, no second charge.
        return {
          ...modeInfo(),
          payment: existing,
          ...feeSplit(existing.amountCents),
          connectedAccountId: (
            await ctx.db
              .select({ id: stripeAccounts.stripeAccountId })
              .from(stripeAccounts)
              .where(eq(stripeAccounts.userId, reservation.sellerId))
              .limit(1)
          )[0]?.id ?? null,
          clientSecret: null as string | null,
          reused: true as const,
        };
      }

      if (!(OPEN_RESERVATION_STATUSES as readonly string[]).includes(reservation.status)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This meetup is closed, so it can no longer be paid for.',
        });
      }
      if (payDeadline(reservation.createdAt).getTime() < Date.now()) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The 24-hour window to pay for this has passed.',
        });
      }

      const seller = await ensureStripeAccount(ctx.db, reservation.sellerId);
      const { mode } = paymentsMode();
      if (mode !== 'simulated' && !seller.payoutsEnabled) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: "The seller hasn't finished setting up payouts yet. They need to do that first.",
        });
      }

      const split = feeSplit(reservation.priceCents);

      let intent;
      try {
        intent = await gateway().createPaymentIntent({
          amountCents: split.amountCents,
          applicationFeeCents: split.feeCents,
          connectedAccountId: seller.stripeAccountId,
          idempotencyKey: `reservation:${reservation.id}`,
          metadata: {
            reservationId: reservation.id,
            listingId: reservation.listingId,
            buyerId: reservation.buyerId,
            sellerId: reservation.sellerId,
          },
        });
      } catch (err) {
        throw toGatewayTrpcError(err);
      }

      const [created] = await ctx.db
        .insert(payments)
        .values({
          reservationId: reservation.id,
          buyerId: reservation.buyerId,
          sellerId: reservation.sellerId,
          amountCents: split.amountCents,
          feeCents: split.feeCents,
          stripePaymentIntentId: intent.id,
          status: 'requires_payment',
          mode,
        })
        .onConflictDoNothing({ target: payments.reservationId })
        .returning();

      // Lost a race: another request inserted first. Its row is the truth.
      const row =
        created ??
        (
          await ctx.db
            .select()
            .from(payments)
            .where(eq(payments.reservationId, reservation.id))
            .limit(1)
        )[0]!;

      return {
        ...modeInfo(),
        payment: row,
        ...split,
        connectedAccountId: intent.connectedAccountId,
        clientSecret: intent.clientSecret,
        reused: false as const,
      };
    }),

  /**
   * Full refund, seller or moderator only. There is no automatic refund path
   * because the money has already left for the seller — this asks Stripe to
   * pull it back out of the seller's own balance, which can fail if that
   * balance is short. The payment row only becomes `refunded` when the
   * `charge.refunded` webhook lands.
   *
   * The refund is issued **on the seller's connected account**: under direct
   * charges the charge does not exist on the platform account at all, so
   * without the seller's account id there is nothing we can refund.
   */
  refund: protectedProcedure
    .input(z.object({ reservationId: z.uuid(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const [payment] = await ctx.db
        .select()
        .from(payments)
        .where(eq(payments.reservationId, input.reservationId))
        .limit(1);

      if (!payment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'There is no payment for that meetup.' });
      }

      const isSeller = payment.sellerId === ctx.user.id;
      const isModerator = env.moderatorUserIds.includes(ctx.user.id);
      if (!isSeller && !isModerator) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the seller or a moderator can refund a payment.',
        });
      }

      if (payment.status === 'refunded') {
        throw new TRPCError({ code: 'CONFLICT', message: 'That payment was already refunded.' });
      }
      if (payment.status !== 'paid') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'That payment has not been completed, so there is nothing to refund.',
        });
      }

      const [sellerAccount] = await ctx.db
        .select({ id: stripeAccounts.stripeAccountId })
        .from(stripeAccounts)
        .where(eq(stripeAccounts.userId, payment.sellerId))
        .limit(1);
      if (!sellerAccount) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            "That sale has no connected seller account on file, so it cannot be refunded here.",
        });
      }

      let refund;
      try {
        refund = await gateway().refund({
          paymentIntentId: payment.stripePaymentIntentId,
          connectedAccountId: sellerAccount.id,
          reason: input.reason,
        });
      } catch (err) {
        throw toGatewayTrpcError(err);
      }

      return {
        ...modeInfo(),
        refundId: refund.id,
        amountCents: refund.amountCents,
        connectedAccountId: refund.connectedAccountId,
        /** The row flips to `refunded` when the webhook confirms it, not here. */
        paymentStatus: payment.status,
        note: 'Refund requested. It shows as refunded once the provider confirms it.',
      };
    }),

  /** The payment for one meetup. Both participants may read it; nobody else. */
  byReservation: protectedProcedure
    .input(z.object({ reservationId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await applyPaymentTimeouts(ctx.db, { reservationId: input.reservationId });

      const reservation = await loadParticipantReservation(
        ctx.db,
        input.reservationId,
        ctx.user.id,
      );

      const [listing] = await ctx.db
        .select()
        .from(listings)
        .where(eq(listings.id, reservation.listingId))
        .limit(1);

      const [payment] = await ctx.db
        .select()
        .from(payments)
        .where(eq(payments.reservationId, reservation.id))
        .limit(1);

      const [sellerAccount] = await ctx.db
        .select()
        .from(stripeAccounts)
        .where(eq(stripeAccounts.userId, reservation.sellerId))
        .limit(1);

      const paid = payment?.status === 'paid';

      return {
        ...modeInfo(),
        reservationId: reservation.id,
        role: reservation.buyerId === ctx.user.id ? ('buyer' as const) : ('seller' as const),
        listing: listing
          ? {
              id: listing.id,
              title: listing.title,
              saleType: listing.saleType,
              status: listing.status,
            }
          : null,
        payment: payment ?? null,
        ...feeSplit(payment?.amountCents ?? reservation.priceCents),
        payDeadline: payDeadline(reservation.createdAt),
        timedOut: isTimedOut(reservation, paid),
        reservationStatus: reservation.status,
        cancelReason: reservation.cancelReason,
        sellerPayoutsEnabled: sellerAccount?.payoutsEnabled ?? false,
        connectedAccountId: sellerAccount?.stripeAccountId ?? null,
        payoutDelayDays: env.payoutDelayDays,
      };
    }),

  /** Every payment the caller is a party to, newest first. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    await applyPaymentTimeouts(ctx.db, { userId: ctx.user.id });
    const rows = await ctx.db
      .select()
      .from(payments)
      .where(or(eq(payments.buyerId, ctx.user.id), eq(payments.sellerId, ctx.user.id)));
    return {
      ...modeInfo(),
      items: rows.map((p) => ({
        ...p,
        role: p.buyerId === ctx.user.id ? ('buyer' as const) : ('seller' as const),
      })),
    };
  }),
});
