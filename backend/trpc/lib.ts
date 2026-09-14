/**
 * Shared server helpers: lazy expiry, timezone maths, block checks and the
 * output shapes described in docs/CONTRACT.md.
 */
import { and, eq, gte, inArray, lt, lte, or } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  availabilityWindows,
  blocks,
  campuses,
  listingPhotos,
  listingSpots,
  listings,
  meetupSpots,
  reservations,
  savedListings,
  users,
  type AvailabilityWindow,
  type Listing,
  type MeetupSpot,
  type Reservation,
  type User,
} from '../db/schema';

/* --------------------------------------------------------------- timezone */

function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asUtc - at.getTime();
}

/** UTC instants bounding the local calendar day containing `at` in `timeZone`. */
export function localDayBounds(timeZone: string, at: Date = new Date()): { start: Date; end: Date } {
  const offset = tzOffsetMs(timeZone, at);
  const local = new Date(at.getTime() + offset);
  const startUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

/* ----------------------------------------------------------- lazy expiry */

const ACCEPTED_GRACE_MS = 2 * 60 * 60 * 1000; // accepted meetups expire 2h after startsAt

/**
 * Lazy expiry, called at the top of every read path.
 *
 *  1. `accepted` reservations whose meetup time passed more than 2h ago and
 *     which nobody completed become `expired`.
 *  2. Listings released by (1) go back to `active`.
 *  3. `active` listings past their own `expiresAt` (the 24h "Sell today"
 *     window) become `expired`. A `reserved` listing is never expired while
 *     its accepted hold is still open — step 2 runs first, so a listing that
 *     was both released and stale lands on `expired`, which is correct.
 */
export async function applyExpiry(db: Db): Promise<void> {
  const now = new Date();

  const staleAccepted = await db
    .update(reservations)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(reservations.status, 'accepted'),
        lt(reservations.startsAt, new Date(now.getTime() - ACCEPTED_GRACE_MS)),
      ),
    )
    .returning({ listingId: reservations.listingId });

  if (staleAccepted.length > 0) {
    await db
      .update(listings)
      .set({ status: 'active', updatedAt: now })
      .where(
        and(
          inArray(
            listings.id,
            staleAccepted.map((r) => r.listingId),
          ),
          eq(listings.status, 'reserved'),
        ),
      );
  }

  await db
    .update(listings)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(listings.status, 'active'), lt(listings.expiresAt, now)));
}

/* --------------------------------------------------------------- blocking */

/** True when either user has blocked the other (blocking is symmetric in effect). */
export async function isBlockedBetween(db: Db, a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Every user id `viewerId` has blocked or been blocked by. */
export async function blockedUserIds(db: Db, viewerId: string): Promise<string[]> {
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, viewerId)));
  return rows.map((r) => (r.blockerId === viewerId ? r.blockedId : r.blockerId));
}

/* ----------------------------------------------------------------- shapes */

/** Public view of a user. Never includes `email`. */
export type PublicUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isDemo: boolean;
  campusEmailVerified: boolean;
};

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    isDemo: u.isDemo,
    campusEmailVerified: u.campusEmailVerifiedAt != null,
  };
}

export type ListingCard = Listing & {
  coverPhotoUrl: string | null;
  seller: PublicUser;
  hasAvailabilityToday: boolean;
};

/** Builds ListingCards for a batch of listings in a fixed number of queries. */
export async function toListingCards(db: Db, rows: Listing[]): Promise<ListingCard[]> {
  if (rows.length === 0) return [];
  const listingIds = rows.map((l) => l.id);

  const [photos, sellers, campusRows] = await Promise.all([
    db
      .select()
      .from(listingPhotos)
      .where(inArray(listingPhotos.listingId, listingIds))
      .orderBy(listingPhotos.sortOrder),
    db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((l) => l.sellerId))])),
    db
      .select()
      .from(campuses)
      .where(inArray(campuses.id, [...new Set(rows.map((l) => l.campusId))])),
  ]);

  const cover = new Map<string, string>();
  for (const p of photos) if (!cover.has(p.listingId)) cover.set(p.listingId, p.url);

  const sellerById = new Map(sellers.map((u) => [u.id, u]));
  const tzByCampus = new Map(campusRows.map((c) => [c.id, c.timezone]));

  // "Pickup today" = an availability window that overlaps the remainder of the
  // local campus day. Campuses in this MVP share one timezone, so one bound set.
  const timezone = tzByCampus.get(rows[0]!.campusId) ?? 'America/Phoenix';
  const { end } = localDayBounds(timezone);
  const now = new Date();
  const todayWindows = await db
    .select({ listingId: availabilityWindows.listingId })
    .from(availabilityWindows)
    .where(
      and(
        inArray(availabilityWindows.listingId, listingIds),
        lte(availabilityWindows.startsAt, end),
        gte(availabilityWindows.endsAt, now),
      ),
    );
  const hasToday = new Set(todayWindows.map((w) => w.listingId));

  return rows.map((l) => ({
    ...l,
    coverPhotoUrl: cover.get(l.id) ?? null,
    seller: toPublicUser(sellerById.get(l.sellerId)!),
    hasAvailabilityToday: hasToday.has(l.id),
  }));
}

