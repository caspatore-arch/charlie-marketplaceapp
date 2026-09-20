import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import {
  availabilityWindows,
  bids,
  listingPhotos,
  listingSpots,
  listings,
  meetupSpots,
  savedListings,
} from '../../db/schema';
import {
  AUCTION_TTL_MS,
  applyExpiry,
  applyExpiryForRead,
  blockedUserIds,
  localDayBounds,
  toListingCards,
  toListingDetail,
} from '../lib';
import { protectedProcedure, publicProcedure, router } from '../trpc';

const SELL_TODAY_TTL_MS = 24 * 60 * 60 * 1000;

/** docs/AUCTIONS.md §1: below $1 a platform fee cannot round sensibly. */
const MIN_START_PRICE_CENTS = 100;

const saleTypeSchema = z.enum(['fixed', 'auction']);

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

/**
 * Cross-field auction rules from docs/AUCTIONS.md §1. Shared by create and
 * relist; `update` runs the same checks against the merged row in the handler,
 * because a partial update may only send one of the three fields.
 */
function checkAuctionFields(
  v: {
    saleType?: 'fixed' | 'auction';
    priceCents?: number | null;
    startPriceCents?: number | null;
    buyoutPriceCents?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (v.saleType !== 'auction') {
    if (v.priceCents == null || v.priceCents <= 0) {
      ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Enter a price above $0.' });
    }
    return;
  }
  if (v.startPriceCents == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['startPriceCents'],
      message: 'Set a start price for your auction.',
    });
  } else if (v.startPriceCents < MIN_START_PRICE_CENTS) {
    ctx.addIssue({
      code: 'custom',
      path: ['startPriceCents'],
      message: 'The start price has to be at least $1.',
    });
  }
  if (
    v.buyoutPriceCents != null &&
    v.startPriceCents != null &&
    v.buyoutPriceCents <= v.startPriceCents
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['buyoutPriceCents'],
      message: 'Buy it now has to be more than the start price.',
    });
  }
}

const createInput = listingFields
  .extend({
    windows: z.array(windowSchema).default([]),
    saleType: saleTypeSchema.default('fixed'),
  })
  .superRefine(checkAuctionFields);

// Every field optional on update — and deliberately WITHOUT the `windows`
// default, so omitting windows leaves the seller's existing ones alone.
// Auction cross-field rules are checked in the handler against the merged row.
const updateInput = listingFields.partial().extend({ id: z.uuid() });

