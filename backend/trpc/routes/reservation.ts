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
 *
 *   book (buyer picks a published slot + campus spot) ──▶ accepted directly
 *
 * `book` is the primary purchase path: the seller already published when and
 * where they can meet, so the buyer's confirmation is the final step and the
 * item is held at once. `request` (seller must accept) remains for clients
 * that still send it. Every path that ends in `accepted` re-checks, inside one
 * transaction, that neither person already has a meetup in that slot.
 */
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import {
  availabilityWindows,
  campuses,
  handoffConfirmations,
  listingSpots,
  listings,
  meetupSpots,
  offers,
  reservationEvents,
  reservations,
  users,
  type Reservation,
} from '../../db/schema';
import { cancelBookingSms, enqueueBookingSms } from '../../sms/outbox';
import { directionsUrlForCoords, geocodeAddress, haversineMeters, GeocodeError } from '../../geocode';
import { notifyMeetupEvent, type MeetupEventKind } from '../../notifications/events';
import {
  AVAILABILITY_HORIZON_MS,
  LEGACY_AUCTION_MESSAGE,
  MEETUP_SLOT_MINUTES,
  applyExpiry,
  applyExpiryForRead,
  isBlockedBetween,
  isSlotAligned,
  isUniqueViolation,
  lockPeople,
  recordReservationEvent,
  slotConflicts,
  slotStartsFor,
  toReservationDetails,
  type ReservationDetail,
} from '../lib';
import { campusVerifiedProcedure, protectedProcedure, publicProcedure, router } from '../trpc';

const SLOT_TAKEN = 'That time was just booked. Pick another slot.';

/** Maps a unique-index violation inside an accept/book transaction to the right message. */
function conflictFromUnique(err: unknown): TRPCError | null {
  if (!isUniqueViolation(err)) return null;
  const text = JSON.stringify(err, Object.getOwnPropertyNames(err as object)) ?? '';
  if (text.includes('slot_uq')) return new TRPCError({ code: 'CONFLICT', message: SLOT_TAKEN });
  return new TRPCError({ code: 'CONFLICT', message: 'This item was just reserved by someone else.' });
}

