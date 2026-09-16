/**
 * Shared server helpers: lazy expiry, timezone maths, block checks and the
 * output shapes described in docs/CONTRACT.md.
 */
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  availabilityWindows,
  bids,
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
import { notifyAuctionEndedNoBids, notifyAuctionWon } from '../notifications/events';

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

/* ------------------------------------------------------------- auctions */

/** Every auction runs for 24 hours (docs/AUCTIONS.md §1). */
export const AUCTION_TTL_MS = 24 * 60 * 60 * 1000;

/** A bid inside the final 2 minutes pushes the end time out to now + 2 minutes. */
export const ANTI_SNIPE_MS = 2 * 60 * 1000;

/** Minimum step over the current price: $1 or 5%, whichever is larger. */
export function bidIncrementCents(currentPriceCents: number): number {
  return Math.max(100, Math.ceil(currentPriceCents * 0.05));
}

/**
 * The smallest amount the next bid may be.
 * With no bids yet that is the start price itself — a single bid sells the
 * item at the seller's floor, which the sell form states in plain words.
 */
export function minNextBidCents(currentPriceCents: number, hasBids: boolean): number {
  return hasBids ? currentPriceCents + bidIncrementCents(currentPriceCents) : currentPriceCents;
}

export type AuctionState = {
  currentPriceCents: number;
  bidCount: number;
  topBidderId: string | null;
};

/** Derived auction state (highest bid else start price) for a batch of listings. */
export async function auctionStateFor(
  db: Db,
  rows: Pick<Listing, 'id' | 'saleType' | 'priceCents' | 'startPriceCents'>[],
): Promise<Map<string, AuctionState>> {
  const out = new Map<string, AuctionState>();
  const auctionIds = rows.filter((r) => r.saleType === 'auction').map((r) => r.id);
  for (const r of rows) {
    out.set(r.id, {
      currentPriceCents: r.saleType === 'auction' ? (r.startPriceCents ?? r.priceCents) : r.priceCents,
      bidCount: 0,
      topBidderId: null,
    });
  }
  if (auctionIds.length === 0) return out;

  const agg = await db
    .select({
      listingId: bids.listingId,
      top: sql<number>`max(${bids.amountCents})`,
      count: sql<number>`count(*)`,
    })
    .from(bids)
    .where(inArray(bids.listingId, auctionIds))
    .groupBy(bids.listingId);

  for (const a of agg) {
    const prev = out.get(a.listingId);
    if (!prev) continue;
    out.set(a.listingId, {
      currentPriceCents: Math.max(Number(a.top), prev.currentPriceCents),
      bidCount: Number(a.count),
      topBidderId: null,
    });
  }
  return out;
}

