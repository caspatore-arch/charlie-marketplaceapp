/**
 * Auction bidding — docs/AUCTIONS.md §1.
 *
 * Every write that reads the listing before changing it runs inside a
 * transaction with `SELECT ... FOR UPDATE` on the listing row, the same shape
 * as `reservation.accept`. Two bids landing at once therefore serialize, and a
 * buyout can never race a bid into two winners.
 */
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { bids, listings, reservations, users, type Listing } from '../../db/schema';
import { notifyOutbid } from '../../notifications/events';
import {
  ANTI_SNIPE_MS,
  applyExpiry,
  applyExpiryForRead,
  bidIncrementCents,
  isBlockedBetween,
  minNextBidCents,
  openingProposalFor,
  toListingCards,
  toPublicUser,
} from '../lib';
import { protectedProcedure, publicProcedure, router } from '../trpc';

import type { Db } from '../../db/client';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

/**
 * Preconditions shared by `place` and `buyout`, re-checked INSIDE the row lock.
 * Throws with the exact message the UI shows the user.
 */
function assertBiddable(listing: Listing | undefined, userId: string, now: Date): asserts listing is Listing {
  if (!listing) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
  if (listing.saleType !== 'auction') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This item has a fixed price — request a meetup instead.',
    });
  }
  if (listing.sellerId === userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "You can't bid on your own listing." });
  }
  if (listing.status !== 'active') {
    throw new TRPCError({ code: 'CONFLICT', message: 'This auction is no longer open.' });
  }
  if (!listing.expiresAt || listing.expiresAt <= now) {
    throw new TRPCError({ code: 'CONFLICT', message: 'This auction has ended.' });
  }
}

/** Loads the listing (unlocked) purely to run the block check before the tx. */
async function assertNotBlocked(db: Db, listingId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ sellerId: listings.sellerId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!row) return;
  if (await isBlockedBetween(db, row.sellerId, userId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "You can't bid on this listing." });
  }
}

