/**
 * Public comments on a listing ("Is this still available?", "Does it come with
 * the charger?"), with one level of replies.
 *
 * Rules the server owns:
 *  - Reading follows the listing page itself (public), except removed listings,
 *    whose comments disappear with them. Signed-in viewers never see comments
 *    by people they blocked or who blocked them; closed accounts are hidden.
 *  - Writing needs a verified campus email (same gate as offers and posting),
 *    and only while the listing is active or reserved. Someone blocked by the
 *    seller (or who blocked the seller) can't comment on their listings.
 *  - Replies are one level deep: replying to a reply attaches to the top-level
 *    comment it sits under.
 *  - Removal is soft. The author, the listing's seller (their own page), or a
 *    moderator can remove a comment.
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { listingComments, listings, users, type Listing } from '../../db/schema';
import type { Db } from '../../db/client';
import { env } from '../../env';
import { readableListingComments } from '../engagement';
import { blockedUserIds, toPublicUser } from '../lib';
import { campusVerifiedProcedure, moderatorProcedure, protectedProcedure, publicProcedure, router } from '../trpc';

export const LISTING_COMMENT_MAX = 500;

const gone = () => new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });

async function loadListing(db: Db, id: string): Promise<Listing> {
  const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  if (!listing || listing.status === 'removed') throw gone();
  return listing;
}

const readable = readableListingComments;

export const listingCommentRouter = router({
  /** Every readable comment on a listing, oldest first. Flat list; group by `parentId` on the client. */
  list: publicProcedure.input(z.object({ listingId: z.uuid() })).query(async ({ ctx, input }) => {
    const listing = await loadListing(ctx.db, input.listingId);
    const viewerId = ctx.user?.id ?? null;
    const hidden = viewerId ? await blockedUserIds(ctx.db, viewerId) : [];
    const rows = await ctx.db
      .select({ comment: listingComments, author: users })
      .from(listingComments)
      .innerJoin(users, eq(users.id, listingComments.authorId))
      .where(and(eq(listingComments.listingId, listing.id), readable(hidden)))
      .orderBy(listingComments.createdAt, listingComments.id)
      .limit(200);
    return rows.map(({ comment, author }) => ({
      id: comment.id,
      listingId: comment.listingId,
      /** Null for a top-level comment; otherwise the top-level comment this replies to. */
      parentId: comment.parentId,
      body: comment.body,
      createdAt: comment.createdAt,
      author: toPublicUser(author),
      /** The listing's seller wrote this. Labels who is answering, nothing more. */
      isSeller: comment.authorId === listing.sellerId,
      isMine: viewerId !== null && comment.authorId === viewerId,
      /** The viewer may remove it: their own comment, or any comment on their own listing. */
      canRemove: viewerId !== null && (comment.authorId === viewerId || listing.sellerId === viewerId),
    }));
  }),

  add: campusVerifiedProcedure
    .input(
      z.object({
        listingId: z.uuid(),
        parentId: z.uuid().optional(),
        body: z
          .string()
          .trim()
          .min(1, 'Write something first.')
          .max(LISTING_COMMENT_MAX, `Keep it under ${LISTING_COMMENT_MAX} characters.`),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const listing = await loadListing(ctx.db, input.listingId);
      if (listing.status !== 'active' && listing.status !== 'reserved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Comments are closed on this item.' });
      }
      const hidden = await blockedUserIds(ctx.db, ctx.user.id);
      if (hidden.includes(listing.sellerId)) throw gone();

      let parentId: string | null = null;
      if (input.parentId) {
        const [row] = await ctx.db
          .select({ comment: listingComments, authorDeleted: users.deletedAt })
          .from(listingComments)
          .innerJoin(users, eq(users.id, listingComments.authorId))
          .where(eq(listingComments.id, input.parentId))
          .limit(1);
        if (
          !row ||
          row.comment.removedAt ||
          row.authorDeleted ||
          row.comment.listingId !== listing.id ||
          hidden.includes(row.comment.authorId)
        ) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That comment is no longer available.' });
        }
        parentId = row.comment.parentId ?? row.comment.id;
      }

      const [comment] = await ctx.db
        .insert(listingComments)
        .values({ listingId: listing.id, parentId, authorId: ctx.user.id, body: input.body })
        .returning();
      return { id: comment!.id, parentId: comment!.parentId };
    }),

  /** Soft-remove: the author, or the seller on their own listing (moderators too). */
  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ comment: listingComments, sellerId: listings.sellerId })
      .from(listingComments)
      .innerJoin(listings, eq(listings.id, listingComments.listingId))
      .where(eq(listingComments.id, input.id))
      .limit(1);
    if (!row || row.comment.removedAt) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'That comment no longer exists.' });
    }
    const allowed =
      row.comment.authorId === ctx.user.id || row.sellerId === ctx.user.id || env.moderatorUserIds.includes(ctx.user.id);
    if (!allowed) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own comments.' });
    }
    await ctx.db
      .update(listingComments)
      .set({ removedAt: new Date(), removedById: ctx.user.id })
      .where(eq(listingComments.id, row.comment.id));
    return { ok: true as const };
  }),

  /** Moderator takedown of a single comment. */
  moderatorRemove: moderatorProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(listingComments)
      .set({ removedAt: new Date(), removedById: ctx.user.id })
      .where(eq(listingComments.id, input.id));
    return { ok: true as const };
  }),
});
