/**
 * The reservation state machine. This is the part of the product the server
 * must own outright, so every transition here is validated server-side and the
 * accept path runs inside a transaction with a row lock.
 *
 *   requested ──(seller accept)──▶ accepted ──(both confirm)──▶ completed
 *   requested ──(seller counter)─▶ countered ─(buyer accept)──▶ accepted
 *   countered ──(either counter)─▶ countered        (roles flip via proposedById)
 *   requested|countered ──(seller decline)──▶ declined
 *   requested|countered|accepted ──(either cancel)──▶ cancelled
 *   accepted ──(either reschedule)──▶ countered     (listing stays 'reserved')
 *   accepted + startsAt+2h passed ──(lazy expiry)──▶ expired
 */
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import {
  availabilityWindows,
  handoffConfirmations,
  listingSpots,
  listings,
  reservations,
  type Reservation,
} from '../../db/schema';
import {
  applyExpiry,
  isBlockedBetween,
  isUniqueViolation,
  toReservationDetails,
} from '../lib';
import { protectedProcedure, router } from '../trpc';

const OPEN_STATUSES = ['requested', 'countered', 'accepted'] as const;

/** Loads a reservation the caller takes part in, or throws. */
async function loadParticipantReservation(db: Db, id: string, userId: string) {
  const [res] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  if (!res) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That request no longer exists.' });
  }
  if (res.buyerId !== userId && res.sellerId !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This request is not yours.' });
  }
  return res;
}

async function detailFor(db: Db, res: Reservation, viewerId: string) {
  const [detail] = await toReservationDetails(db, [res], viewerId);
  return detail!;
}

/**
 * Puts a listing back on the market after its hold went away. A listing that
 * is past its own `expiresAt` goes to `expired` instead — the owner relists.
 */
async function releaseListing(db: Db, listingId: string) {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!listing || listing.status !== 'reserved') return;

  const stillHeld = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.listingId, listingId), eq(reservations.status, 'accepted')))
    .limit(1);
  if (stillHeld.length > 0) return;

  const expired = listing.expiresAt != null && listing.expiresAt < new Date();
  await db
    .update(listings)
    .set({ status: expired ? 'expired' : 'active', updatedAt: new Date() })
    .where(eq(listings.id, listingId));
}

