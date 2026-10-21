/**
 * Structured offers — the replacement for bidding. No rounds, no rankings, no
 * timers racing other buyers, no automatic winner.
 *
 *   pending ──(seller accept)──▶ accepted ──(buyer books a slot)──▶ booked
 *   pending ──(seller decline)─▶ declined
 *   pending|accepted ──(buyer withdraw)──▶ withdrawn
 *   pending  past listing expiry ──▶ expired
 *   accepted past its 1-hour hold ──▶ expired (hold_lapsed)
 *   any open offer when the item is booked/expired/removed ──▶ declined/expired
 *
 * Accepting an offer agrees the PRICE and holds the item for that buyer for
 * OFFER_HOLD_MS so they can pick a meetup time. It never reserves the item by
 * itself — `reservation.book` does, using the accepted amount. While the hold
 * lasts nobody else can book or have an offer accepted (row lock on the
 * listing + partial unique index `offers_one_accepted_per_listing`).
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import { listings, offers, users, type Offer } from '../../db/schema';
import { notifyOfferEvent } from '../../notifications/events';
import {
  LEGACY_AUCTION_MESSAGE,
  OFFER_HOLD_MS,
  applyExpiry,
  applyExpiryForRead,
  isBlockedBetween,
  isUniqueViolation,
  toListingCards,
  toPublicUser,
} from '../lib';
import { campusVerifiedProcedure, protectedProcedure, router } from '../trpc';

/** $1 floor, same as the old auction floor: below that a fee can't round sensibly. */
export const MIN_OFFER_CENTS = 100;

async function loadOffer(db: Db, id: string) {
  const [o] = await db.select().from(offers).where(eq(offers.id, id)).limit(1);
  if (!o) throw new TRPCError({ code: 'NOT_FOUND', message: 'That offer no longer exists.' });
  return o;
}

function notify(db: Db, offer: Offer, recipientId: string, kind: 'received' | 'accepted' | 'declined') {
  void (async () => {
    const [l] = await db.select({ title: listings.title }).from(listings).where(eq(listings.id, offer.listingId)).limit(1);
    await notifyOfferEvent(db, {
      recipientId,
      listingId: offer.listingId,
      listingTitle: l?.title ?? 'your item',
      amountCents: offer.amountCents,
      kind,
    });
  })();
}

/** Offers decorated with the listing card and the other party, for list screens. */
async function decorate(db: Db, rows: Offer[]) {
  if (rows.length === 0) return [];
  const [listingRows, people] = await Promise.all([
    db.select().from(listings).where(inArray(listings.id, [...new Set(rows.map((r) => r.listingId))])),
    db.select().from(users).where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.buyerId, r.sellerId]))])),
  ]);
  const cards = await toListingCards(db, listingRows);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const userById = new Map(people.map((u) => [u.id, toPublicUser(u)]));
  return rows.map((o) => ({
    ...o,
    listing: cardById.get(o.listingId) ?? null,
    buyer: userById.get(o.buyerId)!,
    seller: userById.get(o.sellerId)!,
  }));
}

