/**
 * Shared server helpers: lazy expiry, timezone maths, block checks and the
 * output shapes described in docs/CONTRACT.md.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  availabilityWindows,
  bids,
  blocks,
  campuses,
  follows,
  listingPhotos,
  listingSpots,
  listings,
  meetupSpots,
  offers,
  reservationEvents,
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
import { cancelBookingSms } from '../sms/outbox';

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

/* ------------------------------------------------------- booking rules */

/**
 * Meetup length, and the grid every booked start time sits on. This was the
 * 15-minute slot of components/TimeSlotPicker.tsx — made explicit and
 * enforced server-side instead of only implied by the picker.
 */
export const MEETUP_SLOT_MINUTES = 15;
export const MEETUP_SLOT_MS = MEETUP_SLOT_MINUTES * 60 * 1000;

/** Sellers publish availability for "today and the next rolling 24 hours". */
export const AVAILABILITY_HORIZON_MS = 24 * 60 * 60 * 1000;

/** How long an accepted offer holds the item for the buyer to pick a time. */
export const OFFER_HOLD_MS = 60 * 60 * 1000;

/** True when `at` is exactly on a 15-minute boundary (UTC epoch, so any whole/half/quarter-hour zone). */
export function isSlotAligned(at: Date): boolean {
  return at.getTime() % MEETUP_SLOT_MS === 0;
}

/** Every slot start inside the windows, in the future, before `until`. Sorted, de-duplicated. */
export function slotStartsFor(
  windows: { startsAt: Date; endsAt: Date }[],
  opts: { now: Date; until: Date },
): Date[] {
  const out = new Set<number>();
  for (const w of windows) {
    const first = Math.ceil(Math.max(w.startsAt.getTime(), opts.now.getTime()) / MEETUP_SLOT_MS) * MEETUP_SLOT_MS;
    // A slot must fit inside the window: start + slot <= window end.
    for (let t = first; t + MEETUP_SLOT_MS <= w.endsAt.getTime() && t < opts.until.getTime(); t += MEETUP_SLOT_MS) {
      out.add(t);
    }
  }
  return [...out].sort((a, b) => a - b).map((t) => new Date(t));
}

/**
 * Accepted meetups that would overlap a slot at `startsAt` for either person.
 * App-level check (any overlap, including legacy unaligned rows); the partial
 * unique indexes reservations_{seller,buyer}_slot_uq are the DB backstop.
 */
export async function slotConflicts(
  db: Db,
  args: { sellerId: string; buyerId: string; startsAt: Date; excludeReservationId?: string },
): Promise<{ seller: boolean; buyer: boolean }> {
  const lo = new Date(args.startsAt.getTime() - MEETUP_SLOT_MS);
  const hi = new Date(args.startsAt.getTime() + MEETUP_SLOT_MS);
  const rows = await db
    .select({ id: reservations.id, sellerId: reservations.sellerId, buyerId: reservations.buyerId })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, 'accepted'),
        sql`${reservations.startsAt} > ${lo.toISOString()} and ${reservations.startsAt} < ${hi.toISOString()}`,
        or(
          inArray(reservations.sellerId, [args.sellerId, args.buyerId]),
          inArray(reservations.buyerId, [args.sellerId, args.buyerId]),
        ),
      ),
    );
  const others = rows.filter((r) => r.id !== args.excludeReservationId);
  const busy = (uid: string) => others.some((r) => r.sellerId === uid || r.buyerId === uid);
  return { seller: busy(args.sellerId), buyer: busy(args.buyerId) };
}

/** Appends one row to the durable reservation history. */
export async function recordReservationEvent(
  db: Db,
  res: Pick<Reservation, 'id' | 'status' | 'startsAt' | 'spotId' | 'priceCents'>,
  kind: string,
  actorId: string | null,
): Promise<void> {
  await db.insert(reservationEvents).values({
    reservationId: res.id,
    actorId,
    kind,
    status: res.status,
    startsAt: res.startsAt,
    spotId: res.spotId,
    priceCents: res.priceCents,
  });
}

/* ---------------------------------------------- legacy auctions (retired) */

/*
 * Auctions were replaced by asking prices + offers. Nothing below can create
 * an auction or a bid any more; it only settles listings that were ALREADY
 * auctions when the change shipped, at their original end time, so commitments
 * made to existing bidders are honoured. See docs/CONTRACT.md "Auctions retired".
 */

