/**
 * "Get a Dibbs offer" (docs/CONTRACT.md "Dibbs offer requests").
 *
 *   dibbsOffer.*  — the seller's side: create, list, view, answer, schedule, withdraw.
 *   dibbsStaff.*  — the Dibbs buying team (DIBBS_STAFF_USER_IDS): queue, review, act.
 *
 * Privacy: requests and their media are visible only to the seller who made
 * them and to staff. Nothing here is joined into Browse, Archive, profiles,
 * Community, search or share pages, and a non-owner gets NOT_FOUND (not
 * FORBIDDEN) so ids can't be probed. Media URLs are short-lived signed links.
 *
 * Integrity: every mutation locks the request row. Staff actions also carry
 * the `version` they saw, so two staff members can't issue conflicting
 * updates (the second gets CONFLICT and reloads). Seller answers to an
 * estimate or final offer name the version they saw, so a revised price is
 * never accepted by accident. Prices are integer cents.
 */
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import {
  campuses,
  conditionEnum,
  dibbsOfferEvents,
  dibbsOfferMedia,
  dibbsOfferRequests,
  listingPhotos,
  listings,
  meetupSpots,
  users,
  type DibbsOfferRequest,
  type DibbsOfferStatus,
  type MeetupSpot,
} from '../../db/schema';
import { holdListingForDibbs, markListingSoldToDibbs, releaseDibbsHold } from '../../dibbs/hold';
import { MAX_PHOTOS_PER_REQUEST, MAX_VIDEOS_PER_REQUEST, signedMediaPath } from '../../dibbs/media';
import {
  enqueueSellerEmail,
  enqueueTeamEmail,
  pushSeller,
  type SellerPushKind,
} from '../../dibbs/notify';
import {
  DECLINE_FROM,
  DIBBS_ESTIMATE_VALID_MS,
  DIBBS_MAX_CENTS,
  DIBBS_MAX_NEW_PER_DAY,
  DIBBS_MAX_OPEN_PER_SELLER,
  DIBBS_MEETUP_HORIZON_MS,
  ESTIMATE_FROM,
  OPEN_STATUSES,
  PROPOSE_MEETUP_FROM,
  WITHDRAW_FROM,
  isDibbsStaff,
  isOpen,
  sellerActionNeeded,
  staffActionNeeded,
} from '../../dibbs/rules';
import { isSlotAligned, isUniqueViolation, slotConflicts } from '../lib';
import { campusVerifiedProcedure, protectedProcedure, router } from '../trpc';

/* ------------------------------------------------------------ procedures */

/** Signed-in account listed in DIBBS_STAFF_USER_IDS. */
const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isDibbsStaff(ctx.user.id)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Dibbs staff access required.' });
  }
  return next({ ctx });
});

/* --------------------------------------------------------------- inputs */

const cents = z.number().int().min(1).max(DIBBS_MAX_CENTS);
const message = z.string().trim().min(1).max(1000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const createInput = z.object({
  clientRequestId: z.uuid(),
  itemName: z.string().trim().min(2, 'Add the item’s name.').max(80),
  condition: z.enum(conditionEnum.enumValues).optional(),
  specs: optionalText(300),
  description: optionalText(1000),
  mediaIds: z.array(z.uuid()).max(MAX_PHOTOS_PER_REQUEST + MAX_VIDEOS_PER_REQUEST).default([]),
  /** The seller's own public listing for the same item ("Also get a Dibbs offer"). */
  listingId: z.uuid().optional(),
});

const meetupInput = z.object({ spotId: z.uuid(), startsAt: z.coerce.date() });

const staffAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_review') }),
  z.object({ type: z.literal('send_estimate'), lowCents: cents, highCents: cents, message: optionalText(1000) }),
  z.object({ type: z.literal('request_info'), message }),
  z.object({ type: z.literal('decline'), message }),
  z.object({ type: z.literal('propose_meetup'), spotId: z.uuid(), startsAt: z.coerce.date() }),
  z.object({ type: z.literal('confirm_meetup') }),
  z.object({ type: z.literal('cancel_meetup'), message }),
  z.object({ type: z.literal('send_final_offer'), amountCents: cents, message: optionalText(1000) }),
  z.object({ type: z.literal('record_completed') }),
  z.object({ type: z.literal('record_payout'), message }),
  z.object({
    type: z.literal('close'),
    outcome: z.enum(['no_show', 'not_as_described', 'sold_elsewhere', 'duplicate', 'other']),
    message: optionalText(1000),
  }),
]);
type StaffAction = z.infer<typeof staffAction>;

/* -------------------------------------------------------------- helpers */

function notFound(): never {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'We couldn’t find that request.' });
}

function conflict(msg: string): never {
  throw new TRPCError({ code: 'CONFLICT', message: msg });
}

const STALE_MESSAGE = 'This request changed since you opened it. Reload to see the latest before acting.';

async function lockRequest(tx: Db, id: string): Promise<DibbsOfferRequest> {
  const [row] = await tx.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.id, id)).for('update').limit(1);
  if (!row) notFound();
  return row;
}