export const bidRouter = router({
  /**
   * Public bid history, newest first. Bidders are exposed as display names
   * only — never an email, never anything else private.
   */
  forListing: publicProcedure
    .input(z.object({ listingId: z.uuid(), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      await applyExpiryForRead(ctx.db);

      const rows = await ctx.db
        .select()
        .from(bids)
        .where(eq(bids.listingId, input.listingId))
        .orderBy(desc(bids.createdAt), desc(bids.amountCents))
        .limit(input.limit);

      if (rows.length === 0) return [];

      const bidders = await ctx.db
        .select()
        .from(users)
        .where(inArray(users.id, [...new Set(rows.map((b) => b.bidderId))]));
      const byId = new Map(bidders.map((u) => [u.id, u]));

      return rows.map((b) => ({
        id: b.id,
        listingId: b.listingId,
        amountCents: b.amountCents,
        createdAt: b.createdAt,
        bidder: toPublicUser(byId.get(b.bidderId)!),
      }));
    }),

  /** The caller's own bids, newest first, with the listing card for each. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    await applyExpiryForRead(ctx.db);

    const rows = await ctx.db
      .select()
      .from(bids)
      .where(eq(bids.bidderId, ctx.user.id))
      .orderBy(desc(bids.createdAt));
    if (rows.length === 0) return [];

    const listingRows = await ctx.db
      .select()
      .from(listings)
      .where(inArray(listings.id, [...new Set(rows.map((b) => b.listingId))]));
    const cards = await toListingCards(ctx.db, listingRows);
    const cardById = new Map(cards.map((c) => [c.id, c]));

    return rows.map((b) => ({
      id: b.id,
      amountCents: b.amountCents,
      createdAt: b.createdAt,
      listing: cardById.get(b.listingId)!,
      isTopBid: cardById.get(b.listingId)?.currentPriceCents === b.amountCents,
    }));
  }),

  /** Place a bid. A bid is a commitment to buy, not a reservation. */
  place: protectedProcedure
    .input(z.object({ listingId: z.uuid(), amountCents: z.number().int().min(100).max(5_000_00) }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      await assertNotBlocked(ctx.db, input.listingId, ctx.user.id);

      return ctx.db.transaction(async (tx) => {
        const now = new Date();
        const [listing] = await tx
          .select()
          .from(listings)
          .where(eq(listings.id, input.listingId))
          .for('update')
          .limit(1);
        assertBiddable(listing, ctx.user.id, now);

        const [top] = await tx
          .select()
          .from(bids)
          .where(eq(bids.listingId, listing.id))
          .orderBy(desc(bids.amountCents), asc(bids.createdAt))
          .limit(1);

        const startPrice = listing.startPriceCents ?? listing.priceCents;
        const currentPriceCents = top ? top.amountCents : startPrice;
        const hasBids = !!top;
        const minimum = minNextBidCents(currentPriceCents, hasBids);

        if (input.amountCents < minimum) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: hasBids
              ? `Bids have to be at least ${money(minimum)} — ${money(bidIncrementCents(currentPriceCents))} above the current ${money(currentPriceCents)}.`
              : `The first bid has to be at least the start price of ${money(minimum)}.`,
          });
        }

        if (listing.buyoutPriceCents != null && input.amountCents >= listing.buyoutPriceCents) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `That is at or above the buy-it-now price of ${money(listing.buyoutPriceCents)} — use Buy it now instead.`,
          });
        }

        const [bid] = await tx
          .insert(bids)
          .values({
            listingId: listing.id,
            bidderId: ctx.user.id,
            amountCents: input.amountCents,
            createdAt: now,
          })
          .returning();

        // Anti-sniping: a bid in the last 2 minutes pushes the end out.
        let endsAt = listing.expiresAt!;
        let extended = false;
        if (endsAt.getTime() - now.getTime() < ANTI_SNIPE_MS) {
          endsAt = new Date(now.getTime() + ANTI_SNIPE_MS);
          extended = true;
          await tx
            .update(listings)
            .set({ expiresAt: endsAt, updatedAt: now })
            .where(eq(listings.id, listing.id));
        }

        const [counted] = await tx
          .select({ n: sql<number>`count(*)` })
          .from(bids)
          .where(eq(bids.listingId, listing.id));

        return {
          bid: bid!,
          currentPriceCents: input.amountCents,
          minNextBidCents: minNextBidCents(input.amountCents, true),
          bidCount: Number(counted?.n ?? 1),
          endsAt,
          extended,
          // Carried through to the fire-and-forget notification below —
          // never part of the client-facing response shape.
          _previousTopBidderId: top && top.bidderId !== ctx.user.id ? top.bidderId : null,
          _listingTitle: listing.title,
        };
      }).then((result) => {
        const { _previousTopBidderId, _listingTitle, ...response } = result;
        if (_previousTopBidderId) {
          void notifyOutbid(ctx.db, {
            previousTopBidderId: _previousTopBidderId,
            listingId: input.listingId,
            listingTitle: _listingTitle,
            currentPriceCents: response.currentPriceCents,
          });
        }
        return response;
      });
    }),

  /**
   * Buy it now. Ends the auction immediately and opens the meetup flow with
   * the seller's first pickup spot proposed, exactly like settlement does.
   */
  buyout: protectedProcedure
    .input(z.object({ listingId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await applyExpiry(ctx.db);
      await assertNotBlocked(ctx.db, input.listingId, ctx.user.id);

      return ctx.db.transaction(async (tx) => {
        const now = new Date();
        const [listing] = await tx
          .select()
          .from(listings)
          .where(eq(listings.id, input.listingId))
          .for('update')
          .limit(1);
        assertBiddable(listing, ctx.user.id, now);
        const listingTitle = listing.title;

        if (listing.buyoutPriceCents == null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "This auction doesn't have a buy-it-now price.",
          });
        }

        const [top] = await tx
          .select()
          .from(bids)
          .where(eq(bids.listingId, listing.id))
          .orderBy(desc(bids.amountCents), asc(bids.createdAt))
          .limit(1);
        if (top && top.amountCents >= listing.buyoutPriceCents) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Bidding has already reached the buy-it-now price.',
          });
        }

        await tx.insert(bids).values({
          listingId: listing.id,
          bidderId: ctx.user.id,
          amountCents: listing.buyoutPriceCents,
          createdAt: now,
        });

        // Ending the auction now means the lazy settlement pass has nothing
        // left to do — we create the winner's reservation right here.
        const opening = await openingProposalFor(tx as unknown as Db, listing);

        const existing = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(eq(reservations.listingId, listing.id), eq(reservations.buyerId, ctx.user.id)),
          )
          .limit(1);

        let reservationId = existing[0]?.id ?? null;
        if (!reservationId && opening) {
          const [created] = await tx
            .insert(reservations)
            .values({
              listingId: listing.id,
              buyerId: ctx.user.id,
              sellerId: listing.sellerId,
              status: 'requested',
              spotId: opening.spotId,
              startsAt: opening.startsAt,
              proposedById: listing.sellerId,
              priceCents: listing.buyoutPriceCents,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: reservations.id });
          reservationId = created!.id;
        }

        await tx
          .update(listings)
          .set({ status: 'reserved', expiresAt: now, updatedAt: now })
          .where(eq(listings.id, listing.id));

        return {
          listingId: listing.id,
          pricePaidCents: listing.buyoutPriceCents,
          reservationId,
          _outbidPreviousTopBidderId: top && top.bidderId !== ctx.user.id ? top.bidderId : null,
          _listingTitle: listingTitle,
        };
      }).then((result) => {
        const { _outbidPreviousTopBidderId, _listingTitle, ...response } = result;
        // Buying it out ends bidding immediately — the previous top bidder,
        // if any, is effectively outbid by the buy-it-now price.
        if (_outbidPreviousTopBidderId) {
          void notifyOutbid(ctx.db, {
            previousTopBidderId: _outbidPreviousTopBidderId,
            listingId: response.listingId,
            listingTitle: _listingTitle,
            currentPriceCents: response.pricePaidCents,
          });
        }
        return response;
      });
    }),
});