/** Count of bids already placed on a listing. */
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
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await applyExpiryForRead(ctx.db);

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
      if (ctx.user) {
        const hidden = await blockedUserIds(ctx.db, ctx.user.id);
        if (hidden.length > 0) conditions.push(notInArray(listings.sellerId, hidden));
      }

      if (input.pickupToday) {
        const { end } = localDayBounds('America/Phoenix');
        conditions.push(
          sql`exists (select 1 from ${availabilityWindows} w
                     where w.listing_id = ${listings.id}
                       and w.starts_at <= ${end.toISOString()}
                       and w.ends_at >= now())`,
        );
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
        items: await toListingCards(ctx.db, page),
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

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const isAuction = input.saleType === 'auction';
    // An auction's `priceCents` mirrors its start price so every existing
    // price filter, sort and card keeps working without special-casing.
    const priceCents = isAuction ? input.startPriceCents! : input.priceCents;

    const [listing] = await ctx.db
      .insert(listings)
      .values({
        sellerId: ctx.user.id,
        campusId: ctx.user.campusId,
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        condition: input.condition,
        priceCents,
        saleType: input.saleType,
        startPriceCents: isAuction ? input.startPriceCents! : null,
        buyoutPriceCents: isAuction ? (input.buyoutPriceCents ?? null) : null,
        size: input.size ?? null,
        brand: input.brand ?? null,
        status: 'active',
        // An auction always runs 24h; "Sell today" is a fixed-price idea.
        isSellToday: isAuction ? false : input.isSellToday,
        expiresAt: isAuction
          ? new Date(now.getTime() + AUCTION_TTL_MS)
          : input.isSellToday
            ? new Date(now.getTime() + SELL_TODAY_TTL_MS)
            : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await replacePhotos(ctx.db, listing!.id, input.photoUrls);
    await replaceSpots(ctx.db, listing!.id, ctx.user.campusId, input.spotIds);
    await replaceWindows(ctx.db, listing!.id, input.windows);

    return toListingDetail(ctx.db, listing!, ctx.user.id);
  }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadOwnListing(ctx.db, input.id, ctx.user.id);

      // docs/AUCTIONS.md §1 rule 6: once an auction has a bid the price is a
      // commitment to the bidders, so price fields and the sale type freeze.
      const placedBids = existing.saleType === 'auction' ? await bidCountFor(ctx.db, existing.id) : 0;
      const touchesPrice =
        (input.priceCents !== undefined && input.priceCents !== existing.priceCents) ||
        (input.startPriceCents !== undefined && input.startPriceCents !== existing.startPriceCents) ||
        (input.buyoutPriceCents !== undefined &&
          input.buyoutPriceCents !== existing.buyoutPriceCents) ||
        (input.saleType !== undefined && input.saleType !== existing.saleType);
      if (placedBids > 0 && touchesPrice) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: "This auction already has bids, so its prices can't change.",
        });
      }

      const merged = {
        saleType: input.saleType ?? existing.saleType,
        priceCents: input.priceCents ?? existing.priceCents,
        startPriceCents:
          input.startPriceCents !== undefined ? input.startPriceCents : existing.startPriceCents,
        buyoutPriceCents:
          input.buyoutPriceCents !== undefined ? input.buyoutPriceCents : existing.buyoutPriceCents,
      };
      const parsed = z
        .object({})
        .passthrough()
        .superRefine((_v, c) => checkAuctionFields(merged, c))
        .safeParse({});
      if (!parsed.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: parsed.error.issues[0]?.message ?? 'Check the price fields.',
        });
      }

      const patch: Partial<typeof listings.$inferInsert> = { updatedAt: new Date() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.category !== undefined) patch.category = input.category;
      if (input.condition !== undefined) patch.condition = input.condition;
      if (input.size !== undefined) patch.size = input.size;
      if (input.brand !== undefined) patch.brand = input.brand;

      if (merged.saleType === 'auction') {
        patch.saleType = 'auction';
        patch.startPriceCents = merged.startPriceCents!;
        patch.buyoutPriceCents = merged.buyoutPriceCents ?? null;
        patch.priceCents = merged.startPriceCents!;
        patch.isSellToday = false;
        // Switching a fixed-price listing to an auction starts the 24h clock.
        if (existing.saleType !== 'auction') {
          patch.expiresAt = new Date(Date.now() + AUCTION_TTL_MS);
        }
      } else {
        patch.saleType = 'fixed';
        patch.startPriceCents = null;
        patch.buyoutPriceCents = null;
        if (input.priceCents !== undefined) patch.priceCents = input.priceCents;
        if (input.isSellToday !== undefined) {
          patch.isSellToday = input.isSellToday;
          patch.expiresAt = input.isSellToday
            ? new Date(existing.createdAt.getTime() + SELL_TODAY_TTL_MS)
            : null;
        } else if (existing.saleType === 'auction') {
          patch.expiresAt = null;
        }
      }

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
      return { ok: true as const };
    }),

  relist: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        isSellToday: z.boolean(),
        saleType: saleTypeSchema.optional(),
        startPriceCents: z.number().int().min(0).max(5_000_00).nullish(),
        buyoutPriceCents: z.number().int().min(0).max(5_000_00).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadOwnListing(ctx.db, input.id, ctx.user.id);
      if (existing.status !== 'expired' && existing.status !== 'removed') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Only expired or removed items can be relisted.',
        });
      }

      const saleType = input.saleType ?? existing.saleType;
      const startPriceCents =
        input.startPriceCents !== undefined ? input.startPriceCents : existing.startPriceCents;
      const buyoutPriceCents =
        input.buyoutPriceCents !== undefined ? input.buyoutPriceCents : existing.buyoutPriceCents;

      if (saleType === 'auction') {
        const check = z
          .object({})
          .passthrough()
          .superRefine((_v, c) =>
            checkAuctionFields({ saleType, startPriceCents, buyoutPriceCents }, c),
          )
          .safeParse({});
        if (!check.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: check.error.issues[0]?.message ?? 'Check the auction prices.',
          });
        }
        // A new auction is a new auction: the old bids do not carry over.
        await ctx.db.delete(bids).where(eq(bids.listingId, existing.id));
      }

      const now = new Date();
      const [updated] = await ctx.db
        .update(listings)
        .set({
          status: 'active',
          saleType,
          startPriceCents: saleType === 'auction' ? startPriceCents! : null,
          buyoutPriceCents: saleType === 'auction' ? (buyoutPriceCents ?? null) : null,
          priceCents: saleType === 'auction' ? startPriceCents! : existing.priceCents,
          isSellToday: saleType === 'auction' ? false : input.isSellToday,
          expiresAt:
            saleType === 'auction'
              ? new Date(now.getTime() + AUCTION_TTL_MS)
              : input.isSellToday
                ? new Date(now.getTime() + SELL_TODAY_TTL_MS)
                : null,
          createdAt: now,
          updatedAt: now,
        })
        .where(eq(listings.id, existing.id))
        .returning();
      return toListingDetail(ctx.db, updated!, ctx.user.id);
    }),

  toggleSave: protectedProcedure
    .input(z.object({ id: z.uuid() }))
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
      if (existing.length > 0) {
        await ctx.db.delete(savedListings).where(where);
        return { saved: false };
      }
      await ctx.db.insert(savedListings).values({ userId: ctx.user.id, listingId: input.id });
      return { saved: true };
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
});