async function addEvent(
  tx: Db,
  row: Pick<DibbsOfferRequest, 'id' | 'status'>,
  e: {
    actorKind: 'seller' | 'staff' | 'system';
    actorId: string | null;
    kind: string;
    toStatus?: DibbsOfferStatus;
    message?: string | null;
    low?: number | null;
    high?: number | null;
    spotId?: string | null;
    startsAt?: Date | null;
    visibleToSeller?: boolean;
  },
) {
  await tx.insert(dibbsOfferEvents).values({
    requestId: row.id,
    actorKind: e.actorKind,
    actorId: e.actorId,
    kind: e.kind,
    fromStatus: row.status,
    toStatus: e.toStatus ?? row.status,
    message: e.message ?? null,
    amountLowCents: e.low ?? null,
    amountHighCents: e.high ?? null,
    spotId: e.spotId ?? null,
    startsAt: e.startsAt ?? null,
    visibleToSeller: e.visibleToSeller ?? true,
  });
}

type EventInput = Parameters<typeof addEvent>[2];

/** Applies a change and bumps the version. Returns the updated row. */
async function update(tx: Db, row: DibbsOfferRequest, set: Partial<DibbsOfferRequest>): Promise<DibbsOfferRequest> {
  const [next] = await tx
    .update(dibbsOfferRequests)
    .set({ ...set, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(dibbsOfferRequests.id, row.id), eq(dibbsOfferRequests.version, row.version)))
    .returning();
  if (!next) conflict(STALE_MESSAGE);
  return next;
}

/** Time on the 15-minute grid, in the future, within 7 days; a campus meetup spot that is active. */
async function assertMeetup(tx: Db, row: DibbsOfferRequest, spotId: string, startsAt: Date): Promise<MeetupSpot> {
  const now = Date.now();
  if (!isSlotAligned(startsAt)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick a time on the quarter hour (:00, :15, :30 or :45).' });
  }
  if (startsAt.getTime() <= now) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That time has already passed. Pick a later one.' });
  }
  if (startsAt.getTime() > now + DIBBS_MEETUP_HORIZON_MS) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick a time within the next 7 days.' });
  }
  const [spot] = await tx
    .select()
    .from(meetupSpots)
    .where(and(eq(meetupSpots.id, spotId), eq(meetupSpots.campusId, row.campusId), eq(meetupSpots.isActive, true)))
    .limit(1);
  if (!spot) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick one of the campus meetup spots.' });
  return spot;
}

/** The seller can't be in two meetups at once (listing meetups and Dibbs meetups both count). */
async function assertSellerFree(tx: Db, row: DibbsOfferRequest, startsAt: Date) {
  const busy = await slotConflicts(tx, {
    sellerId: row.sellerId,
    buyerId: row.sellerId,
    startsAt,
    excludeDibbsRequestId: row.id,
  });
  if (busy.seller) conflict('The seller already has a meetup at that time. Pick another time.');
}

/** Confirms the proposed meetup: re-checks time and conflicts, then holds a linked listing. */
async function confirmMeetup(tx: Db, row: DibbsOfferRequest): Promise<DibbsOfferRequest> {
  if (!row.meetupStartsAt || !row.meetupSpotId) conflict('There is no proposed meetup to confirm.');
  if (row.meetupStartsAt.getTime() <= Date.now()) conflict('That meetup time has passed. Propose a new time.');
  // Serialize with listing bookings for this seller (reservation.book locks the same user row).
  await tx.select({ id: users.id }).from(users).where(eq(users.id, row.sellerId)).for('update');
  await assertSellerFree(tx, row, row.meetupStartsAt);
  if (row.listingId) {
    const hold = await holdListingForDibbs(tx, row.listingId, row.id);
    if (!hold.ok) {
      conflict(
        hold.reason === 'sold'
          ? 'This item already sold through its public listing.'
          : 'This item is on hold for a meetup booked through its public listing.',
      );
    }
  }
  const [fresh] = await tx.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.id, row.id));
  return update(tx, fresh!, { status: 'meetup_confirmed', meetupConfirmedAt: new Date() });
}

/**
 * Lazy upkeep, run before reads (same idea as listing expiry):
 *  - an estimate the seller never answered lapses after DIBBS_ESTIMATE_VALID_MS;
 *  - a request whose public listing sold through the marketplace closes as
 *    `sold_elsewhere` (only when this request doesn't hold the listing).
 */
async function sweep(db: Db): Promise<void> {
  const now = new Date();
  const expired = await db
    .update(dibbsOfferRequests)
    .set({ status: 'expired', version: sql`${dibbsOfferRequests.version} + 1`, updatedAt: now })
    .where(and(eq(dibbsOfferRequests.status, 'offered'), lt(dibbsOfferRequests.estimateExpiresAt, now)))
    .returning({ id: dibbsOfferRequests.id });
  for (const r of expired) {
    await db.insert(dibbsOfferEvents).values({
      requestId: r.id,
      actorKind: 'system',
      kind: 'estimate_expired',
      fromStatus: 'offered',
      toStatus: 'expired',
      message: 'The estimate lapsed before it was answered.',
    });
  }
  const soldElsewhere = await db
    .select({ id: dibbsOfferRequests.id, status: dibbsOfferRequests.status })
    .from(dibbsOfferRequests)
    .innerJoin(listings, eq(listings.id, dibbsOfferRequests.listingId))
    .where(
      and(
        inArray(dibbsOfferRequests.status, [...OPEN_STATUSES]),
        eq(dibbsOfferRequests.holdsListing, false),
        eq(listings.status, 'sold'),
      ),
    );
  for (const r of soldElsewhere) {
    await db
      .update(dibbsOfferRequests)
      .set({ status: 'closed', closedOutcome: 'sold_elsewhere', version: sql`${dibbsOfferRequests.version} + 1`, updatedAt: now })
      .where(and(eq(dibbsOfferRequests.id, r.id), eq(dibbsOfferRequests.status, r.status)));
    await db.insert(dibbsOfferEvents).values({
      requestId: r.id,
      actorKind: 'system',
      kind: 'sold_elsewhere',
      fromStatus: r.status,
      toStatus: 'closed',
      message: 'The item sold through its public listing.',
    });
  }
}