export const offerRouter = router({
  /** Buyer offers an amount below the asking price. */
  create: campusVerifiedProcedure
    .input(
      z.object({
        listingId: z.uuid(),
        amountCents: z.number().int().max(5_000_00, 'Offers are capped at $5,000.'),
        message: z.string().trim().max(280).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const now = new Date();
      const [listing] = await ctx.db.select().from(listings).where(eq(listings.id, input.listingId)).limit(1);
      if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
      if (listing.sellerId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "You can't make an offer on your own listing." });
      }
      if (listing.saleType === 'auction') {
        throw new TRPCError({ code: 'CONFLICT', message: LEGACY_AUCTION_MESSAGE });
      }
      if (listing.status !== 'active' || (listing.expiresAt && listing.expiresAt <= now)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This listing is no longer taking offers.' });
      }
      if (await isBlockedBetween(ctx.db, ctx.user.id, listing.sellerId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot make an offer to this person.' });
      }
      if (input.amountCents < MIN_OFFER_CENTS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Offers start at $1.' });
      }
      if (input.amountCents >= listing.priceCents) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That is at or above the asking price — just book it at the asking price instead.',
        });
      }

      try {
        const [created] = await ctx.db
          .insert(offers)
          .values({
            listingId: listing.id,
            buyerId: ctx.user.id,
            sellerId: listing.sellerId,
            amountCents: input.amountCents,
            askingPriceCents: listing.priceCents,
            message: input.message || null,
            status: 'pending',
            // A pending offer can never outlive the listing.
            expiresAt: listing.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        notify(ctx.db, created!, listing.sellerId, 'received');
        return created!;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'You already have an open offer on this item. Withdraw it to make a new one.',
          });
        }
        throw err;
      }
    }),

  /** Seller accepts: price agreed, item held for the buyer for one hour to book. */
  accept: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    await applyExpiry(ctx.db);
    const preview = await loadOffer(ctx.db, input.id);
    if (preview.sellerId !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the seller can accept an offer.' });
    }

    let accepted: Offer;
    try {
      accepted = await ctx.db.transaction(async (tx) => {
        // Same lock order as reservation.book, so accept and book serialize.
        const [listing] = await tx
          .select()
          .from(listings)
          .where(eq(listings.id, preview.listingId))
          .for('update')
          .limit(1);
        const [offer] = await tx.select().from(offers).where(eq(offers.id, preview.id)).limit(1);
        const now = new Date();
        if (!listing || !offer) throw new TRPCError({ code: 'NOT_FOUND', message: 'That offer no longer exists.' });
        if (offer.status !== 'pending') {
          throw new TRPCError({ code: 'CONFLICT', message: `This offer is already ${offer.status}.` });
        }
        if (offer.expiresAt <= now) {
          throw new TRPCError({ code: 'CONFLICT', message: 'This offer has expired.' });
        }
        if (listing.status !== 'active' || (listing.expiresAt && listing.expiresAt <= now)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'This item is no longer available.' });
        }
        const [other] = await tx
          .select()
          .from(offers)
          .where(and(eq(offers.listingId, listing.id), eq(offers.status, 'accepted')))
          .limit(1);
        if (other && other.holdExpiresAt && other.holdExpiresAt > now) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'You already accepted another offer on this item. Wait for that hold to end.',
          });
        }
        if (other) {
          // A lapsed hold the sweep hasn't reached yet.
          await tx
            .update(offers)
            .set({ status: 'expired', closeReason: 'hold_lapsed', updatedAt: now })
            .where(eq(offers.id, other.id));
        }
        const holdUntil = new Date(
          Math.min(now.getTime() + OFFER_HOLD_MS, listing.expiresAt?.getTime() ?? Infinity),
        );
        const [row] = await tx
          .update(offers)
          .set({ status: 'accepted', respondedAt: now, holdExpiresAt: holdUntil, updatedAt: now })
          .where(eq(offers.id, offer.id))
          .returning();
        return row!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'You already accepted another offer on this item.',
        });
      }
      throw err;
    }
    notify(ctx.db, accepted, accepted.buyerId, 'accepted');
    return accepted;
  }),

  decline: protectedProcedure
    .input(z.object({ id: z.uuid(), reason: z.string().trim().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const offer = await loadOffer(ctx.db, input.id);
      if (offer.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the seller can decline an offer.' });
      }
      const [row] = await ctx.db
        .update(offers)
        .set({ status: 'declined', closeReason: input.reason || 'seller_declined', respondedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(offers.id, offer.id), eq(offers.status, 'pending')))
        .returning();
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: `This offer is already ${offer.status}.` });
      notify(ctx.db, row, row.buyerId, 'declined');
      return row;
    }),

  /** Buyer takes back a pending offer, or releases an accepted hold. */
  withdraw: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    await applyExpiry(ctx.db);
    const offer = await loadOffer(ctx.db, input.id);
    if (offer.buyerId !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the buyer can withdraw this offer.' });
    }
    const [row] = await ctx.db
      .update(offers)
      .set({ status: 'withdrawn', closeReason: 'buyer_withdrew', updatedAt: new Date() })
      .where(and(eq(offers.id, offer.id), inArray(offers.status, ['pending', 'accepted'])))
      .returning();
    if (!row) throw new TRPCError({ code: 'CONFLICT', message: `This offer is already ${offer.status}.` });
    return row;
  }),

  /**
   * Offers on one listing. The seller sees every offer; anyone else sees only
   * their own. Plus whether the item is currently held by an accepted offer.
   */
  forListing: protectedProcedure.input(z.object({ listingId: z.uuid() })).query(async ({ ctx, input }) => {
    await applyExpiryForRead(ctx.db);
    const [listing] = await ctx.db.select().from(listings).where(eq(listings.id, input.listingId)).limit(1);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
    const isSeller = listing.sellerId === ctx.user.id;
    const rows = await ctx.db
      .select()
      .from(offers)
      .where(
        isSeller
          ? eq(offers.listingId, listing.id)
          : and(eq(offers.listingId, listing.id), eq(offers.buyerId, ctx.user.id)),
      )
      .orderBy(desc(offers.createdAt));
    const now = new Date();
    const [hold] = await ctx.db
      .select({ buyerId: offers.buyerId, holdExpiresAt: offers.holdExpiresAt })
      .from(offers)
      .where(and(eq(offers.listingId, listing.id), eq(offers.status, 'accepted')))
      .limit(1);
    const live = hold && hold.holdExpiresAt && hold.holdExpiresAt > now ? hold : null;
    return {
      viewerRole: isSeller ? ('seller' as const) : ('buyer' as const),
      offers: await decorate(ctx.db, rows),
      heldUntil: live?.holdExpiresAt ?? null,
      heldByViewer: !!live && live.buyerId === ctx.user.id,
      heldByOther: !!live && live.buyerId !== ctx.user.id,
    };
  }),

  /** Every offer the caller made or received, newest first. */
  mine: protectedProcedure
    .input(z.object({ role: z.enum(['buyer', 'seller']).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      await applyExpiryForRead(ctx.db);
      const who =
        input.role === 'buyer'
          ? eq(offers.buyerId, ctx.user.id)
          : input.role === 'seller'
            ? eq(offers.sellerId, ctx.user.id)
            : or(eq(offers.buyerId, ctx.user.id), eq(offers.sellerId, ctx.user.id));
      const rows = await ctx.db.select().from(offers).where(who).orderBy(desc(offers.updatedAt)).limit(100);
      return decorate(ctx.db, rows);
    }),
});
