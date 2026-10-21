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
import crypto from 'node:crypto';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import {
  availabilityWindows,
  listingSpots,
  listings,
  meetupSpots,
  offers,
  reservations,
  users,
  type Listing,
  type Offer,
  type Reservation,
} from '../../db/schema';
import { notifyOfferEvent } from '../../notifications/events';
import { enqueueBookingSms } from '../../sms/outbox';
import {
  AVAILABILITY_HORIZON_MS,
  LEGACY_AUCTION_MESSAGE,
  OFFER_HOLD_MS,
  applyExpiry,
  applyExpiryForRead,
  isBlockedBetween,
  isSlotAligned,
  isUniqueViolation,
  lockPeople,
  recordReservationEvent,
  slotConflicts,
  slotStartsFor,
  toListingCards,
  toPublicUser,
} from '../lib';
import { campusVerifiedProcedure, protectedProcedure, router } from '../trpc';

/** $1 floor, same as the old auction floor: below that a fee can't round sensibly. */
export const MIN_OFFER_CENTS = 100;

/** Maps a unique-index violation inside the accept transaction to the right message. */
function conflictFromUnique(err: unknown): TRPCError | null {
  if (!isUniqueViolation(err)) return null;
  const text = JSON.stringify(err, Object.getOwnPropertyNames(err as object)) ?? '';
  if (text.includes('slot_uq')) {
    return new TRPCError({
      code: 'CONFLICT',
      message: 'That meetup time was just taken. Ask the buyer for another time.',
    });
  }
  if (text.includes('reservations_one_accepted')) {
    return new TRPCError({ code: 'CONFLICT', message: 'This item was just booked by someone else.' });
  }
  return new TRPCError({ code: 'CONFLICT', message: 'You already accepted another offer on this item.' });
}

/**
 * The buyer's proposed meetup, re-validated under the listing lock: the spot is
 * still one the seller meets at, the slot still falls inside their published
 * windows, and neither person has another meetup then. Returns null when the
 * proposal can no longer be booked — accepting then falls back to the plain
 * one-hour hold and the buyer picks a time again.
 */
async function bookableProposal(
  tx: Db,
  offer: Offer,
  listing: Listing,
  now: Date,
): Promise<{ startsAt: Date; spotId: string } | null> {
  if (!offer.proposedStartsAt || !offer.proposedSpotId) return null;
  const startsAt = offer.proposedStartsAt;
  if (
    !isSlotAligned(startsAt) ||
    startsAt.getTime() <= now.getTime() ||
    startsAt.getTime() > now.getTime() + AVAILABILITY_HORIZON_MS
  ) {
    return null;
  }
  const [spotOk] = await tx
    .select({ spotId: listingSpots.spotId })
    .from(listingSpots)
    .innerJoin(meetupSpots, eq(meetupSpots.id, listingSpots.spotId))
    .where(
      and(
        eq(listingSpots.listingId, listing.id),
        eq(listingSpots.spotId, offer.proposedSpotId),
        eq(meetupSpots.isActive, true),
      ),
    )
    .limit(1);
  if (!spotOk) return null;
  const windows = await tx
    .select()
    .from(availabilityWindows)
    .where(eq(availabilityWindows.listingId, listing.id));
  const slotOk = slotStartsFor(windows, {
    now,
    until: new Date(now.getTime() + AVAILABILITY_HORIZON_MS),
  }).some((d) => d.getTime() === startsAt.getTime());
  if (!slotOk) return null;
  const clash = await slotConflicts(tx, {
    sellerId: offer.sellerId,
    buyerId: offer.buyerId,
    startsAt,
  });
  if (clash.seller || clash.buyer) return null;
  if (await isBlockedBetween(tx, offer.sellerId, offer.buyerId)) return null;
  return { startsAt, spotId: offer.proposedSpotId };
}

/**
 * Books the buyer's proposal: the reservation is final at once, exactly as
 * `reservation.book` leaves one, and the offer it came from becomes `booked`.
 * Runs inside the accept transaction, under the listing row lock.
 */