/* -------------------------------------------------------------- output */

type Viewer = 'seller' | 'staff';

async function detailFor(db: Db, row: DibbsOfferRequest, viewer: Viewer) {
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, row.campusId));
  const media = await db
    .select()
    .from(dibbsOfferMedia)
    .where(eq(dibbsOfferMedia.requestId, row.id))
    .orderBy(asc(dibbsOfferMedia.sortOrder), asc(dibbsOfferMedia.createdAt));
  const [listing] = row.listingId ? await db.select().from(listings).where(eq(listings.id, row.listingId)) : [];
  const photos = listing
    ? await db.select().from(listingPhotos).where(eq(listingPhotos.listingId, listing.id)).orderBy(asc(listingPhotos.sortOrder))
    : [];
  const [spot] = row.meetupSpotId ? await db.select().from(meetupSpots).where(eq(meetupSpots.id, row.meetupSpotId)) : [];
  const events = await db
    .select()
    .from(dibbsOfferEvents)
    .where(
      viewer === 'staff'
        ? eq(dibbsOfferEvents.requestId, row.id)
        : and(eq(dibbsOfferEvents.requestId, row.id), eq(dibbsOfferEvents.visibleToSeller, true)),
    )
    .orderBy(asc(dibbsOfferEvents.createdAt));
  const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
  const actors = viewer === 'staff' && actorIds.length
    ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, actorIds))
    : [];
  const spotIds = [...new Set(events.map((e) => e.spotId).filter((x): x is string => !!x))];
  const spotNames = spotIds.length
    ? await db.select({ id: meetupSpots.id, name: meetupSpots.name }).from(meetupSpots).where(inArray(meetupSpots.id, spotIds))
    : [];

  const listingOnHoldElsewhere = !!listing && listing.status === 'reserved' && !row.holdsListing;

  return {
    id: row.id,
    status: row.status,
    version: row.version,
    itemName: row.itemName,
    condition: row.condition,
    specs: row.specs,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    timezone: campus?.timezone ?? 'America/Phoenix',
    campusId: row.campusId,
    media: media.map((m) => ({ id: m.id, kind: m.kind as 'image' | 'video', url: signedMediaPath(m.id), durationMs: m.durationMs })),
    listing: listing
      ? {
          id: listing.id,
          title: listing.title,
          status: listing.status,
          priceCents: listing.priceCents,
          photoUrls: photos.map((p) => p.url),
        }
      : null,
    listingOnHoldElsewhere,
    estimate:
      row.estimateLowCents != null && row.estimateHighCents != null
        ? {
            kind: row.estimateLowCents === row.estimateHighCents ? ('exact' as const) : ('range' as const),
            lowCents: row.estimateLowCents,
            highCents: row.estimateHighCents,
            version: row.estimateVersion,
            sentAt: row.estimateSentAt,
            expiresAt: row.estimateExpiresAt,
          }
        : null,
    meetup:
      row.meetupStartsAt && row.meetupSpotId
        ? {
            startsAt: row.meetupStartsAt,
            spot: spot ?? null,
            proposedBy: row.meetupProposedBy as 'seller' | 'dibbs',
            confirmed: row.status === 'meetup_confirmed' || row.status === 'final_offer' || row.status === 'final_accepted' || row.status === 'completed',
          }
        : null,
    finalOffer: row.finalOfferCents != null ? { cents: row.finalOfferCents, version: row.finalOfferVersion, sentAt: row.finalOfferSentAt } : null,
    finalAcceptedCents: row.finalAcceptedCents,
    finalAcceptedAt: row.finalAcceptedAt,
    completedAt: row.completedAt,
    payoutStatus: row.payoutStatus as 'not_recorded' | 'recorded_outside_app',
    payoutRecordedAt: row.payoutRecordedAt,
    closedOutcome: row.closedOutcome,
    sellerActionNeeded: sellerActionNeeded(row),
    staffActionNeeded: staffActionNeeded(row),
    timeline: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      actor: e.actorKind as 'seller' | 'staff' | 'system',
      /** Staff see who acted; sellers only see "Dibbs". */
      actorName: viewer === 'staff' ? (actors.find((a) => a.id === e.actorId)?.displayName ?? null) : null,
      toStatus: e.toStatus,
      message: e.message,
      lowCents: e.amountLowCents,
      highCents: e.amountHighCents,
      startsAt: e.startsAt,
      spotName: spotNames.find((s) => s.id === e.spotId)?.name ?? null,
      internal: !e.visibleToSeller,
      createdAt: e.createdAt,
    })),
  };
}