export const LEGACY_AUCTION_MESSAGE =
  'This was posted as an auction before Dibbs switched to asking prices. It closes at its original end time.';

/** Every auction ran for 24 hours (docs/AUCTIONS.md §1). */
export const AUCTION_TTL_MS = 24 * 60 * 60 * 1000;

/** Every listing (fixed-price or auction) expires 24 hours after it was created. */
export const LISTING_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** How far ahead a buyer may propose a meetup on an archived listing (the seller's own windows are gone). */
export const ARCHIVE_REQUEST_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A listing in the Archive: past its 24 hours (swept to 'expired', or still
 * 'active' and waiting for the sweep) and neither sold, removed nor held by a
 * confirmed meetup. It leaves the main Browse feed but stays visible, likeable,
 * commentable, and open to a buyer-proposed meetup that the seller accepts or declines.
 */
export function isArchivedListing(l: Pick<Listing, 'status' | 'expiresAt'>, now: Date = new Date()): boolean {
  return l.status === 'expired' || (l.status === 'active' && l.expiresAt !== null && l.expiresAt.getTime() <= now.getTime());
}

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
/**
 * How long a process may coast on its last expiry sweep when serving a read.
 *
 * `applyExpiry` issues UPDATEs, and it used to run on all 22 of its call
 * sites, which meant every public feed request wrote to the database. That is
 * the single most expensive habit in this codebase at scale: it rules out
 * routing reads to a replica, and concurrent readers take row locks on the
 * same listings just to discover there was nothing to expire.
 *
 * Reads can coast because nothing depends on the sweep being current:
 *   - the client renders auction countdowns locally, so the UI ends an auction
 *     on time whatever the server last swept;
 *   - every mutation still calls the exact `applyExpiry`, so acting on a stale
 *     row (bidding on a just-ended auction) is rejected correctly;
 *   - `listing.feed` additionally filters expired rows in SQL, so the feed is
 *     right even inside the window.
 */
const EXPIRY_SWEEP_INTERVAL_MS = 5_000;
let nextExpirySweepAt = 0;

/**
 * Expiry for read paths: sweeps at most once per interval per process.
 * Mutations must keep calling `applyExpiry` directly.
 */
export async function applyExpiryForRead(db: Db): Promise<void> {
  const now = Date.now();
  if (now < nextExpirySweepAt) return;
  // Claimed before awaiting, so concurrent readers fall through immediately
  // rather than all starting their own sweep.
  nextExpirySweepAt = now + EXPIRY_SWEEP_INTERVAL_MS;
  await applyExpiry(db);
}

/** Test hook: forces the next read-path sweep to actually run. */
export function __resetExpirySweepForTests(): void {
  nextExpirySweepAt = 0;
}

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
    .returning();

  for (const r of staleAccepted) {
    await recordReservationEvent(db, r, 'expired', null);
    await cancelBookingSms(db, r.id);
  }

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

  await expireOffers(db, now);
}

/**
 * Offers lapse when: a pending offer passes its expiresAt (the listing's own
 * expiry); an accepted offer's booking hold passes; or the listing is no
 * longer active for anyone else (expired/removed/sold). An accepted offer on a
 * listing that is 'reserved' by THAT buyer's booking is already 'booked'.
 */