/** The highest bid on a listing; ties broken by whoever bid first. */
export async function topBid(db: Db, listingId: string) {
  const [row] = await db
    .select()
    .from(bids)
    .where(eq(bids.listingId, listingId))
    .orderBy(desc(bids.amountCents), asc(bids.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Where and when a settled auction's meetup is first proposed.
 *
 * docs/AUCTIONS.md §1 originally said the settlement reservation carried no
 * spot and no time. The reservations table forbids that (`spot_id` XOR the
 * custom-address trio, `starts_at NOT NULL`), so settlement instead opens the
 * existing meetup flow with a seller-side proposal: the listing's first pickup
 * spot and its next availability window. Either party counters as usual.
 */
export async function openingProposalFor(
  db: Db,
  listing: Listing,
): Promise<{ spotId: string; startsAt: Date } | null> {
  const [spot] = await db
    .select({ spotId: listingSpots.spotId })
    .from(listingSpots)
    .where(eq(listingSpots.listingId, listing.id))
    .limit(1);
  if (!spot) return null;

  const now = new Date();
  const [win] = await db
    .select()
    .from(availabilityWindows)
    .where(
      and(eq(availabilityWindows.listingId, listing.id), gte(availabilityWindows.endsAt, now)),
    )
    .orderBy(asc(availabilityWindows.startsAt))
    .limit(1);

  const startsAt =
    win && win.startsAt > now ? win.startsAt : new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return { spotId: spot.spotId, startsAt };
}

/**
 * Settles one ended auction. Transactional and idempotent: the listing row is
 * locked FOR UPDATE, every precondition is re-checked inside the lock, and a
 * winner who already has a reservation on this listing never gets a second one.
 */
/** What `settleAuction` should notify about once its transaction has committed. */
type SettlementNotice =
  | { kind: 'no_bids'; sellerId: string; listingId: string; listingTitle: string }
  | {
      kind: 'won';
      winnerId: string;
      listingId: string;
      listingTitle: string;
      priceCents: number;
      reservationId: string | null;
    }
  | null;

async function settleAuction(db: Db, listingId: string): Promise<void> {
  // Notifications must fire only once the transaction has actually committed
  // (and never break settlement if sending fails), so the transaction body
  // only returns what happened; this function fires the notification after
  // `db.transaction` resolves.
  const notice: SettlementNotice = await db.transaction(async (tx): Promise<SettlementNotice> => {
    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, listingId))
      .for('update')
      .limit(1);
    const now = new Date();
    if (
      !listing ||
      listing.saleType !== 'auction' ||
      listing.status !== 'active' ||
      !listing.expiresAt ||
      listing.expiresAt > now
    ) {
      return null;
    }

    const [winner] = await tx
      .select()
      .from(bids)
      .where(eq(bids.listingId, listing.id))
      .orderBy(desc(bids.amountCents), asc(bids.createdAt))
      .limit(1);

    if (!winner) {
      await tx
        .update(listings)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(listings.id, listing.id));
      return { kind: 'no_bids', sellerId: listing.sellerId, listingId: listing.id, listingTitle: listing.title };
    }

    // Idempotency guard: never create a second reservation for the same winner.
    const already = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(eq(reservations.listingId, listing.id), eq(reservations.buyerId, winner.bidderId)),
      )
      .limit(1);

    let notice: SettlementNotice = null;

    if (already.length === 0) {
      const opening = await openingProposalFor(tx as unknown as Db, listing);
      if (!opening) {
        // No pickup spot on the listing at all — nothing we can propose.
        // Leave it reserved so nobody else can buy it; the seller can message.
        await tx
          .update(listings)
          .set({ status: 'reserved', updatedAt: now })
          .where(eq(listings.id, listing.id));
        return {
          kind: 'won',
          winnerId: winner.bidderId,
          listingId: listing.id,
          listingTitle: listing.title,
          priceCents: winner.amountCents,
          reservationId: null,
        };
      }
      const [createdReservation] = await tx
        .insert(reservations)
        .values({
          listingId: listing.id,
          buyerId: winner.bidderId,
          sellerId: listing.sellerId,
          status: 'requested',
          spotId: opening.spotId,
          startsAt: opening.startsAt,
          proposedById: listing.sellerId,
          priceCents: winner.amountCents,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: reservations.id });
      notice = {
        kind: 'won',
        winnerId: winner.bidderId,
        listingId: listing.id,
        listingTitle: listing.title,
        priceCents: winner.amountCents,
        reservationId: createdReservation!.id,
      };
    }

    await tx
      .update(listings)
      .set({ status: 'reserved', updatedAt: now })
      .where(eq(listings.id, listing.id));

    return notice;
  });

  if (notice?.kind === 'no_bids') {
    void notifyAuctionEndedNoBids(db, {
      sellerId: notice.sellerId,
      listingId: notice.listingId,
      listingTitle: notice.listingTitle,
    });
  } else if (notice?.kind === 'won') {
    void notifyAuctionWon(db, {
      winnerId: notice.winnerId,
      listingId: notice.listingId,
      listingTitle: notice.listingTitle,
      priceCents: notice.priceCents,
      reservationId: notice.reservationId,
    });
  }
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

  // Auctions past their end time settle one at a time, each inside its own
  // transaction with the listing row locked — see settleAuction().
  const dueAuctions = await db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        eq(listings.status, 'active'),
        eq(listings.saleType, 'auction'),
        lt(listings.expiresAt, now),
      ),
    );
  for (const a of dueAuctions) await settleAuction(db, a.id);

  // Fixed-price "Sell today" expiry — unchanged behaviour.
  await db
    .update(listings)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(listings.status, 'active'),
        eq(listings.saleType, 'fixed'),
        lt(listings.expiresAt, now),
      ),
    );
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
  /** Highest bid for an auction, else the fixed price. Derived, never stored. */
  currentPriceCents: number;
  /** Number of bids placed. Always 0 for a fixed-price listing. */
  bidCount: number;
};

/** Builds ListingCards for a batch of listings in a fixed number of queries. */
export async function toListingCards(db: Db, rows: Listing[]): Promise<ListingCard[]> {
  if (rows.length === 0) return [];
  const listingIds = rows.map((l) => l.id);

  const [photos, sellers, campusRows, auctionStates] = await Promise.all([
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
    auctionStateFor(db, rows),
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

  return rows.map((l) => {
    const auction = auctionStates.get(l.id);
    return {
      ...l,
      coverPhotoUrl: cover.get(l.id) ?? null,
      seller: toPublicUser(sellerById.get(l.sellerId)!),
      hasAvailabilityToday: hasToday.has(l.id),
      currentPriceCents: auction?.currentPriceCents ?? l.priceCents,
      bidCount: auction?.bidCount ?? 0,
    };
  });
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
  /** Null when the meetup is at a custom address instead of a campus spot. */
  spot: MeetupSpot | null;
  buyer: PublicUser;
  seller: PublicUser;
  /** Only ever non-null for the buyer — the seller types it in to confirm. */
  handoffCode: string | null;
  directionsUrl: string | null;
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
      .where(
        inArray(meetupSpots.id, [
          ...new Set(rows.map((r) => r.spotId).filter((id): id is string => id != null)),
        ]),
      ),
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
    const spot = r.spotId ? (spotById.get(r.spotId) ?? null) : null;
    return {
      ...r,
      listing: cardById.get(r.listingId)!,
      spot,
      buyer: toPublicUser(userById.get(r.buyerId)!),
      seller: toPublicUser(userById.get(r.sellerId)!),
      handoffCode: viewerId === r.buyerId ? r.handoffCode : null,
      directionsUrl: spot ? directionsUrlFor(spot) : null,
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