export type DibbsOfferDetail = Awaited<ReturnType<typeof detailFor>>;

async function staffDetail(db: Db, row: DibbsOfferRequest) {
  const base = await detailFor(db, row, 'staff');
  const [seller] = await db.select().from(users).where(eq(users.id, row.sellerId));
  const [assigned] = row.assignedStaffId
    ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, row.assignedStaffId))
    : [];
  return {
    ...base,
    seller: seller
      ? {
          id: seller.id,
          displayName: seller.displayName,
          avatarUrl: seller.avatarUrl,
          campusEmailVerified: seller.campusEmailVerifiedAt != null,
          memberSince: seller.createdAt,
          isClosed: seller.deletedAt != null,
        }
      : null,
    assignedStaff: assigned ?? null,
    waitingMinutes: Math.max(0, Math.round((Date.now() - row.createdAt.getTime()) / 60_000)),
  };
}

function summary(row: DibbsOfferRequest, cover: string | null) {
  return {
    id: row.id,
    itemName: row.itemName,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    coverUrl: cover,
    estimateLowCents: row.estimateLowCents,
    estimateHighCents: row.estimateHighCents,
    meetupStartsAt: row.meetupStartsAt,
    listingId: row.listingId,
    sellerActionNeeded: sellerActionNeeded(row),
  };
}

/** First image per request: a signed private link, or the linked listing's public cover. */
async function coversFor(db: Db, rows: DibbsOfferRequest[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!rows.length) return out;
  const media = await db
    .select({ id: dibbsOfferMedia.id, requestId: dibbsOfferMedia.requestId, sortOrder: dibbsOfferMedia.sortOrder })
    .from(dibbsOfferMedia)
    .where(and(inArray(dibbsOfferMedia.requestId, rows.map((r) => r.id)), eq(dibbsOfferMedia.kind, 'image')))
    .orderBy(asc(dibbsOfferMedia.sortOrder));
  const listingIds = rows.map((r) => r.listingId).filter((x): x is string => !!x);
  const photos = listingIds.length
    ? await db.select().from(listingPhotos).where(inArray(listingPhotos.listingId, listingIds)).orderBy(asc(listingPhotos.sortOrder))
    : [];
  for (const r of rows) {
    const m = media.find((x) => x.requestId === r.id);
    const p = r.listingId ? photos.find((x) => x.listingId === r.listingId) : undefined;
    out.set(r.id, m ? signedMediaPath(m.id) : (p?.url ?? null));
  }
  return out;
}