export const reservationRouter = router({
  request: protectedProcedure
    .input(z.object({ listingId: z.uuid(), spotId: z.uuid(), startsAt: z.coerce.date() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);

      const [listing] = await ctx.db
        .select()
        .from(listings)
        .where(eq(listings.id, input.listingId))
        .limit(1);
      if (!listing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
      }
      if (listing.sellerId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This is your own listing.' });
      }
      if (listing.status === 'reserved') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This item was just reserved by someone else.',
        });
      }
      if (listing.status !== 'active') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This item is no longer available.' });
      }
      if (await isBlockedBetween(ctx.db, ctx.user.id, listing.sellerId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot request a meetup with this person.',
        });
      }

      const allowedSpot = await ctx.db
        .select({ spotId: listingSpots.spotId })
        .from(listingSpots)
        .where(and(eq(listingSpots.listingId, listing.id), eq(listingSpots.spotId, input.spotId)))
        .limit(1);
      if (allowedSpot.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The seller does not meet at that spot.',
        });
      }

      // The requested time must fall inside a window the seller published.
      // (A seller who wants another time counters instead.)
      const windows = await ctx.db
        .select()
        .from(availabilityWindows)
        .where(eq(availabilityWindows.listingId, listing.id));
      const inWindow = windows.some(
        (w) => input.startsAt >= w.startsAt && input.startsAt < w.endsAt,
      );
      if (!inWindow) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Pick a time the seller is available.',
        });
      }

      const alreadyOpen = await ctx.db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.listingId, listing.id),
            eq(reservations.buyerId, ctx.user.id),
            inArray(reservations.status, [...OPEN_STATUSES]),
          ),
        )
        .limit(1);
      if (alreadyOpen.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'You already have an open request on this item.',
        });
      }

      const [created] = await ctx.db
        .insert(reservations)
        .values({
          listingId: listing.id,
          buyerId: ctx.user.id,
          sellerId: listing.sellerId,
          status: 'requested',
          spotId: input.spotId,
          startsAt: input.startsAt,
          proposedById: ctx.user.id,
          priceCents: listing.priceCents,
        })
        .returning();

      return created!;
    }),

  counter: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        spotId: z.uuid(),
        startsAt: z.coerce.date(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const res = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);

      if (!(OPEN_STATUSES as readonly string[]).includes(res.status)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This request is already closed.',
        });
      }

      const allowedSpot = await ctx.db
        .select({ spotId: listingSpots.spotId })
        .from(listingSpots)
        .where(and(eq(listingSpots.listingId, res.listingId), eq(listingSpots.spotId, input.spotId)))
        .limit(1);
      if (allowedSpot.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The seller does not meet at that spot.',
        });
      }

      // Rescheduling an accepted meetup drops the accepted hold but keeps the
      // item off the market ('reserved') until the two sides agree again.
      const [updated] = await ctx.db
        .update(reservations)
        .set({
          status: 'countered',
          spotId: input.spotId,
          startsAt: input.startsAt,
          proposedById: ctx.user.id,
          handoffCode: null,
          cancelReason: input.note ?? res.cancelReason,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, res.id))
        .returning();

      return updated!;
    }),

  accept: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const preview = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);

      try {
        return await ctx.db.transaction(async (tx) => {
          // Lock the listing row first: concurrent accepts on the same item
          // serialize here, and the partial unique index is the backstop.
          const [listing] = await tx
            .select()
            .from(listings)
            .where(eq(listings.id, preview.listingId))
            .for('update')
            .limit(1);
          if (!listing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
          }

          const [res] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, preview.id))
            .limit(1);
          if (!res) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'That request no longer exists.' });
          }
          if (res.status !== 'requested' && res.status !== 'countered') {
            throw new TRPCError({ code: 'CONFLICT', message: 'This request is already closed.' });
          }
          // Only the side that did NOT make the current proposal may accept it.
          if (res.proposedById === ctx.user.id) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Wait for the other person to respond to your proposal.',
            });
          }

          // 'active' is the normal case; 'reserved' is legal only when this
          // very reservation still owns the hold (an accepted → countered
          // reschedule being re-accepted).
          if (listing.status === 'reserved') {
            const otherHold = await tx
              .select({ id: reservations.id })
              .from(reservations)
              .where(
                and(
                  eq(reservations.listingId, listing.id),
                  eq(reservations.status, 'accepted'),
                  ne(reservations.id, res.id),
                ),
              )
              .limit(1);
            if (otherHold.length > 0) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'This item was just reserved by someone else.',
              });
            }
          } else if (listing.status !== 'active') {
            throw new TRPCError({ code: 'CONFLICT', message: 'This item is no longer available.' });
          }

          const now = new Date();
          const handoffCode = String(crypto.randomInt(0, 10_000)).padStart(4, '0');

          const [accepted] = await tx
            .update(reservations)
            .set({
              status: 'accepted',
              handoffCode,
              buyerConfirmedAt: null,
              sellerConfirmedAt: null,
              updatedAt: now,
            })
            .where(eq(reservations.id, res.id))
            .returning();

          await tx
            .update(listings)
            .set({ status: 'reserved', updatedAt: now })
            .where(eq(listings.id, listing.id));

          // Everyone else waiting on this item is told immediately.
          await tx
            .update(reservations)
            .set({ status: 'declined', cancelReason: 'item_reserved', updatedAt: now })
            .where(
              and(
                eq(reservations.listingId, listing.id),
                ne(reservations.id, res.id),
                inArray(reservations.status, ['requested', 'countered']),
              ),
            );

          return accepted!;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This item was just reserved by someone else.',
          });
        }
        throw err;
      }
    }),

  decline: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const res = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);

      if (res.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the seller can decline.' });
      }
      if (res.status !== 'requested' && res.status !== 'countered') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This request is already closed.' });
      }

      const [updated] = await ctx.db
        .update(reservations)
        .set({ status: 'declined', updatedAt: new Date() })
        .where(eq(reservations.id, res.id))
        .returning();

      await releaseListing(ctx.db, res.listingId);
      return updated!;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const res = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);

      if (!(OPEN_STATUSES as readonly string[]).includes(res.status)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This request is already closed.' });
      }

      const [updated] = await ctx.db
        .update(reservations)
        .set({
          status: 'cancelled',
          cancelledById: ctx.user.id,
          cancelReason: input.reason ?? null,
          handoffCode: null,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, res.id))
        .returning();

      await releaseListing(ctx.db, res.listingId);
      return updated!;
    }),

  byId: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await applyExpiry(ctx.db);
    const res = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);
    return detailFor(ctx.db, res, ctx.user.id);
  }),

  mine: protectedProcedure
    .input(z.object({ role: z.enum(['buyer', 'seller']).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);

      const who =
        input.role === 'buyer'
          ? eq(reservations.buyerId, ctx.user.id)
          : input.role === 'seller'
            ? eq(reservations.sellerId, ctx.user.id)
            : or(eq(reservations.buyerId, ctx.user.id), eq(reservations.sellerId, ctx.user.id));

      const rows = await ctx.db
        .select()
        .from(reservations)
        .where(who)
        .orderBy(desc(reservations.updatedAt));
      return toReservationDetails(ctx.db, rows, ctx.user.id);
    }),

  forListing: protectedProcedure
    .input(z.object({ listingId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);

      const [listing] = await ctx.db
        .select()
        .from(listings)
        .where(eq(listings.id, input.listingId))
        .limit(1);
      if (!listing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
      }
      if (listing.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This listing belongs to someone else.' });
      }

      return ctx.db
        .select()
        .from(reservations)
        .where(eq(reservations.listingId, listing.id))
        .orderBy(desc(reservations.createdAt));
    }),

  /**
   * Handoff: the buyer taps to confirm; the seller confirms by typing the
   * buyer's 4-digit code (or taps, if the buyer already confirmed with a code
   * — not possible in the MVP UI, so the code stays required for sellers).
   * When both sides have confirmed, the item is sold. No payment is created.
   */
  confirmHandoff: protectedProcedure
    .input(z.object({ id: z.uuid(), code: z.string().length(4).optional() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const res = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);

      if (res.status !== 'accepted') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This meetup is not confirmed yet.',
        });
      }

      const isSeller = res.sellerId === ctx.user.id;
      let method: 'code' | 'tap' = 'tap';

      if (isSeller) {
        if (!input.code || input.code !== res.handoffCode) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "That code doesn't match. Ask the buyer to read it out again.",
          });
        }
        method = 'code';
      }

      const now = new Date();
      const patch = isSeller ? { sellerConfirmedAt: now } : { buyerConfirmedAt: now };

      const [updated] = await ctx.db
        .update(reservations)
        .set({ ...patch, updatedAt: now })
        .where(eq(reservations.id, res.id))
        .returning();

      await ctx.db.insert(handoffConfirmations).values({
        reservationId: res.id,
        userId: ctx.user.id,
        confirmedAt: now,
        method,
      });

      let final = updated!;
      if (final.buyerConfirmedAt && final.sellerConfirmedAt) {
        [final] = await ctx.db
          .update(reservations)
          .set({ status: 'completed', updatedAt: now })
          .where(eq(reservations.id, res.id))
          .returning() as [Reservation];

        await ctx.db
          .update(listings)
          .set({ status: 'sold', soldAt: now, updatedAt: now })
          .where(eq(listings.id, res.listingId));
      }

      return detailFor(ctx.db, final, ctx.user.id);
    }),
});
