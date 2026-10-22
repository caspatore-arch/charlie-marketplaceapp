import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import {
  availabilityWindows,
  bids,
  listingLikes,
  listingPhotos,
  listingShares,
  listingSpots,
  listings,
  meetupSpots,
  savedListings,
  type Listing,
} from '../../db/schema';
import { enqueueListingPosted } from '../../sms/outbox';
import { ListingDraftError, draftListingFromPhotos } from '../../ai/listing-draft';
import { priceGuide } from '../../price-guide';
import {
  AVAILABILITY_HORIZON_MS,
  LISTING_LIFETIME_MS,
  MEETUP_SLOT_MS,
  expireOffers,
  applyExpiry,
  applyExpiryForRead,
  blockedUserIds,
  localDayBounds,
  toListingCards,
  toListingDetail,
} from '../lib';
import { engagementFor, listingHotExpr, listingHotParts } from '../engagement';
import { upsertListingPostQuietly } from '../listing-post';
import { campusVerifiedProcedure, protectedProcedure, publicProcedure, router } from '../trpc';

/** Below $1 a platform fee cannot round sensibly. */
const MIN_PRICE_CENTS = 100;

/**
 * Auctions were retired. 'auction' is still a parseable value so a stale
 * client gets a clear message instead of a schema error, but it is refused.
 */
const saleTypeSchema = z.enum(['fixed', 'auction']);
const AUCTIONS_RETIRED = 'Auctions have been replaced by an asking price plus offers. Update the app and set a price.';

const MAX_WINDOWS = 8;

/**
 * Availability windows must sit inside "now → the listing's own expiry" (which
 * for a new listing is the rolling next 24 hours), be long enough for one
 * meetup slot, and there can be at most 8. A small grace on the start lets a
 * window that "starts now" survive the round trip.
 */