/** Claims the caller's unattached uploads for a request, enforcing per-request limits. */
async function attachMedia(tx: Db, requestId: string, uploaderId: string, mediaIds: string[]) {
  if (!mediaIds.length) return;
  const unique = [...new Set(mediaIds)];
  const rows = await tx
    .select()
    .from(dibbsOfferMedia)
    .where(and(inArray(dibbsOfferMedia.id, unique), eq(dibbsOfferMedia.uploaderId, uploaderId), isNull(dibbsOfferMedia.requestId)))
    .for('update');
  if (rows.length !== unique.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Some photos or videos didn’t finish uploading. Remove them and try again.' });
  }
  const existing = await tx
    .select({ kind: dibbsOfferMedia.kind, sortOrder: dibbsOfferMedia.sortOrder })
    .from(dibbsOfferMedia)
    .where(eq(dibbsOfferMedia.requestId, requestId));
  const photos = existing.filter((m) => m.kind === 'image').length + rows.filter((m) => m.kind === 'image').length;
  const videos = existing.filter((m) => m.kind === 'video').length + rows.filter((m) => m.kind === 'video').length;
  if (photos > MAX_PHOTOS_PER_REQUEST) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Up to ${MAX_PHOTOS_PER_REQUEST} photos per request.` });
  }
  if (videos > MAX_VIDEOS_PER_REQUEST) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'One video per request.' });
  }
  let order = existing.reduce((max, m) => Math.max(max, m.sortOrder + 1), 0);
  for (const id of mediaIds.filter((id, i) => mediaIds.indexOf(id) === i)) {
    await tx.update(dibbsOfferMedia).set({ requestId, sortOrder: order++ }).where(eq(dibbsOfferMedia.id, id));
  }
}

/* ------------------------------------------------------------- seller */

async function loadOwn(db: Db, id: string, userId: string): Promise<DibbsOfferRequest> {
  const [row] = await db.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.id, id)).limit(1);
  if (!row || row.sellerId !== userId) notFound();
  return row;
}

/** Runs a seller mutation on their own request inside a transaction; pushes afterwards. */
async function sellerMutation(
  db: Db,
  id: string,
  userId: string,
  fn: (tx: Db, row: DibbsOfferRequest) => Promise<DibbsOfferRequest>,
) {
  const row = await db.transaction(async (tx) => {
    const locked = await lockRequest(tx, id);
    if (locked.sellerId !== userId) notFound();
    return fn(tx, locked);
  });
  return detailFor(db, row, 'seller');
}

export const dibbsOfferRouter = router({
  /** Private request to the Dibbs buying team. Idempotent per clientRequestId. */
  create: campusVerifiedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const [again] = await ctx.db
      .select()
      .from(dibbsOfferRequests)
      .where(and(eq(dibbsOfferRequests.sellerId, userId), eq(dibbsOfferRequests.clientRequestId, input.clientRequestId)))
      .limit(1);
    if (again) return detailFor(ctx.db, again, 'seller');

    if (!input.listingId && input.mediaIds.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one photo or a short video.' });
    }

    let campusId = ctx.user.campusId;
    if (input.listingId) {
      const [listing] = await ctx.db.select().from(listings).where(eq(listings.id, input.listingId)).limit(1);
      if (!listing || listing.sellerId !== userId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'We couldn’t find that listing.' });
      }
      if (!['active', 'expired'].includes(listing.status)) {
        conflict('This listing is on hold or sold, so it can’t get a Dibbs offer right now.');
      }
      campusId = listing.campusId;
    }

    const open = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dibbsOfferRequests)
      .where(and(eq(dibbsOfferRequests.sellerId, userId), inArray(dibbsOfferRequests.status, [...OPEN_STATUSES])));
    if ((open[0]?.n ?? 0) >= DIBBS_MAX_OPEN_PER_SELLER) {
      conflict(`You have ${DIBBS_MAX_OPEN_PER_SELLER} open requests. Wait for those to finish or withdraw one first.`);
    }
    const recent = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dibbsOfferRequests)
      .where(and(eq(dibbsOfferRequests.sellerId, userId), gte(dibbsOfferRequests.createdAt, new Date(Date.now() - 86_400_000))));
    if ((recent[0]?.n ?? 0) >= DIBBS_MAX_NEW_PER_DAY) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'You’ve sent a lot of requests today. Try again tomorrow.' });
    }

    let row: DibbsOfferRequest;
    try {
      row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(dibbsOfferRequests)
          .values({
            sellerId: userId,
            campusId,
            listingId: input.listingId ?? null,
            clientRequestId: input.clientRequestId,
            itemName: input.itemName,
            condition: input.condition ?? null,
            specs: input.specs,
            description: input.description,
          })
          .returning();
        await attachMedia(tx, created!.id, userId, input.mediaIds);
        await addEvent(tx, { id: created!.id, status: 'submitted' }, { actorKind: 'seller', actorId: userId, kind: 'submitted' });
        await enqueueTeamEmail(tx, created!, 'new_request');
        return created!;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent retry with the same clientRequestId won, or the listing already has an open request.
      const [winner] = await ctx.db
        .select()
        .from(dibbsOfferRequests)
        .where(and(eq(dibbsOfferRequests.sellerId, userId), eq(dibbsOfferRequests.clientRequestId, input.clientRequestId)))
        .limit(1);
      if (winner) return detailFor(ctx.db, winner, 'seller');
      conflict('This listing already has an open Dibbs offer request.');
    }
    return detailFor(ctx.db, row, 'seller');
  }),

  mine: protectedProcedure.query(async ({ ctx }) => {
    await sweep(ctx.db);
    const rows = await ctx.db
      .select()
      .from(dibbsOfferRequests)
      .where(eq(dibbsOfferRequests.sellerId, ctx.user.id))
      .orderBy(desc(dibbsOfferRequests.createdAt))
      .limit(50);
    const covers = await coversFor(ctx.db, rows);
    return rows.map((r) => summary(r, covers.get(r.id) ?? null));
  }),

  byId: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await sweep(ctx.db);
    const row = await loadOwn(ctx.db, input.id, ctx.user.id);
    return detailFor(ctx.db, row, 'seller');
  }),

  /** Open request for one of the seller's listings, if any (owner only). */
  forListing: protectedProcedure.input(z.object({ listingId: z.uuid() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ id: dibbsOfferRequests.id, status: dibbsOfferRequests.status })
      .from(dibbsOfferRequests)
      .where(
        and(
          eq(dibbsOfferRequests.listingId, input.listingId),
          eq(dibbsOfferRequests.sellerId, ctx.user.id),
          inArray(dibbsOfferRequests.status, [...OPEN_STATUSES]),
        ),
      )
      .limit(1);
    return row ?? null;
  }),

  /** Answer the team's question; the request goes back to the team. */
  reply: campusVerifiedProcedure
    .input(z.object({ id: z.uuid(), message: z.string().trim().max(1000).default(''), mediaIds: z.array(z.uuid()).max(9).default([]) }))
    .mutation(({ ctx, input }) =>
      sellerMutation(ctx.db, input.id, ctx.user.id, async (tx, row) => {
        if (row.status !== 'needs_info') conflict('Dibbs isn’t waiting on an answer for this request.');
        if (!input.message && input.mediaIds.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Write an answer or add a photo.' });
        }
        await attachMedia(tx, row.id, ctx.user.id, input.mediaIds);
        const added = input.mediaIds.length ? ` (${input.mediaIds.length} new photo${input.mediaIds.length === 1 ? '' : 's'}/video)` : '';
        await addEvent(tx, row, {
          actorKind: 'seller',
          actorId: ctx.user.id,
          kind: 'info_provided',
          toStatus: 'submitted',
          message: `${input.message}${added}`.trim() || null,
        });
        const next = await update(tx, row, { status: 'submitted' });
        await enqueueTeamEmail(tx, next, 'info_provided');
        return next;
      }),
    ),

  /** "No thanks" to the estimate. */
  declineEstimate: protectedProcedure
    .input(z.object({ id: z.uuid(), estimateVersion: z.number().int() }))
    .mutation(({ ctx, input }) =>
      sellerMutation(ctx.db, input.id, ctx.user.id, async (tx, row) => {
        if (row.status !== 'offered' && row.status !== 'meetup_proposed') conflict('There is no estimate waiting for an answer.');
        if (row.estimateVersion !== input.estimateVersion) conflict('Dibbs updated the estimate. Review the new one first.');
        await releaseDibbsHold(tx, row);
        await addEvent(tx, row, { actorKind: 'seller', actorId: ctx.user.id, kind: 'estimate_declined', toStatus: 'seller_declined' });
        return update(tx, row, { status: 'seller_declined', holdsListing: false });
      }),
    ),

  /**
   * Agree to meet (from an estimate) or suggest another time. Agreeing to meet
   * on an estimate or range is NOT accepting a sale price.
   */
  proposeMeetup: campusVerifiedProcedure
    .input(meetupInput.extend({ id: z.uuid(), estimateVersion: z.number().int() }))
    .mutation(({ ctx, input }) =>
      sellerMutation(ctx.db, input.id, ctx.user.id, async (tx, row) => {
        if (!PROPOSE_MEETUP_FROM.includes(row.status)) conflict('You can’t schedule a meetup for this request right now.');
        if (row.estimateVersion !== input.estimateVersion) conflict('Dibbs updated the estimate. Review the new one first.');
        const spot = await assertMeetup(tx, row, input.spotId, input.startsAt);
        await assertSellerFree(tx, row, input.startsAt);
        const rescheduling = row.status !== 'offered';
        await addEvent(tx, row, {
          actorKind: 'seller',
          actorId: ctx.user.id,
          kind: rescheduling ? 'meetup_rescheduled' : 'agreed_to_meet',
          toStatus: 'meetup_proposed',
          spotId: spot.id,
          startsAt: input.startsAt,
        });
        const next = await update(tx, row, {
          status: 'meetup_proposed',
          meetupSpotId: spot.id,
          meetupStartsAt: input.startsAt,
          meetupProposedBy: 'seller',
        });
        await enqueueTeamEmail(tx, next, 'meetup_proposed');
        return next;
      }),
    ),

  /** Accept the time and place Dibbs proposed. */
  acceptMeetup: campusVerifiedProcedure
    .input(z.object({ id: z.uuid(), expectedVersion: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const out = await sellerMutation(ctx.db, input.id, ctx.user.id, async (tx, row) => {
        if (row.status !== 'meetup_proposed' || row.meetupProposedBy !== 'dibbs') conflict('There is no Dibbs meetup proposal to accept.');
        if (row.version !== input.expectedVersion) conflict('Dibbs changed the meetup. Check the new time first.');
        await addEvent(tx, row, {
          actorKind: 'seller',
          actorId: ctx.user.id,
          kind: 'meetup_confirmed',
          toStatus: 'meetup_confirmed',
          spotId: row.meetupSpotId,
          startsAt: row.meetupStartsAt,
        });
        return confirmMeetup(tx, row);
      });
      return out;
    }),

  cancelMeetup: protectedProcedure
    .input(z.object({ id: z.uuid(), reason: z.string().trim().max(500).optional() }))
    .mutation(({ ctx, input }) =>
      sellerMutation(ctx.db, input.id, ctx.user.id, async (tx, row) => {
        if (row.status !== 'meetup_proposed' && row.status !== 'meetup_confirmed') conflict('There is no meetup to cancel.');
        await releaseDibbsHold(tx, row);
        await addEvent(tx, row, { actorKind: 'seller', actorId: ctx.user.id, kind: 'meetup_cancelled', toStatus: 'offered', message: input.reason ?? null });
        return update(tx, row, {
          status: 'offered',
          holdsListing: false,
          meetupSpotId: null,
          meetupStartsAt: null,
          meetupProposedBy: null,
          meetupConfirmedAt: null,
          estimateExpiresAt: new Date(Date.now() + DIBBS_ESTIMATE_VALID_MS),
        });
      }),
    ),

  /** The seller's explicit answer to the final offer made after inspection. */
  respondToFinalOffer: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        finalOfferVersion: z.number().int(),
        expectedCents: cents,
        decision: z.enum(['accept', 'decline']),
      }),
    )
    .mutation(({ ctx, input }) =>
      sellerMutation(ctx.db, input.id, ctx.user.id, async (tx, row) => {
        if (row.status !== 'final_offer' || row.finalOfferCents == null) conflict('There is no final offer waiting for an answer.');
        if (row.finalOfferVersion !== input.finalOfferVersion || row.finalOfferCents !== input.expectedCents) {
          conflict('Dibbs changed the final offer. Review the new amount before answering.');
        }
        if (input.decision === 'accept') {
          await addEvent(tx, row, {
            actorKind: 'seller',
            actorId: ctx.user.id,
            kind: 'final_accepted',
            toStatus: 'final_accepted',
            low: row.finalOfferCents,
            high: row.finalOfferCents,
          });
          return update(tx, row, { status: 'final_accepted', finalAcceptedCents: row.finalOfferCents, finalAcceptedAt: new Date() });
        }
        await releaseDibbsHold(tx, row);
        await addEvent(tx, row, { actorKind: 'seller', actorId: ctx.user.id, kind: 'final_declined', toStatus: 'final_declined' });
        return update(tx, row, { status: 'final_declined', holdsListing: false });
      }),
    ),

  withdraw: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(({ ctx, input }) =>
    sellerMutation(ctx.db, input.id, ctx.user.id, async (tx, row) => {
      if (!WITHDRAW_FROM.includes(row.status)) conflict('This request is already closed.');
      await releaseDibbsHold(tx, row);
      await addEvent(tx, row, { actorKind: 'seller', actorId: ctx.user.id, kind: 'withdrawn', toStatus: 'withdrawn' });
      return update(tx, row, { status: 'withdrawn', holdsListing: false });
    }),
  ),
});

/* --------------------------------------------------------------- staff */

const QUEUE_FILTERS = {
  open: [...OPEN_STATUSES],
  action: ['submitted', 'in_review', 'meetup_proposed', 'meetup_confirmed', 'final_accepted'],
  closed: ['completed', 'declined', 'seller_declined', 'final_declined', 'withdrawn', 'expired', 'closed'],
} as const satisfies Record<string, readonly DibbsOfferStatus[]>;

async function runStaffAction(db: Db, staffId: string, id: string, expectedVersion: number, action: StaffAction) {
  let push: SellerPushKind | null = null;
  const row = await db.transaction(async (tx) => {
    const cur = await lockRequest(tx, id);
    if (cur.version !== expectedVersion) conflict(STALE_MESSAGE);
    const ev = (kind: string, toStatus: DibbsOfferStatus, extra: Partial<EventInput> = {}) =>
      addEvent(tx, cur, { actorKind: 'staff', actorId: staffId, kind, toStatus, ...extra });

    switch (action.type) {
      case 'start_review': {
        if (cur.status !== 'submitted') conflict('Only a waiting request can be picked up for review.');
        await ev('review_started', 'in_review');
        return update(tx, cur, { status: 'in_review', assignedStaffId: staffId });
      }
      case 'send_estimate': {
        if (!ESTIMATE_FROM.includes(cur.status)) conflict('An estimate can’t be sent at this stage.');
        if (action.highCents < action.lowCents) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'The top of the range must be at least the bottom.' });
        }
        await ev('estimate_sent', 'offered', { low: action.lowCents, high: action.highCents, message: action.message });
        const next = await update(tx, cur, {
          status: 'offered',
          estimateKind: action.lowCents === action.highCents ? 'exact' : 'range',
          estimateLowCents: action.lowCents,
          estimateHighCents: action.highCents,
          estimateVersion: cur.estimateVersion + 1,
          estimateSentAt: new Date(),
          estimateExpiresAt: new Date(Date.now() + DIBBS_ESTIMATE_VALID_MS),
          assignedStaffId: cur.assignedStaffId ?? staffId,
        });
        await enqueueSellerEmail(tx, next, 'estimate');
        push = 'estimate';
        return next;
      }
      case 'request_info': {
        if (!['submitted', 'in_review', 'needs_info'].includes(cur.status)) conflict('You can only ask a question before sending an estimate.');
        await ev('info_requested', 'needs_info', { message: action.message });
        const next = await update(tx, cur, { status: 'needs_info', assignedStaffId: cur.assignedStaffId ?? staffId });
        await enqueueSellerEmail(tx, next, 'needs_info');
        push = 'needs_info';
        return next;
      }
      case 'decline': {
        if (!DECLINE_FROM.includes(cur.status)) conflict('This request can’t be declined at this stage. Close it with an outcome instead.');
        await releaseDibbsHold(tx, cur);
        await ev('declined', 'declined', { message: action.message });
        const next = await update(tx, cur, { status: 'declined', holdsListing: false });
        await enqueueSellerEmail(tx, next, 'declined');
        push = 'declined';
        return next;
      }
      case 'propose_meetup': {
        if (!PROPOSE_MEETUP_FROM.includes(cur.status)) conflict('Send an estimate before proposing a meetup.');
        const spot = await assertMeetup(tx, cur, action.spotId, action.startsAt);
        await assertSellerFree(tx, cur, action.startsAt);
        await ev(cur.status === 'offered' ? 'meetup_proposed' : 'meetup_rescheduled', 'meetup_proposed', {
          spotId: spot.id,
          startsAt: action.startsAt,
        });
        const next = await update(tx, cur, {
          status: 'meetup_proposed',
          meetupSpotId: spot.id,
          meetupStartsAt: action.startsAt,
          meetupProposedBy: 'dibbs',
        });
        await enqueueSellerEmail(tx, next, 'meetup_proposed');
        push = 'meetup_proposed';
        return next;
      }
      case 'confirm_meetup': {
        if (cur.status !== 'meetup_proposed' || cur.meetupProposedBy !== 'seller') conflict('There is no seller-proposed meetup to confirm.');
        await ev('meetup_confirmed', 'meetup_confirmed', { spotId: cur.meetupSpotId, startsAt: cur.meetupStartsAt });
        const next = await confirmMeetup(tx, cur);
        await enqueueSellerEmail(tx, next, 'meetup_confirmed');
        push = 'meetup_confirmed';
        return next;
      }
      case 'cancel_meetup': {
        if (cur.status !== 'meetup_proposed' && cur.status !== 'meetup_confirmed') conflict('There is no meetup to cancel.');
        await releaseDibbsHold(tx, cur);
        await ev('meetup_cancelled', 'offered', { message: action.message });
        push = 'meetup_cancelled';
        return update(tx, cur, {
          status: 'offered',
          holdsListing: false,
          meetupSpotId: null,
          meetupStartsAt: null,
          meetupProposedBy: null,
          meetupConfirmedAt: null,
          estimateExpiresAt: new Date(Date.now() + DIBBS_ESTIMATE_VALID_MS),
        });
      }
      case 'send_final_offer': {
        if (cur.status !== 'meetup_confirmed' && cur.status !== 'final_offer') conflict('A final offer comes after a confirmed meetup and inspection.');
        await ev(cur.status === 'final_offer' ? 'final_offer_revised' : 'final_offer_sent', 'final_offer', {
          low: action.amountCents,
          high: action.amountCents,
          message: action.message,
        });
        push = 'final_offer';
        return update(tx, cur, {
          status: 'final_offer',
          finalOfferCents: action.amountCents,
          finalOfferVersion: cur.finalOfferVersion + 1,
          finalOfferSentAt: new Date(),
        });
      }
      case 'record_completed': {
        if (cur.status !== 'final_accepted') conflict('Record the handoff only after the seller accepts the final offer.');
        await markListingSoldToDibbs(tx, cur);
        await ev('handoff_completed', 'completed');
        return update(tx, cur, { status: 'completed', completedAt: new Date(), holdsListing: false });
      }
      case 'record_payout': {
        if (cur.status !== 'completed') conflict('Record a payout after the handoff is complete.');
        if (cur.payoutStatus !== 'not_recorded') conflict('A payout is already recorded for this request.');
        await ev('payout_recorded_outside_app', 'completed', { message: action.message });
        return update(tx, cur, { payoutStatus: 'recorded_outside_app', payoutRecordedAt: new Date() });
      }
      case 'close': {
        if (!isOpen(cur.status)) conflict('This request is already closed.');
        await releaseDibbsHold(tx, cur);
        await ev('closed', 'closed', { message: action.message ?? null });
        push = 'closed';
        return update(tx, cur, { status: 'closed', closedOutcome: action.outcome, holdsListing: false });
      }
    }
  });
  if (push) await pushSeller(db, row, push);
  return staffDetail(db, row);
}

export const dibbsStaffRouter = router({
  /** Lets the app show the staff queue entry; false for everyone else. */
  amI: protectedProcedure.query(({ ctx }) => ({ isStaff: isDibbsStaff(ctx.user.id) })),

  queue: staffProcedure
    .input(z.object({ filter: z.enum(['open', 'action', 'closed', 'all']).default('open') }))
    .query(async ({ ctx, input }) => {
      await sweep(ctx.db);
      const where = input.filter === 'all' ? undefined : inArray(dibbsOfferRequests.status, [...QUEUE_FILTERS[input.filter]]);
      const rows = await ctx.db
        .select()
        .from(dibbsOfferRequests)
        .where(where)
        // Oldest waiting first for open work; newest first for history.
        .orderBy(input.filter === 'open' || input.filter === 'action' ? asc(dibbsOfferRequests.createdAt) : desc(dibbsOfferRequests.updatedAt))
        .limit(100);
      const covers = await coversFor(ctx.db, rows);
      const people = rows.length
        ? await ctx.db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.sellerId, r.assignedStaffId].filter((x): x is string => !!x)))]))
        : [];
      const now = Date.now();
      return rows.map((r) => ({
        ...summary(r, covers.get(r.id) ?? null),
        version: r.version,
        sellerName: people.find((p) => p.id === r.sellerId)?.displayName ?? 'Unknown',
        assignedStaffName: r.assignedStaffId ? (people.find((p) => p.id === r.assignedStaffId)?.displayName ?? null) : null,
        waitingMinutes: Math.max(0, Math.round((now - r.createdAt.getTime()) / 60_000)),
        staffActionNeeded: staffActionNeeded(r),
        meetupProposedBy: r.meetupProposedBy,
        finalOfferCents: r.finalOfferCents,
      }));
    }),

  byId: staffProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await sweep(ctx.db);
    const [row] = await ctx.db.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.id, input.id)).limit(1);
    if (!row) notFound();
    return staffDetail(ctx.db, row);
  }),

  /** Every state change goes through here, with the version the staff member saw. */
  act: staffProcedure
    .input(z.object({ id: z.uuid(), expectedVersion: z.number().int(), action: staffAction }))
    .mutation(({ ctx, input }) => runStaffAction(ctx.db, ctx.user.id, input.id, input.expectedVersion, input.action)),

  /** Internal note: staff only, never shown to the seller, doesn't change the version. */
  addNote: staffProcedure.input(z.object({ id: z.uuid(), message })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.id, input.id)).limit(1);
    if (!row) notFound();
    await addEvent(ctx.db, row, { actorKind: 'staff', actorId: ctx.user.id, kind: 'note', message: input.message, visibleToSeller: false });
    return staffDetail(ctx.db, row);
  }),
});