async function bookProposal(
  tx: Db,
  offer: Offer,
  listing: Listing,
  proposal: { startsAt: Date; spotId: string },
  now: Date,
): Promise<{ offer: Offer; reservation: Reservation }> {
  const [reservation] = await tx
    .insert(reservations)
    .values({
      listingId: listing.id,
      buyerId: offer.buyerId,
      sellerId: offer.sellerId,
      status: 'accepted',
      // A curated campus spot, so the custom-address trio stays null
      // (reservations_spot_xor_custom).
      spotId: proposal.spotId,
      startsAt: proposal.startsAt,
      // The buyer named this time; the seller just took it.
      proposedById: offer.buyerId,
      priceCents: offer.amountCents,
      offerId: offer.id,
      handoffCode: String(crypto.randomInt(0, 10_000)).padStart(4, '0'),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await tx.update(listings).set({ status: 'reserved', updatedAt: now }).where(eq(listings.id, listing.id));
  await tx
    .update(reservations)
    .set({ status: 'declined', cancelReason: 'item_reserved', updatedAt: now })
    .where(
      and(
        eq(reservations.listingId, listing.id),
        ne(reservations.id, reservation!.id),
        inArray(reservations.status, ['requested', 'countered']),
      ),
    );
  const [used] = await tx
    .update(offers)
    .set({ status: 'booked', respondedAt: now, reservationId: reservation!.id, updatedAt: now })
    .where(eq(offers.id, offer.id))
    .returning();
  // Every other open offer on the item closes, same as a booking does.
  await tx
    .update(offers)
    .set({ status: 'declined', closeReason: 'item_reserved', updatedAt: now })
    .where(
      and(
        eq(offers.listingId, listing.id),
        inArray(offers.status, ['pending', 'accepted']),
        ne(offers.id, offer.id),
      ),
    );
  return { offer: used!, reservation: reservation! };
}

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

/**
 * Offers decorated with the listing card, the other party, and the proposed
 * meetup spot's name — so a proposal reads as a time and a place on screen
 * without anyone parsing the note text.
 */
async function decorate(db: Db, rows: Offer[]) {
  if (rows.length === 0) return [];
  const spotIds = [...new Set(rows.map((r) => r.proposedSpotId).filter((id): id is string => id != null))];
  const [listingRows, people, spots] = await Promise.all([
    db.select().from(listings).where(inArray(listings.id, [...new Set(rows.map((r) => r.listingId))])),
    db.select().from(users).where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.buyerId, r.sellerId]))])),
    spotIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: meetupSpots.id, name: meetupSpots.name, description: meetupSpots.description })
          .from(meetupSpots)
          .where(inArray(meetupSpots.id, spotIds)),
  ]);
  const cards = await toListingCards(db, listingRows);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const userById = new Map(people.map((u) => [u.id, toPublicUser(u)]));
  const spotById = new Map(spots.map((s) => [s.id, s]));
  return rows.map((o) => ({
    ...o,
    listing: cardById.get(o.listingId) ?? null,
    buyer: userById.get(o.buyerId)!,
    seller: userById.get(o.sellerId)!,
    proposedSpot: (o.proposedSpotId ? spotById.get(o.proposedSpotId) : null) ?? null,
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
        /**
         * The meetup the buyer proposes with the price: a start time and one
         * of the seller's spots. Both or neither. When present, both are
         * checked against the seller's real windows and chosen spots.
         */
        proposedStartsAt: z.coerce.date().optional(),
        proposedSpotId: z.uuid().optional(),
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

      // Price and meetup are one proposal: validate the time and place on the
      // server so a time or spot the seller did not offer is never accepted.
      if ((input.proposedStartsAt == null) !== (input.proposedSpotId == null)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Pick both a meetup time and a meetup spot, or neither.',
        });
      }
      if (input.proposedStartsAt && input.proposedSpotId) {
        const startsAt = input.proposedStartsAt;
        const [windows, [spotRow]] = await Promise.all([
          ctx.db.select().from(availabilityWindows).where(eq(availabilityWindows.listingId, listing.id)),
          ctx.db
            .select({ spotId: listingSpots.spotId })
            .from(listingSpots)
            .innerJoin(meetupSpots, eq(meetupSpots.id, listingSpots.spotId))
            .where(and(eq(listingSpots.listingId, listing.id), eq(listingSpots.spotId, input.proposedSpotId))),
        ]);
        if (!spotRow) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'The seller does not meet at that spot.' });
        }
        const slotOk = slotStartsFor(windows, {
          now,
          until: new Date(now.getTime() + AVAILABILITY_HORIZON_MS),
        }).some((d) => d.getTime() === startsAt.getTime());
        if (!slotOk) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Pick a time the seller is available. Their times may have changed.',
          });
        }
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
            // Structured, so accepting can book exactly this without anyone
            // re-reading a sentence and re-entering it.
            proposedStartsAt: input.proposedStartsAt ?? null,
            proposedSpotId: input.proposedSpotId ?? null,
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

  /**
   * Seller accepts. When the offer carries a meetup proposal that still holds,
   * accepting books it outright at the buyer's chosen time and spot — nobody
   * re-enters anything. Otherwise (no proposal, or the seller's times or spots
   * changed under it) the price is agreed and the item is held for the buyer
   * for one hour so they can pick a time.
   */
  accept: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    await applyExpiry(ctx.db);
    const preview = await loadOffer(ctx.db, input.id);
    if (preview.sellerId !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the seller can accept an offer.' });
    }

    let accepted: Offer;
    let booked: Reservation | null = null;
    try {
      const out = await ctx.db.transaction(async (tx) => {
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

        // The buyer already named a time and a spot: book that, in this same
        // transaction, under the same listing lock `reservation.book` takes.
        if (offer.proposedStartsAt && offer.proposedSpotId) {
          const txDb = tx as unknown as Db;
          await lockPeople(txDb, [offer.sellerId, offer.buyerId]);
          const proposal = await bookableProposal(txDb, offer, listing, now);
          if (proposal) return bookProposal(txDb, offer, listing, proposal, now);
        }

        const holdUntil = new Date(
          Math.min(now.getTime() + OFFER_HOLD_MS, listing.expiresAt?.getTime() ?? Infinity),
        );
        const [row] = await tx
          .update(offers)
          .set({ status: 'accepted', respondedAt: now, holdExpiresAt: holdUntil, updatedAt: now })
          .where(eq(offers.id, offer.id))
          .returning();
        return { offer: row!, reservation: null };
      });
      accepted = out.offer;
      booked = out.reservation;
    } catch (err) {
      throw conflictFromUnique(err) ?? err;
    }
    if (booked) {
      await recordReservationEvent(ctx.db, booked, 'booked', ctx.user.id);
      await enqueueBookingSms(ctx.db, booked.id);
    }
    notify(ctx.db, accepted, accepted.buyerId, 'accepted');
    return { ...accepted, reservation: booked };
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