export async function expireOffers(db: Db, now: Date = new Date()): Promise<void> {
  await db
    .update(offers)
    .set({ status: 'expired', closeReason: 'offer_expired', updatedAt: now })
    .where(and(eq(offers.status, 'pending'), lt(offers.expiresAt, now)));
  await db
    .update(offers)
    .set({ status: 'expired', closeReason: 'hold_lapsed', updatedAt: now })
    .where(and(eq(offers.status, 'accepted'), lt(offers.holdExpiresAt, now)));
  await db
    .update(offers)
    .set({ status: 'expired', closeReason: 'listing_closed', updatedAt: now })
    .where(
      and(
        inArray(offers.status, ['pending', 'accepted']),
        sql`exists (select 1 from ${listings} l where l.id = ${offers.listingId} and l.status in ('expired','removed','sold'))`,
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

/* ---------------------------------------------------------------- follows */

/*
 * The follow graph is popularity only. Every read below follows the feed's
 * block precedent: anyone the viewer has blocked, or who has blocked the
 * viewer, is left out of counts and lists, so the numbers a viewer sees always
 * equal the people they can see. Closed accounts (`deletedAt` set) never count
 * and never appear. Counts are always derived with COUNT(*).
 */

/** Follower / following totals for `userId` as `viewerId` (null = signed out) may see them. */
export async function followCounts(
  db: Db,
  userId: string,
  viewerId: string | null,
): Promise<{ followerCount: number; followingCount: number }> {
  const hidden = viewerId ? await blockedUserIds(db, viewerId) : [];
  const [followers, following] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followerId))
      .where(
        and(
          eq(follows.followeeId, userId),
          isNull(users.deletedAt),
          hidden.length > 0 ? notInArray(follows.followerId, hidden) : undefined,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)` })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followeeId))
      .where(
        and(
          eq(follows.followerId, userId),
          isNull(users.deletedAt),
          hidden.length > 0 ? notInArray(follows.followeeId, hidden) : undefined,
        ),
      ),
  ]);
  return { followerCount: Number(followers[0]?.n ?? 0), followingCount: Number(following[0]?.n ?? 0) };
}

/** Whether `viewerId` currently follows `userId`. */
export async function viewerFollows(db: Db, viewerId: string | null, userId: string): Promise<boolean> {
  if (!viewerId || viewerId === userId) return false;
  const rows = await db
    .select({ f: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** People who follow `userId` (`followers`) or whom `userId` follows (`following`), newest first. */
export async function followList(
  db: Db,
  userId: string,
  direction: 'followers' | 'following',
  viewerId: string,
  limit: number,
): Promise<PublicUser[]> {
  const hidden = await blockedUserIds(db, viewerId);
  const otherCol = direction === 'followers' ? follows.followerId : follows.followeeId;
  const ownCol = direction === 'followers' ? follows.followeeId : follows.followerId;
  const rows = await db
    .select({ user: users })
    .from(follows)
    .innerJoin(users, eq(users.id, otherCol))
    .where(
      and(
        eq(ownCol, userId),
        isNull(users.deletedAt),
        hidden.length > 0 ? notInArray(otherCol, hidden) : undefined,
      ),
    )
    .orderBy(desc(follows.createdAt))
    .limit(limit);
  return rows.map((r) => toPublicUser(r.user));
}

/* ----------------------------------------------------------------- shapes */

/**
 * Public view of a user. Never includes `email`.
 *
 * `instagramHandle` / `contactPhone` are present ONLY when the user opted in
 * to showing that field (and it is non-empty). When not shared the KEY IS
 * ABSENT from the object — not null, not hidden by the client — because any
 * client can read the raw tRPC response. `contactPhone` is typed by the user
 * and never verified.
 */
export type PublicUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isDemo: boolean;
  campusEmailVerified: boolean;
  /**
   * Founder-approved seller (postingAccess 'approved' on /admin). NOT campus,
   * student or identity verification; the app labels it "Approved seller".
   * 'blocked' is never exposed publicly.
   */
  approvedSeller: boolean;
  instagramHandle?: string;
  contactPhone?: string;
};

export function toPublicUser(u: User): PublicUser {
  const out: PublicUser = {
    id: u.id,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    isDemo: u.isDemo,
    campusEmailVerified: u.campusEmailVerifiedAt != null,
    approvedSeller: u.postingAccess === 'approved' && u.deletedAt == null,
  };
  // A closed account never shares, whatever the flags say.
  if (u.deletedAt == null) {
    if (u.shareInstagram && u.instagramHandle) out.instagramHandle = u.instagramHandle;
    if (u.sharePhone && u.contactPhone) out.contactPhone = u.contactPhone;
  }
  return out;
}

export type ListingCard = Listing & {
  coverPhotoUrl: string | null;
  seller: PublicUser;
  hasAvailabilityToday: boolean;
  /**
   * Soonest still-open pickup window and where it is, or null when the seller
   * has listed none. The card shows this instead of a bare "today" flag: the
   * time and place are what a buyer actually decides on, so surfacing them in
   * the grid saves the round of messaging other marketplaces force.
   */
  nextPickup: { startsAt: Date; endsAt: Date; spotName: string | null } | null;
  /** Highest bid for an auction, else the fixed price. Derived, never stored. */
  currentPriceCents: number;
  /** Number of bids placed. Always 0 for a fixed-price listing. */
  bidCount: number;
};

/**
 * Builds the card-shaped fields from rows that have already been loaded.
 *
 * Pure — it issues no queries. It exists so the feed (which batches these
 * lookups across 20 listings) and the detail screen (which needs the same
 * rows in fuller form anyway) can agree on how a card is derived without the
 * detail path re-running the feed's queries on top of its own.
 */
function deriveCardFields(input: {
  listing: Listing;
  coverPhotoUrl: string | null;
  seller: User;
  /** Windows not yet finished, soonest first. */
  upcomingWindows: { startsAt: Date; endsAt: Date }[];
  spotName: string | null;
  auction: AuctionState | undefined;
  /** End of the local campus day, for the "today" flag. */
  todayEnd: Date;
}): ListingCard {
  const { listing, upcomingWindows, auction } = input;
  const next = upcomingWindows[0];
  return {
    ...listing,
    coverPhotoUrl: input.coverPhotoUrl,
    seller: toPublicUser(input.seller),
    hasAvailabilityToday: upcomingWindows.some((w) => w.startsAt <= input.todayEnd),
    nextPickup: next
      ? { startsAt: next.startsAt, endsAt: next.endsAt, spotName: input.spotName }
      : null,
    currentPriceCents: auction?.currentPriceCents ?? listing.priceCents,
    bidCount: auction?.bidCount ?? 0,
  };
}

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
  // Every still-open window, soonest first. This replaces a bare existence
  // check: the card needs the window itself, not a yes/no, and it is the same
  // one query either way.
  const upcoming = await db
    .select({
      listingId: availabilityWindows.listingId,
      startsAt: availabilityWindows.startsAt,
      endsAt: availabilityWindows.endsAt,
    })
    .from(availabilityWindows)
    .where(
      and(inArray(availabilityWindows.listingId, listingIds), gte(availabilityWindows.endsAt, now)),
    )
    .orderBy(asc(availabilityWindows.startsAt));

  // First spot per listing, for the "· Student Union" half of the pickup line.
  const spotRows = await db
    .select({ listingId: listingSpots.listingId, name: meetupSpots.name })
    .from(listingSpots)
    .innerJoin(meetupSpots, eq(meetupSpots.id, listingSpots.spotId))
    .where(inArray(listingSpots.listingId, listingIds));
  const spotNameFor = new Map<string, string>();
  for (const s of spotRows) if (!spotNameFor.has(s.listingId)) spotNameFor.set(s.listingId, s.name);

  // `upcoming` is already sorted soonest-first, so grouping preserves that.
  const windowsByListing = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  for (const w of upcoming) {
    const list = windowsByListing.get(w.listingId);
    if (list) list.push(w);
    else windowsByListing.set(w.listingId, [w]);
  }

  return rows.map((l) =>
    deriveCardFields({
      listing: l,
      coverPhotoUrl: cover.get(l.id) ?? null,
      seller: sellerById.get(l.sellerId)!,
      upcomingWindows: windowsByListing.get(l.id) ?? [],
      spotName: spotNameFor.get(l.id) ?? null,
      auction: auctionStates.get(l.id),
      todayEnd: end,
    }),
  );
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
  // This used to call toListingCards first and then load photos, spots and
  // windows again — the card's queries are a strict subset of the detail
  // screen's, so three of them ran twice on 22% of all traffic. The fuller
  // rows are loaded once here and the card is derived from them.
  const [photos, spots, windows, active, sellerRows, campusRows, auctionStates] = await Promise.all([
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
    db.select().from(users).where(eq(users.id, listing.sellerId)).limit(1),
    db.select().from(campuses).where(eq(campuses.id, listing.campusId)).limit(1),
    auctionStateFor(db, [listing]),
  ]);

  const now = new Date();
  const { end: todayEnd } = localDayBounds(campusRows[0]?.timezone ?? 'America/Phoenix');
  const card = deriveCardFields({
    listing,
    coverPhotoUrl: photos[0]?.url ?? null,
    seller: sellerRows[0]!,
    // `windows` is every window ever set, oldest first; the card wants only
    // the ones still open, in the same order.
    upcomingWindows: windows.filter((w) => w.endsAt >= now),
    spotName: spots[0]?.spot.name ?? null,
    auction: auctionStates.get(listing.id),
    todayEnd,
  });

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
    ...card,
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