/** Rejects times that are off the 30-minute grid, in the past, or beyond the rolling 24h. */
function assertBookableTime(startsAt: Date, now = new Date()) {
  if (!isSlotAligned(startsAt)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Meetups start on the hour or half hour (${MEETUP_SLOT_MINUTES}-minute slots).`,
    });
  }
  if (startsAt.getTime() <= now.getTime()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That time has already passed.' });
  }
  if (startsAt.getTime() > now.getTime() + AVAILABILITY_HORIZON_MS) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick a time within the next 24 hours.' });
  }
}

/** Throws CONFLICT if either person already has an accepted meetup overlapping this slot. */
async function assertSlotFree(
  tx: Db,
  args: { sellerId: string; buyerId: string; startsAt: Date; excludeReservationId?: string },
) {
  const c = await slotConflicts(tx, args);
  if (c.seller) throw new TRPCError({ code: 'CONFLICT', message: SLOT_TAKEN });
  if (c.buyer) {
    throw new TRPCError({ code: 'CONFLICT', message: 'You already have a meetup at that time.' });
  }
}

/**
 * The live accepted offer on a listing (price agreed, hold not lapsed), if any.
 * Used to price a booking and to stop anyone else booking during the hold.
 */
async function liveAcceptedOffer(db: Db, listingId: string, now = new Date()) {
  const [o] = await db
    .select()
    .from(offers)
    .where(and(eq(offers.listingId, listingId), eq(offers.status, 'accepted')))
    .limit(1);
  if (!o || !o.holdExpiresAt || o.holdExpiresAt <= now) return null;
  return o;
}

/**
 * Item is now held by `reservationId`: the buyer's offer (if any) is marked
 * booked and every other open offer on the item is closed.
 */
async function closeOffersOnReserve(
  tx: Db,
  listingId: string,
  reservationId: string,
  usedOfferId: string | null,
  now: Date,
) {
  if (usedOfferId) {
    await tx
      .update(offers)
      .set({ status: 'booked', reservationId, updatedAt: now })
      .where(eq(offers.id, usedOfferId));
  }
  await tx
    .update(offers)
    .set({ status: 'declined', closeReason: 'item_reserved', updatedAt: now })
    .where(
      and(
        eq(offers.listingId, listingId),
        inArray(offers.status, ['pending', 'accepted']),
        usedOfferId ? ne(offers.id, usedOfferId) : undefined,
      ),
    );
}

/**
 * Fires a "meetup" category push to `recipientId`, looking up the listing
 * title and the acting user's display name. Fire-and-forget: never awaited by
 * callers, and `notifyUsers` underneath never throws — a push failure must
 * never fail a reservation transition.
 */
function notifyReservationEvent(
  db: Db,
  args: { reservationId: string; listingId: string; recipientId: string; actingUserId: string; kind: MeetupEventKind },
): void {
  void (async () => {
    const [[listing], [actor]] = await Promise.all([
      db.select({ title: listings.title }).from(listings).where(eq(listings.id, args.listingId)).limit(1),
      db.select({ displayName: users.displayName }).from(users).where(eq(users.id, args.actingUserId)).limit(1),
    ]);
    await notifyMeetupEvent(db, {
      recipientId: args.recipientId,
      otherName: actor?.displayName ?? 'Someone',
      reservationId: args.reservationId,
      listingTitle: listing?.title ?? 'the item',
      kind: args.kind,
    });
  })();
}

/**
 * `lib.ts`'s `toReservationDetails` already handles a null `spotId` safely
 * (it returns `spot: null`, `directionsUrl: null`) — that's the auctions
 * agent's own "reserved with no spot yet" case. It has no notion of a custom
 * address though, so this wrapper fixes `directionsUrl` back up from
 * `customLat`/`customLng` for the rows this feature owns.
 */
async function toReservationDetailsWithCustom(
  db: Db,
  rows: Reservation[],
  viewerId: string,
): Promise<ReservationDetail[]> {
  const details = await toReservationDetails(db, rows, viewerId);
  return details.map((d) =>
    d.customLat != null && d.customLng != null
      ? { ...d, directionsUrl: directionsUrlForCoords(d.customLat, d.customLng) }
      : d,
  );
}

/** The resolved meetup location for a `request`/`counter` write — exactly one branch is non-null. */
type ResolvedLocation = {
  spotId: string | null;
  customAddress: string | null;
  customLat: number | null;
  customLng: number | null;
};

/**
 * Turns `{ spotId }` or `{ customAddress }` input into a `ResolvedLocation`,
 * geocoding and radius-checking a custom address against the listing's
 * campus. Throws `BAD_REQUEST` with the exact spec copy on failure
 * (docs/AUCTIONS.md §2).
 */
async function resolveLocation(
  db: Db,
  campusId: string,
  input: { spotId?: string; customAddress?: string },
): Promise<ResolvedLocation> {
  if (input.spotId) {
    return { spotId: input.spotId, customAddress: null, customLat: null, customLng: null };
  }

  const [campus] = await db.select().from(campuses).where(eq(campuses.id, campusId)).limit(1);
  if (!campus) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That campus no longer exists.' });
  }

  let geo;
  try {
    geo = await geocodeAddress(db, input.customAddress!);
  } catch (err) {
    if (err instanceof GeocodeError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
    }
    throw err;
  }

  const distanceMeters = haversineMeters(campus.centerLat, campus.centerLng, geo.lat, geo.lng);
  if (distanceMeters > campus.meetupRadiusMeters) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That address is outside the 2-mile campus area.',
    });
  }

  return { spotId: null, customAddress: geo.displayName, customLat: geo.lat, customLng: geo.lng };
}

/** `{ spotId }` xor `{ customAddress }` — shared by `request` and `counter` input. */
const locationInput = z
  .object({
    spotId: z.uuid().optional(),
    customAddress: z.string().trim().min(3).max(300).optional(),
  })
  .refine((v) => (v.spotId != null) !== (v.customAddress != null), {
    message: 'Choose a meetup spot or enter an address, not both.',
  });

const OPEN_STATUSES = ['requested', 'countered', 'accepted'] as const;

const OFFER_HOLD_MESSAGE =
  'The seller accepted another offer on this item. It may open up again if that buyer does not book within the hour.';

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
  const [detail] = await toReservationDetailsWithCustom(db, [res], viewerId);
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
  request: campusVerifiedProcedure
    .input(
      z.intersection(
        z.object({ listingId: z.uuid(), startsAt: z.coerce.date() }),
        locationInput,
      ),
    )
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

      if (input.spotId) {
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
      }
      const location = await resolveLocation(ctx.db, listing.campusId, input);

      // The requested time must fall inside a window the seller published.
      // (A seller who wants another time counters instead.)
      if (listing.saleType === 'auction') {
        throw new TRPCError({ code: 'CONFLICT', message: LEGACY_AUCTION_MESSAGE });
      }
      assertBookableTime(input.startsAt);
      const windows = await ctx.db
        .select()
        .from(availabilityWindows)
        .where(eq(availabilityWindows.listingId, listing.id));
      const inWindow = windows.some(
        (w) =>
          input.startsAt >= w.startsAt &&
          input.startsAt.getTime() + MEETUP_SLOT_MINUTES * 60_000 <= w.endsAt.getTime(),
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

      // An offer the seller accepted for this buyer sets the price.
      const held = await liveAcceptedOffer(ctx.db, listing.id);
      if (held && held.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: 'CONFLICT', message: OFFER_HOLD_MESSAGE });
      }

      const [created] = await ctx.db
        .insert(reservations)
        .values({
          listingId: listing.id,
          buyerId: ctx.user.id,
          sellerId: listing.sellerId,
          status: 'requested',
          ...location,
          startsAt: input.startsAt,
          proposedById: ctx.user.id,
          priceCents: held ? held.amountCents : listing.priceCents,
          offerId: held?.id ?? null,
        })
        .returning();
      await recordReservationEvent(ctx.db, created!, 'requested', ctx.user.id);

      notifyReservationEvent(ctx.db, {
        reservationId: created!.id,
        listingId: listing.id,
        recipientId: listing.sellerId,
        actingUserId: ctx.user.id,
        kind: 'requested',
      });

      return created!;
    }),

  /** Validates a custom address without creating anything — powers the "Check address" step in the UI. */
  checkAddress: protectedProcedure
    .input(z.object({ campusId: z.uuid(), address: z.string().trim().min(3).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const [campus] = await ctx.db
        .select()
        .from(campuses)
        .where(eq(campuses.id, input.campusId))
        .limit(1);
      if (!campus) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That campus no longer exists.' });
      }

      let geo;
      try {
        geo = await geocodeAddress(ctx.db, input.address);
      } catch (err) {
        if (err instanceof GeocodeError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }

      const distanceMeters = haversineMeters(campus.centerLat, campus.centerLng, geo.lat, geo.lng);
      if (distanceMeters > campus.meetupRadiusMeters) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That address is outside the 2-mile campus area.',
        });
      }

      return {
        address: geo.displayName,
        lat: geo.lat,
        lng: geo.lng,
        distanceMeters,
        meetupRadiusMeters: campus.meetupRadiusMeters,
      };
    }),

  counter: protectedProcedure
    .input(
      z.intersection(
        z.object({
          id: z.uuid(),
          startsAt: z.coerce.date(),
          note: z.string().max(500).optional(),
        }),
        locationInput,
      ),
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

      if (input.spotId) {
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
      }

      assertBookableTime(input.startsAt);

      const [listingForCampus] = await ctx.db
        .select({ campusId: listings.campusId })
        .from(listings)
        .where(eq(listings.id, res.listingId))
        .limit(1);
      const location = await resolveLocation(ctx.db, listingForCampus!.campusId, input);

      // Rescheduling an accepted meetup drops the accepted hold but keeps the
      // item off the market ('reserved') until the two sides agree again.
      const [updated] = await ctx.db
        .update(reservations)
        .set({
          status: 'countered',
          ...location,
          startsAt: input.startsAt,
          proposedById: ctx.user.id,
          handoffCode: null,
          cancelReason: input.note ?? res.cancelReason,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, res.id))
        .returning();

      // A moved meetup's texts are void; new ones are written when the new
      // time is accepted.
      if (res.status === 'accepted') await cancelBookingSms(ctx.db, res.id);
      await recordReservationEvent(
        ctx.db,
        updated!,
        res.status === 'accepted' ? 'rescheduled' : 'countered',
        ctx.user.id,
      );

      notifyReservationEvent(ctx.db, {
        reservationId: updated!.id,
        listingId: updated!.listingId,
        recipientId: res.buyerId === ctx.user.id ? res.sellerId : res.buyerId,
        actingUserId: ctx.user.id,
        kind: 'countered',
      });

      return updated!;
    }),

  accept: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const preview = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);

      let result: Reservation;
      try {
        result = await ctx.db.transaction(async (tx) => {
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
          if (res.startsAt.getTime() <= now.getTime()) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'That time has already passed. Propose a new time.',
            });
          }
          const held = await liveAcceptedOffer(tx as unknown as Db, listing.id, now);
          if (held && held.buyerId !== res.buyerId) {
            throw new TRPCError({ code: 'CONFLICT', message: OFFER_HOLD_MESSAGE });
          }
          await lockPeople(tx as unknown as Db, [res.sellerId, res.buyerId]);
          await assertSlotFree(tx as unknown as Db, {
            sellerId: res.sellerId,
            buyerId: res.buyerId,
            startsAt: res.startsAt,
            excludeReservationId: res.id,
          });
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

          await closeOffersOnReserve(
            tx as unknown as Db,
            listing.id,
            accepted!.id,
            held && held.buyerId === res.buyerId ? held.id : res.offerId,
            now,
          );

          return accepted!;
        });
      } catch (err) {
        throw conflictFromUnique(err) ?? err;
      }

      await recordReservationEvent(ctx.db, result, 'accepted', ctx.user.id);
      await enqueueBookingSms(ctx.db, result.id);

      // Notify after the transaction commits. The acceptor is always the side
      // that did NOT make the last proposal (checked above), so proposedById
      // is guaranteed to be the *other* party.
      notifyReservationEvent(ctx.db, {
        reservationId: result.id,
        listingId: result.listingId,
        recipientId: result.proposedById,
        actingUserId: ctx.user.id,
        kind: 'accepted',
      });

      return result;
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
      await recordReservationEvent(ctx.db, updated!, 'declined', ctx.user.id);

      notifyReservationEvent(ctx.db, {
        reservationId: updated!.id,
        listingId: updated!.listingId,
        recipientId: res.buyerId,
        actingUserId: ctx.user.id,
        kind: 'declined',
      });

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
      await cancelBookingSms(ctx.db, res.id);
      await recordReservationEvent(ctx.db, updated!, 'cancelled', ctx.user.id);

      notifyReservationEvent(ctx.db, {
        reservationId: updated!.id,
        listingId: updated!.listingId,
        recipientId: res.buyerId === ctx.user.id ? res.sellerId : res.buyerId,
        actingUserId: ctx.user.id,
        kind: 'cancelled',
      });

      return updated!;
    }),

  /**
   * Bookable slots for a listing: every 30-minute start inside the seller's
   * published windows, in the future, within the rolling 24h — each marked
   * unavailable when the seller (any listing) or the viewer already has a
   * meetup then. Public so guests can see times before signing in.
   */
  slots: publicProcedure.input(z.object({ listingId: z.uuid() })).query(async ({ ctx, input }) => {
    await applyExpiryForRead(ctx.db);
    const [row] = await ctx.db
      .select({ listing: listings, timezone: campuses.timezone })
      .from(listings)
      .innerJoin(campuses, eq(campuses.id, listings.campusId))
      .where(eq(listings.id, input.listingId))
      .limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
    const { listing } = row;

    const now = new Date();
    const expired = listing.expiresAt != null && listing.expiresAt <= now;
    const open = listing.status === 'active' && !expired && listing.saleType === 'fixed';

    const [windows, spots] = await Promise.all([
      ctx.db.select().from(availabilityWindows).where(eq(availabilityWindows.listingId, listing.id)),
      ctx.db
        .select({ spot: meetupSpots })
        .from(listingSpots)
        .innerJoin(meetupSpots, eq(meetupSpots.id, listingSpots.spotId))
        .where(and(eq(listingSpots.listingId, listing.id), eq(meetupSpots.isActive, true))),
    ]);

    const starts = open
      ? slotStartsFor(windows, { now, until: new Date(now.getTime() + AVAILABILITY_HORIZON_MS) })
      : [];

    // One query for every accepted meetup either person has in the horizon.
    const people = ctx.user && ctx.user.id !== listing.sellerId ? [listing.sellerId, ctx.user.id] : [listing.sellerId];
    const busyRows = starts.length
      ? await ctx.db
          .select({ startsAt: reservations.startsAt, sellerId: reservations.sellerId, buyerId: reservations.buyerId })
          .from(reservations)
          .where(
            and(
              eq(reservations.status, 'accepted'),
              or(inArray(reservations.sellerId, people), inArray(reservations.buyerId, people)),
            ),
          )
      : [];
    const slotMs = MEETUP_SLOT_MINUTES * 60_000;
    const overlapping = (t: number, who: string) =>
      busyRows.some(
        (b) => (b.sellerId === who || b.buyerId === who) && Math.abs(b.startsAt.getTime() - t) < slotMs,
      );

    return {
      listingId: listing.id,
      open,
      closedReason: open
        ? null
        : listing.saleType === 'auction'
          ? LEGACY_AUCTION_MESSAGE
          : expired || listing.status === 'expired'
            ? 'This listing has expired.'
            : listing.status === 'reserved'
              ? 'This item is already booked.'
              : 'This item is no longer available.',
      timezone: row.timezone,
      slotMinutes: MEETUP_SLOT_MINUTES,
      expiresAt: listing.expiresAt,
      spots: spots.map((s) => s.spot),
      slots: starts.map((d) => {
        const sellerBusy = overlapping(d.getTime(), listing.sellerId);
        const viewerBusy = ctx.user && ctx.user.id !== listing.sellerId ? overlapping(d.getTime(), ctx.user.id) : false;
        return {
          startsAt: d,
          available: !sellerBusy && !viewerBusy,
          reason: sellerBusy ? ('seller_busy' as const) : viewerBusy ? ('you_busy' as const) : null,
        };
      }),
    };
  }),

  /**
   * Buyer confirms an exact slot + campus spot. Final state at once: the
   * reservation is `accepted`, the item `reserved`, the handoff code issued.
   * Price is the asking price, or the buyer's accepted offer while its hold
   * lasts. Idempotent: re-submitting the same booking returns it unchanged.
   */
  book: campusVerifiedProcedure
    .input(
      z.object({
        listingId: z.uuid(),
        spotId: z.uuid(),
        startsAt: z.coerce.date(),
        /** Optional: assert which offer's price you expect. Mismatch → CONFLICT. */
        offerId: z.uuid().optional(),
        /** Optional: the price the buyer saw. If it changed, CONFLICT instead of charging a surprise. */
        expectedPriceCents: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      const now = new Date();

      let created: Reservation;
      let reused = false;
      try {
        const out = await ctx.db.transaction(async (txRaw) => {
          const tx = txRaw as unknown as Db;
          const [listing] = await tx
            .select()
            .from(listings)
            .where(eq(listings.id, input.listingId))
            .for('update')
            .limit(1);
          if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
          if (listing.sellerId === ctx.user.id) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'This is your own listing.' });
          }

          // Idempotent re-submit (double tap, retry after a dropped response).
          const [mine] = await tx
            .select()
            .from(reservations)
            .where(
              and(
                eq(reservations.listingId, listing.id),
                eq(reservations.buyerId, ctx.user.id),
                eq(reservations.status, 'accepted'),
              ),
            )
            .limit(1);
          if (mine) {
            if (mine.startsAt.getTime() === input.startsAt.getTime() && mine.spotId === input.spotId) {
              return { reservation: mine, reused: true };
            }
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'You already booked this item. Reschedule from your meetup instead.',
            });
          }

          if (listing.saleType === 'auction') {
            throw new TRPCError({ code: 'CONFLICT', message: LEGACY_AUCTION_MESSAGE });
          }
          if (listing.status === 'reserved') {
            throw new TRPCError({ code: 'CONFLICT', message: 'This item was just booked by someone else.' });
          }
          if (listing.status !== 'active' || (listing.expiresAt && listing.expiresAt <= now)) {
            throw new TRPCError({ code: 'CONFLICT', message: 'This listing has expired or is no longer available.' });
          }
          if (await isBlockedBetween(tx, ctx.user.id, listing.sellerId)) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot book a meetup with this person.' });
          }

          assertBookableTime(input.startsAt, now);

          const [spotOk] = await tx
            .select({ spotId: listingSpots.spotId })
            .from(listingSpots)
            .innerJoin(meetupSpots, eq(meetupSpots.id, listingSpots.spotId))
            .where(
              and(
                eq(listingSpots.listingId, listing.id),
                eq(listingSpots.spotId, input.spotId),
                eq(meetupSpots.isActive, true),
              ),
            )
            .limit(1);
          if (!spotOk) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'The seller does not meet at that spot.' });
          }

          // Re-read availability inside the lock: a seller edit since the
          // buyer loaded the chart makes the slot stale.
          const windows = await tx
            .select()
            .from(availabilityWindows)
            .where(eq(availabilityWindows.listingId, listing.id));
          const slotOk = slotStartsFor(windows, {
            now,
            until: new Date(now.getTime() + AVAILABILITY_HORIZON_MS),
          }).some((d) => d.getTime() === input.startsAt.getTime());
          if (!slotOk) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: "The seller's availability changed. Pick one of the times shown now.",
            });
          }

          const held = await liveAcceptedOffer(tx, listing.id, now);
          if (held && held.buyerId !== ctx.user.id) {
            throw new TRPCError({ code: 'CONFLICT', message: OFFER_HOLD_MESSAGE });
          }
          if (input.offerId && held?.id !== input.offerId) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'That offer is no longer active. Book at the asking price or make a new offer.',
            });
          }
          const priceCents = held ? held.amountCents : listing.priceCents;
          if (input.expectedPriceCents !== undefined && input.expectedPriceCents !== priceCents) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'The price changed since you opened this. Review it and confirm again.',
            });
          }

          await lockPeople(tx, [listing.sellerId, ctx.user.id]);
          await assertSlotFree(tx, { sellerId: listing.sellerId, buyerId: ctx.user.id, startsAt: input.startsAt });

          const [reservation] = await tx
            .insert(reservations)
            .values({
              listingId: listing.id,
              buyerId: ctx.user.id,
              sellerId: listing.sellerId,
              status: 'accepted',
              spotId: input.spotId,
              startsAt: input.startsAt,
              // The seller's published availability is their side of the deal.
              proposedById: listing.sellerId,
              priceCents,
              offerId: held?.id ?? null,
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
          await closeOffersOnReserve(tx, listing.id, reservation!.id, held?.id ?? null, now);
          return { reservation: reservation!, reused: false };
        });
        created = out.reservation;
        reused = out.reused;
      } catch (err) {
        throw conflictFromUnique(err) ?? err;
      }

      if (!reused) {
        await recordReservationEvent(ctx.db, created, 'booked', ctx.user.id);
        await enqueueBookingSms(ctx.db, created.id);
        notifyReservationEvent(ctx.db, {
          reservationId: created.id,
          listingId: created.listingId,
          recipientId: created.sellerId,
          actingUserId: ctx.user.id,
          kind: 'booked',
        });
      }
      return detailFor(ctx.db, created, ctx.user.id);
    }),

  /** The durable history of one meetup (participants only), oldest first. */
  history: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await loadParticipantReservation(ctx.db, input.id, ctx.user.id);
    return ctx.db
      .select()
      .from(reservationEvents)
      .where(eq(reservationEvents.reservationId, input.id))
      .orderBy(reservationEvents.createdAt);
  }),

  byId: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await applyExpiryForRead(ctx.db);
    const res = await loadParticipantReservation(ctx.db, input.id, ctx.user.id);
    return detailFor(ctx.db, res, ctx.user.id);
  }),

  mine: protectedProcedure
    .input(z.object({ role: z.enum(['buyer', 'seller']).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      await applyExpiryForRead(ctx.db);

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
      return toReservationDetailsWithCustom(ctx.db, rows, ctx.user.id);
    }),

  forListing: protectedProcedure
    .input(z.object({ listingId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await applyExpiryForRead(ctx.db);

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

      const rows = await ctx.db
        .select()
        .from(reservations)
        .where(eq(reservations.listingId, listing.id))
        .orderBy(desc(reservations.createdAt));

      const buyerIds = [...new Set(rows.map((r) => r.buyerId))];
      const buyers = buyerIds.length
        ? await ctx.db
            .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
            .from(users)
            .where(inArray(users.id, buyerIds))
        : [];
      const buyerById = new Map(buyers.map((b) => [b.id, b]));

      return rows.map((r) => ({
        ...r,
        buyer: buyerById.get(r.buyerId) ?? { id: r.buyerId, displayName: 'Deleted account', avatarUrl: null },
      }));
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
        await recordReservationEvent(ctx.db, final, 'completed', ctx.user.id);
        await cancelBookingSms(ctx.db, res.id);
      }

      return detailFor(ctx.db, final, ctx.user.id);
    }),
});