export type ListingDetail = ListingCard & {
  photos: { id: string; url: string; sortOrder: number; width: number | null; height: number | null }[];
  spots: MeetupSpot[];
  availabilityWindows: AvailabilityWindow[];
  activeReservationId: string | null;
  viewerRole: 'seller' | 'buyer' | 'guest';
  isSaved: boolean;
};

export async function toListingDetail(
  db: Db,
  listing: Listing,
  viewerId: string | null,
): Promise<ListingDetail> {
  const [card] = await toListingCards(db, [listing]);

  const [photos, spots, windows, active] = await Promise.all([
    db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.listingId, listing.id))
      .orderBy(listingPhotos.sortOrder),
    db
      .select({ spot: meetupSpots })
      .from(listingSpots)
      .innerJoin(meetupSpots, eq(meetupSpots.id, listingSpots.spotId))
      .where(eq(listingSpots.listingId, listing.id)),
    db
      .select()
      .from(availabilityWindows)
      .where(eq(availabilityWindows.listingId, listing.id))
      .orderBy(availabilityWindows.startsAt),
    db
      .select()
      .from(reservations)
      .where(and(eq(reservations.listingId, listing.id), eq(reservations.status, 'accepted')))
      .limit(1),
  ]);

  let viewerRole: 'seller' | 'buyer' | 'guest' = 'guest';
  if (viewerId) {
    if (viewerId === listing.sellerId) viewerRole = 'seller';
    else if (active[0]?.buyerId === viewerId) viewerRole = 'buyer';
  }

  let isSaved = false;
  if (viewerId) {
    const saved = await db
      .select({ userId: savedListings.userId })
      .from(savedListings)
      .where(and(eq(savedListings.userId, viewerId), eq(savedListings.listingId, listing.id)))
      .limit(1);
    isSaved = saved.length > 0;
  }

  return {
    ...card!,
    photos: photos.map((p) => ({
      id: p.id,
      url: p.url,
      sortOrder: p.sortOrder,
      width: p.width,
      height: p.height,
    })),
    spots: spots.map((s) => s.spot),
    availabilityWindows: windows,
    activeReservationId: active[0]?.id ?? null,
    viewerRole,
    isSaved,
  };
}

export type ReservationDetail = Omit<Reservation, 'handoffCode'> & {
  listing: ListingCard;
  spot: MeetupSpot;
  buyer: PublicUser;
  seller: PublicUser;
  /** Only ever non-null for the buyer — the seller types it in to confirm. */
  handoffCode: string | null;
  directionsUrl: string;
};

export function directionsUrlFor(spot: MeetupSpot): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`;
}

export async function toReservationDetails(
  db: Db,
  rows: Reservation[],
  viewerId: string,
): Promise<ReservationDetail[]> {
  if (rows.length === 0) return [];

  const [listingRows, spotRows, userRows] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(inArray(listings.id, [...new Set(rows.map((r) => r.listingId))])),
    db
      .select()
      .from(meetupSpots)
      .where(inArray(meetupSpots.id, [...new Set(rows.map((r) => r.spotId))])),
    db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.buyerId, r.sellerId]))])),
  ]);

  const cards = await toListingCards(db, listingRows);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const spotById = new Map(spotRows.map((s) => [s.id, s]));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  return rows.map((r) => {
    const spot = spotById.get(r.spotId)!;
    return {
      ...r,
      listing: cardById.get(r.listingId)!,
      spot,
      buyer: toPublicUser(userById.get(r.buyerId)!),
      seller: toPublicUser(userById.get(r.sellerId)!),
      handoffCode: viewerId === r.buyerId ? r.handoffCode : null,
      directionsUrl: directionsUrlFor(spot),
    };
  });
}

/** Postgres unique-violation code, raised by the partial index on accept. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  return (
    e?.code === '23505' ||
    e?.cause?.code === '23505' ||
    (typeof e?.message === 'string' &&
      (e.message.includes('duplicate key value') ||
        e.message.includes('reservations_one_accepted_per_listing')))
  );
}