function assertWindows(
  windows: { startsAt: Date; endsAt: Date }[],
  opts: { now: Date; until: Date; requireOne: boolean },
) {
  if (opts.requireOne && windows.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one time you can meet in the next 24 hours.' });
  }
  if (windows.length > MAX_WINDOWS) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Add up to ${MAX_WINDOWS} meetup windows.` });
  }
  const grace = 15 * 60 * 1000;
  for (const w of windows) {
    if (w.endsAt.getTime() <= opts.now.getTime() || w.startsAt.getTime() < opts.now.getTime() - grace) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meetup windows have to be in the future.' });
    }
    if (w.endsAt.getTime() > opts.until.getTime() + 60_000) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Meetup windows have to end within 24 hours — the listing expires then.',
      });
    }
    if (w.endsAt.getTime() - Math.max(w.startsAt.getTime(), opts.now.getTime()) < MEETUP_SLOT_MS) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Each window needs room for at least one 15-minute meetup.' });
    }
  }
}

const categorySchema = z.enum([
  'clothing',
  'shoes',
  'jewelry',
  'accessories',
  'dorm',
  'books',
  'tech',
  'other',
]);
const conditionSchema = z.enum(['new', 'like_new', 'good', 'fair']);

const windowSchema = z
  .object({ startsAt: z.coerce.date(), endsAt: z.coerce.date() })
  .refine((w) => w.endsAt > w.startsAt, 'A pickup window has to end after it starts.');

const listingFields = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  category: categorySchema,
  condition: conditionSchema,
  /** Required for a fixed-price listing; ignored for an auction. */
  priceCents: z.number().int().min(0).max(5_000_00),
  saleType: saleTypeSchema,
  startPriceCents: z.number().int().min(0).max(5_000_00).nullish(),
  buyoutPriceCents: z.number().int().min(0).max(5_000_00).nullish(),
  size: z.string().max(40).optional(),
  brand: z.string().max(60).optional(),
  isSellToday: z.boolean(),
  photoUrls: z.array(z.string().min(1).max(500)).min(1).max(8),
  spotIds: z.array(z.uuid()).min(1),
  windows: z.array(windowSchema),
});

/** Fixed asking price only. Rejects stale auction submissions with a clear message. */
function checkPriceFields(
  v: { saleType?: 'fixed' | 'auction'; priceCents?: number | null },
  ctx: z.RefinementCtx,
): void {
  if (v.saleType === 'auction') {
    ctx.addIssue({ code: 'custom', path: ['saleType'], message: AUCTIONS_RETIRED });
    return;
  }
  if (v.priceCents == null || v.priceCents < MIN_PRICE_CENTS) {
    ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Set an asking price of at least $1.' });
  }
}

const createInput = listingFields
  .extend({
    windows: z.array(windowSchema).default([]),
    saleType: saleTypeSchema.default('fixed'),
  })
  .superRefine(checkPriceFields);

// Every field optional on update — and deliberately WITHOUT the `windows`
// default, so omitting windows leaves the seller's existing ones alone.
// Auction cross-field rules are checked in the handler against the merged row.
const updateInput = listingFields.partial().extend({ id: z.uuid() });

/** Count of bids already placed on a (legacy auction) listing. */
async function bidCountFor(db: Db, listingId: string): Promise<number> {
  const rows = await db.select({ id: bids.id }).from(bids).where(eq(bids.listingId, listingId));
  return rows.length;
}

/** Loads a listing the caller owns, or throws NOT_FOUND / FORBIDDEN. */
async function loadOwnListing(db: Db, id: string, userId: string) {
  const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
  if (listing.sellerId !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This listing belongs to someone else.' });
  }
  return listing;
}

/** Validates spot ids belong to the campus, then rewrites the join rows. */
async function replaceSpots(db: Db, listingId: string, campusId: string, spotIds: string[]) {
  const spots = await db
    .select({ id: meetupSpots.id })
    .from(meetupSpots)
    .where(and(inArray(meetupSpots.id, spotIds), eq(meetupSpots.campusId, campusId)));
  if (spots.length !== new Set(spotIds).size) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick a meetup spot on your campus.' });
  }
  await db.delete(listingSpots).where(eq(listingSpots.listingId, listingId));
  await db.insert(listingSpots).values(spots.map((s) => ({ listingId, spotId: s.id })));
}

async function replacePhotos(db: Db, listingId: string, urls: string[]) {
  await db.delete(listingPhotos).where(eq(listingPhotos.listingId, listingId));
  await db
    .insert(listingPhotos)
    .values(urls.map((url, i) => ({ listingId, url, sortOrder: i })));
}

async function replaceWindows(
  db: Db,
  listingId: string,
  windows: { startsAt: Date; endsAt: Date }[],
) {
  await db.delete(availabilityWindows).where(eq(availabilityWindows.listingId, listingId));
  if (windows.length > 0) {
    await db.insert(availabilityWindows).values(windows.map((w) => ({ listingId, ...w })));
  }
}

const hotCursorSchema = z.object({
  score: z.number().finite(),
  asOf: z.number().int(),
  createdAt: z.number().int(),
  id: z.uuid(),
});

/** Feed cards plus each listing's likes, shares and preview comments (one grouped read per signal). */
async function withEngagement(db: Db, rows: Listing[], viewerId: string | null) {
  const [cards, engagement] = await Promise.all([
    toListingCards(db, rows),
    engagementFor(db, rows.map((l) => l.id), viewerId),
  ]);
  return cards.map((card) => ({ ...card, engagement: engagement.get(card.id)! }));
}

/**
 * A listing the viewer may like or share: live (active, not past its deadline),
 * on their campus, and not owned by anyone in a block relationship with them.
 * Anything else reads as gone, like the feed.
 */
async function loadReactable(db: Db, id: string, viewer: { id: string; campusId: string }): Promise<Listing> {
  const gone = () => new TRPCError({ code: 'NOT_FOUND', message: 'That item is no longer available.' });
  const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  if (
    !listing ||
    listing.campusId !== viewer.campusId ||
    listing.status !== 'active' ||
    (listing.expiresAt !== null && listing.expiresAt.getTime() <= Date.now())
  ) {
    throw gone();
  }
  if (listing.sellerId !== viewer.id) {
    const hidden = await blockedUserIds(db, viewer.id);
    if (hidden.includes(listing.sellerId)) throw gone();
  }
  return listing;
}

export const listingRouter = router({
  feed: publicProcedure
    .input(
      z.object({
        campusId: z.uuid(),
        q: z.string().trim().min(1).max(80).optional(),
        category: categorySchema.optional(),
        minCents: z.number().int().min(0).optional(),
        maxCents: z.number().int().min(0).optional(),
        size: z.string().max(40).optional(),
        pickupToday: z.boolean().optional(),
        /** 'new' (default) is strictly newest first. 'hot' ranks by recent likes, comments and shares. */
        sort: z.enum(['new', 'hot']).default('new'),
        cursor: z.string().max(300).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await applyExpiryForRead(ctx.db);
      const hot = input.sort === 'hot';

      const conditions = [
        eq(listings.campusId, input.campusId),
        eq(listings.status, 'active'),
        // Expiry is swept on a timer for reads (applyExpiryForRead), so a row
        // can briefly still say 'active' after its deadline. Filtering here
        // means the feed is correct regardless of when the last sweep ran —
        // the sweep only has to catch up on the stored status.
        or(isNull(listings.expiresAt), gt(listings.expiresAt, new Date()))!,
      ];
      if (input.category) conditions.push(eq(listings.category, input.category));
      if (input.minCents !== undefined) conditions.push(gte(listings.priceCents, input.minCents));
      if (input.maxCents !== undefined) conditions.push(lte(listings.priceCents, input.maxCents));
      if (input.size) conditions.push(eq(listings.size, input.size));
      if (input.q) {
        // Escape ILIKE wildcards in the user's input before wrapping it in %...%.
        const escaped = input.q.replace(/[\\%_]/g, (c) => `\\${c}`);
        const pattern = `%${escaped}%`;
        conditions.push(
          or(
            ilike(listings.title, pattern),
            ilike(listings.brand, pattern),
            ilike(listings.description, pattern),
          )!,
        );
      }

      // Hide listings from anyone in a block relationship with the viewer.
      const hidden = ctx.user ? await blockedUserIds(ctx.db, ctx.user.id) : [];
      if (hidden.length > 0) conditions.push(notInArray(listings.sellerId, hidden));

      if (input.pickupToday) {
        const { end } = localDayBounds('America/Phoenix');
        conditions.push(
          sql`exists (select 1 from ${availabilityWindows} w
                     where w.listing_id = ${listings.id}
                       and w.starts_at <= ${end.toISOString()}
                       and w.ends_at >= now())`,
        );
      }

      if (hot) {
        // The Hottest score depends on the clock, so the cursor freezes `asOf`
        // from the first page and later pages are scored at that same instant.
        let cursor: z.infer<typeof hotCursorSchema> | null = null;
        if (input.cursor) {
          try {
            cursor = hotCursorSchema.parse(JSON.parse(input.cursor));
          } catch {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor.' });
          }
        }
        const asOf = cursor ? new Date(cursor.asOf) : new Date();
        const parts = listingHotParts(ctx.db, asOf, hidden);
        const scoreExpr = listingHotExpr(parts);
        if (cursor) {
          const cAt = new Date(cursor.createdAt);
          conditions.push(
            or(
              sql`${scoreExpr} < ${cursor.score}::float8`,
              and(
                sql`${scoreExpr} = ${cursor.score}::float8`,
                or(lt(listings.createdAt, cAt), and(eq(listings.createdAt, cAt), lt(listings.id, cursor.id))),
              ),
            )!,
          );
        }
        const rows = await ctx.db
          .select({ listing: listings, score: scoreExpr })
          .from(listings)
          .leftJoin(parts.likes, eq(parts.likes.listingId, listings.id))
          .leftJoin(parts.comments, eq(parts.comments.listingId, listings.id))
          .leftJoin(parts.shares, eq(parts.shares.listingId, listings.id))
          .where(and(...conditions))
          .orderBy(sql`${scoreExpr} desc`, desc(listings.createdAt), desc(listings.id))
          .limit(input.limit + 1);
        const page = rows.slice(0, input.limit);
        const last = rows.length > input.limit ? page[page.length - 1] : undefined;
        return {
          items: await withEngagement(ctx.db, page.map((r) => r.listing), ctx.user?.id ?? null),
          nextCursor: last
            ? JSON.stringify({
                score: Number(last.score),
                asOf: asOf.getTime(),
                createdAt: last.listing.createdAt.getTime(),
                id: last.listing.id,
              })
            : undefined,
        };
      }

      // Keyset pagination on (createdAt, id) so new listings never shift a page.
      if (input.cursor) {
        const [createdAtRaw, id] = input.cursor.split('|');
        const createdAt = new Date(createdAtRaw!);
        conditions.push(
          or(
            lt(listings.createdAt, createdAt),
            and(eq(listings.createdAt, createdAt), lt(listings.id, id!)),
          )!,
        );
      }

      const rows = await ctx.db
        .select()
        .from(listings)
        .where(and(...conditions))
        .orderBy(desc(listings.createdAt), desc(listings.id))
        .limit(input.limit + 1);

      const page = rows.slice(0, input.limit);
      const next = rows.length > input.limit ? page[page.length - 1] : undefined;

      return {
        items: await withEngagement(ctx.db, page, ctx.user?.id ?? null),
        nextCursor: next ? `${next.createdAt.toISOString()}|${next.id}` : undefined,
      };
    }),

  byId: publicProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await applyExpiryForRead(ctx.db);
    const [listing] = await ctx.db.select().from(listings).where(eq(listings.id, input.id)).limit(1);
    if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
    return toListingDetail(ctx.db, listing, ctx.user?.id ?? null);
  }),

  bySeller: publicProcedure
    .input(z.object({ sellerId: z.uuid(), includeSold: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      await applyExpiryForRead(ctx.db);
      const statuses = input.includeSold
        ? (['active', 'reserved', 'sold'] as const)
        : (['active', 'reserved'] as const);
      const rows = await ctx.db
        .select()
        .from(listings)
        .where(and(eq(listings.sellerId, input.sellerId), inArray(listings.status, [...statuses])))
        .orderBy(desc(listings.createdAt));
      return toListingCards(ctx.db, rows);
    }),

  mine: protectedProcedure.query(async ({ ctx }) => {
    await applyExpiryForRead(ctx.db);
    const rows = await ctx.db
      .select()
      .from(listings)
      .where(eq(listings.sellerId, ctx.user.id))
      .orderBy(desc(listings.createdAt));
    return toListingCards(ctx.db, rows);
  }),

  create: campusVerifiedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const now = new Date();
    // Every listing lives exactly 24 hours, whoever posted it.
    const expiresAt = new Date(now.getTime() + LISTING_LIFETIME_MS);
    assertWindows(input.windows, { now, until: expiresAt, requireOne: true });

    const [listing] = await ctx.db
      .insert(listings)
      .values({
        sellerId: ctx.user.id,
        campusId: ctx.user.campusId,
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        condition: input.condition,
        priceCents: input.priceCents,
        saleType: 'fixed',
        startPriceCents: null,
        buyoutPriceCents: null,
        size: input.size ?? null,
        brand: input.brand ?? null,
        status: 'active',
        isSellToday: input.isSellToday,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await replacePhotos(ctx.db, listing!.id, input.photoUrls);
    await replaceSpots(ctx.db, listing!.id, ctx.user.campusId, input.spotIds);
    await replaceWindows(ctx.db, listing!.id, input.windows);
    await enqueueListingPosted(ctx.db, listing!.id);
    await upsertListingPostQuietly(ctx.db, listing!);

    return toListingDetail(ctx.db, listing!, ctx.user.id);
  }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadOwnListing(ctx.db, input.id, ctx.user.id);

      if (existing.saleType === 'auction') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This listing was posted as an auction and closes at its original end time. Relist it with an asking price afterwards.',
        });
      }
      if (input.saleType === 'auction') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: AUCTIONS_RETIRED });
      }
      if (input.priceCents !== undefined && input.priceCents < MIN_PRICE_CENTS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Set an asking price of at least $1.' });
      }
      if (input.windows) {
        assertWindows(input.windows, {
          now: new Date(),
          until: existing.expiresAt ?? new Date(Date.now() + AVAILABILITY_HORIZON_MS),
          requireOne: true,
        });
      }

      const patch: Partial<typeof listings.$inferInsert> = { updatedAt: new Date() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.category !== undefined) patch.category = input.category;
      if (input.condition !== undefined) patch.condition = input.condition;
      if (input.size !== undefined) patch.size = input.size;
      if (input.brand !== undefined) patch.brand = input.brand;
      // A new asking price applies to new bookings only: confirmed bookings keep
      // their price snapshot, and pending offers keep askingPriceCents.
      if (input.priceCents !== undefined) patch.priceCents = input.priceCents;
      if (input.isSellToday !== undefined) patch.isSellToday = input.isSellToday;
      // Deliberately never touches expiresAt: an edit must not extend the 24h.

      const [updated] = await ctx.db
        .update(listings)
        .set(patch)
        .where(eq(listings.id, existing.id))
        .returning();

      if (input.photoUrls) await replacePhotos(ctx.db, existing.id, input.photoUrls);
      if (input.spotIds) await replaceSpots(ctx.db, existing.id, existing.campusId, input.spotIds);
      if (input.windows) await replaceWindows(ctx.db, existing.id, input.windows);

      return toListingDetail(ctx.db, updated!, ctx.user.id);
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadOwnListing(ctx.db, input.id, ctx.user.id);
      if (existing.saleType === 'auction' && (await bidCountFor(ctx.db, existing.id)) > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: "This auction already has bids, so it can't be removed.",
        });
      }
      await ctx.db
        .update(listings)
        .set({ status: 'removed', updatedAt: new Date() })
        .where(eq(listings.id, existing.id));
      await expireOffers(ctx.db);
      return { ok: true as const };
    }),

  relist: campusVerifiedProcedure
    .input(
      z.object({
        id: z.uuid(),
        isSellToday: z.boolean(),
        /** New asking price; omit to keep the old one (or the old start price for a legacy auction). */
        priceCents: z.number().int().min(0).max(5_000_00).optional(),
        /** Fresh availability for the new 24 hours. Omit to relist with none (add it in Edit). */
        windows: z.array(windowSchema).optional(),
        /** Legacy fields from old clients; 'auction' is refused. */
        saleType: saleTypeSchema.optional(),
        startPriceCents: z.number().int().min(0).max(5_000_00).nullish(),
        buyoutPriceCents: z.number().int().min(0).max(5_000_00).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The archive shows listings past their deadline even if the periodic
      // sweep hasn't flipped the stored status yet; settle it before checking.
      await applyExpiry(ctx.db);
      const existing = await loadOwnListing(ctx.db, input.id, ctx.user.id);
      if (existing.status !== 'expired' && existing.status !== 'removed') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Only expired or removed items can be relisted.',
        });
      }
      if (input.saleType === 'auction') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: AUCTIONS_RETIRED });
      }
      const priceCents = input.priceCents ?? existing.startPriceCents ?? existing.priceCents;
      if (priceCents < MIN_PRICE_CENTS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Set an asking price of at least $1.' });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + LISTING_LIFETIME_MS);
      if (input.windows) assertWindows(input.windows, { now, until: expiresAt, requireOne: false });

      // Bid history of a legacy auction is kept, not deleted: the relisted
      // item is fixed-price, so those rows simply stop mattering.
      const [updated] = await ctx.db
        .update(listings)
        .set({
          status: 'active',
          saleType: 'fixed',
          startPriceCents: null,
          buyoutPriceCents: null,
          priceCents,
          isSellToday: input.isSellToday,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .where(eq(listings.id, existing.id))
        .returning();
      await replaceWindows(ctx.db, existing.id, input.windows ?? []);
      await enqueueListingPosted(ctx.db, existing.id);
      await upsertListingPostQuietly(ctx.db, updated!);
      return toListingDetail(ctx.db, updated!, ctx.user.id);
    }),

  // Without `saved` this flips the current state (the heart button). With it,
  // it sets that state — a swipe says "save this", and swiping right on an
  // item you had already saved must not quietly unsave it.
  toggleSave: protectedProcedure
    .input(z.object({ id: z.uuid(), saved: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [listing] = await ctx.db
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.id, input.id))
        .limit(1);
      if (!listing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
      }

      const where = and(
        eq(savedListings.userId, ctx.user.id),
        eq(savedListings.listingId, input.id),
      );
      const existing = await ctx.db.select().from(savedListings).where(where).limit(1);
      const want = input.saved ?? existing.length === 0;
      if (!want) {
        if (existing.length > 0) await ctx.db.delete(savedListings).where(where);
        return { saved: false };
      }
      if (existing.length === 0) {
        await ctx.db
          .insert(savedListings)
          .values({ userId: ctx.user.id, listingId: input.id })
          .onConflictDoNothing();
      }
      return { saved: true };
    }),

  /**
   * Set (not toggle) the viewer's like. Idempotent by design: a double-tap or a
   * retry sends the same target state and cannot flip it back or add a second
   * row (the (listing_id, user_id) primary key makes a duplicate insert a
   * no-op even under concurrency). A like is public popularity; Saved stays
   * the private bookmark and is untouched by this.
   */
  setLike: protectedProcedure
    .input(z.object({ id: z.uuid(), liked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.liked) {
        const listing = await loadReactable(ctx.db, input.id, ctx.user);
        await ctx.db
          .insert(listingLikes)
          .values({ listingId: listing.id, userId: ctx.user.id })
          .onConflictDoNothing();
      } else {
        // Taking a like back never needs the listing to still be live.
        await ctx.db
          .delete(listingLikes)
          .where(and(eq(listingLikes.listingId, input.id), eq(listingLikes.userId, ctx.user.id)));
      }
      const [row] = await ctx.db
        .select({ total: count() })
        .from(listingLikes)
        .where(eq(listingLikes.listingId, input.id));
      return { id: input.id, likeCount: Number(row?.total ?? 0), viewerLiked: input.liked };
    }),

  /**
   * Records that the viewer shared this listing, under the one rule in
   * docs/CONTRACT.md "Likes, shares and Hottest": the client calls this only
   * after the OS/browser share sheet handed the link over without being
   * cancelled, or after the link was copied. One row per person per listing, so
   * retries and repeat shares never inflate the count. The server cannot see
   * what the other app did with the link, and nothing here claims it posted.
   */
  recordShare: protectedProcedure
    .input(z.object({ id: z.uuid(), via: z.enum(['share_sheet', 'copy_link']) }))
    .mutation(async ({ ctx, input }) => {
      const listing = await loadReactable(ctx.db, input.id, ctx.user);
      const inserted = await ctx.db
        .insert(listingShares)
        .values({ listingId: listing.id, userId: ctx.user.id, via: input.via })
        .onConflictDoNothing()
        .returning({ listingId: listingShares.listingId });
      const [row] = await ctx.db
        .select({ total: count() })
        .from(listingShares)
        .where(eq(listingShares.listingId, listing.id));
      return { id: listing.id, shareCount: Number(row?.total ?? 0), viewerShared: true, counted: inserted.length > 0 };
    }),

  saved: protectedProcedure.query(async ({ ctx }) => {
    await applyExpiryForRead(ctx.db);
    const rows = await ctx.db
      .select({ listing: listings })
      .from(savedListings)
      .innerJoin(listings, eq(listings.id, savedListings.listingId))
      .where(eq(savedListings.userId, ctx.user.id))
      .orderBy(desc(savedListings.createdAt));
    return toListingCards(
      ctx.db,
      rows.map((r) => r.listing),
    );
  }),

  /**
   * Sell form "Fill in from photos". Reads the photos back from upload
   * storage and drafts the fields. Simulated unless LISTING_AI_MODE=live.
   * Capped per user because each live call costs money.
   */
  draftFromPhotos: campusVerifiedProcedure
    .input(z.object({ photoUrls: z.array(z.string().min(1).max(500)).min(1).max(4) }))
    .mutation(async ({ ctx, input }) => {
      if (!takeDraftAllowance(ctx.user.id)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'You have used autofill a lot this hour. Fill in the details yourself, or try again later.',
        });
      }
      try {
        return await draftListingFromPhotos(input.photoUrls);
      } catch (err) {
        if (err instanceof ListingDraftError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),

  /** Average price of similar items, for the Sell form's price bar. */
  priceGuide: protectedProcedure
    .input(
      z.object({
        category: categorySchema,
        title: z.string().max(120).optional(),
        excludeListingId: z.uuid().optional(),
      }),
    )
    .query(({ ctx, input }) => priceGuide(ctx.db, input)),
});

/* -------------------------------------------- autofill per-user allowance */

const DRAFTS_PER_HOUR = 15;
const draftUse = new Map<string, number[]>();

/** In-memory, single-instance like backend/ratelimit.ts. */
function takeDraftAllowance(userId: string): boolean {
  const now = Date.now();
  const recent = (draftUse.get(userId) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= DRAFTS_PER_HOUR) {
    draftUse.set(userId, recent);
    return false;
  }
  recent.push(now);
  draftUse.set(userId, recent);
  return true;
}
