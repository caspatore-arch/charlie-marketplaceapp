/**
 * Campus community feed: short "interest check" posts from buyers and sellers
 * ("Anyone selling a mini fridge?", "Anyone want shirts? I have a bunch").
 *
 * Rules the server owns:
 *  - Campus-scoped: you only ever see, open, or report posts from your campus.
 *  - Every post expires exactly 24h after it is created. Expiry is enforced in
 *    every query (`expires_at > now()`), not by a sweep, so an expired post is
 *    gone from the feed AND from direct retrieval the instant it lapses.
 *  - Identity: posts show the author's normal display name (no anonymity).
 *  - Blocks hide posts both ways. Reports go into the existing moderation queue.
 *  - Posting needs a verified campus email; reading needs a signed-in account.
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import { z } from 'zod';

import { communityPosts, reports, users, type CommunityPost } from '../../db/schema';
import type { Db } from '../../db/client';
import { blockedUserIds, toPublicUser } from '../lib';
import { campusVerifiedProcedure, moderatorProcedure, protectedProcedure, router } from '../trpc';

export const COMMUNITY_POST_TTL_MS = 24 * 60 * 60 * 1000;
export const COMMUNITY_POST_MAX = 280;
/** Light spam brake: at most this many live posts per person. */
export const COMMUNITY_MAX_LIVE_POSTS = 5;

function liveFilter(now: Date) {
  return and(gt(communityPosts.expiresAt, now), isNull(communityPosts.removedAt));
}

async function shape(db: Db, rows: CommunityPost[], viewerId: string) {
  if (rows.length === 0) return [];
  const authors = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))]));
  const byId = new Map(authors.map((u) => [u.id, u]));
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind,
    body: p.body,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    author: toPublicUser(byId.get(p.authorId)!),
    isMine: p.authorId === viewerId,
  }));
}

/** Loads a live post on the viewer's campus, or NOT_FOUND (expired, removed, other campus, blocked). */
async function loadVisible(db: Db, id: string, viewer: { id: string; campusId: string }) {
  const [post] = await db
    .select()
    .from(communityPosts)
    .where(and(eq(communityPosts.id, id), eq(communityPosts.campusId, viewer.campusId), liveFilter(new Date())))
    .limit(1);
  if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: 'That post has expired or was removed.' });
  if (post.authorId !== viewer.id) {
    const hidden = await blockedUserIds(db, viewer.id);
    if (hidden.includes(post.authorId)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'That post has expired or was removed.' });
    }
  }
  return post;
}

export const communityRouter = router({
  feed: protectedProcedure
    .input(
      z
        .object({
          kind: z.enum(['buying', 'selling']).optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .default({ limit: 20 }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const conditions = [eq(communityPosts.campusId, ctx.user.campusId), liveFilter(now)!];
      if (input.kind) conditions.push(eq(communityPosts.kind, input.kind));
      const hidden = await blockedUserIds(ctx.db, ctx.user.id);
      if (hidden.length > 0) conditions.push(notInArray(communityPosts.authorId, hidden));
      if (input.cursor) {
        const [createdAtRaw, id] = input.cursor.split('|');
        const createdAt = new Date(createdAtRaw!);
        conditions.push(
          or(
            lt(communityPosts.createdAt, createdAt),
            and(eq(communityPosts.createdAt, createdAt), lt(communityPosts.id, id!)),
          )!,
        );
      }
      const rows = await ctx.db
        .select()
        .from(communityPosts)
        .where(and(...conditions))
        .orderBy(desc(communityPosts.createdAt), desc(communityPosts.id))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const next = rows.length > input.limit ? page[page.length - 1] : undefined;
      return {
        items: await shape(ctx.db, page, ctx.user.id),
        nextCursor: next ? `${next.createdAt.toISOString()}|${next.id}` : undefined,
        serverNow: now,
      };
    }),

  byId: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const post = await loadVisible(ctx.db, input.id, ctx.user);
    const [shaped] = await shape(ctx.db, [post], ctx.user.id);
    return shaped!;
  }),

  create: campusVerifiedProcedure
    .input(
      z.object({
        kind: z.enum(['buying', 'selling']),
        body: z
          .string()
          .trim()
          .min(3, 'Say a little more (3+ characters).')
          .max(COMMUNITY_POST_MAX, `Keep it under ${COMMUNITY_POST_MAX} characters.`),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const live = await ctx.db
        .select({ id: communityPosts.id })
        .from(communityPosts)
        .where(and(eq(communityPosts.authorId, ctx.user.id), liveFilter(now)));
      if (live.length >= COMMUNITY_MAX_LIVE_POSTS) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `You have ${COMMUNITY_MAX_LIVE_POSTS} live posts. Delete one or wait for one to expire.`,
        });
      }
      const [post] = await ctx.db
        .insert(communityPosts)
        .values({
          campusId: ctx.user.campusId,
          authorId: ctx.user.id,
          kind: input.kind,
          body: input.body,
          createdAt: now,
          expiresAt: new Date(now.getTime() + COMMUNITY_POST_TTL_MS),
        })
        .returning();
      const [shaped] = await shape(ctx.db, [post!], ctx.user.id);
      return shaped!;
    }),

  /** Author deletes their own post. */
  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [post] = await ctx.db.select().from(communityPosts).where(eq(communityPosts.id, input.id)).limit(1);
    if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: 'That post no longer exists.' });
    if (post.authorId !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own posts.' });
    }
    await ctx.db
      .update(communityPosts)
      .set({ removedAt: new Date(), removedById: ctx.user.id })
      .where(eq(communityPosts.id, post.id));
    return { ok: true as const };
  }),

  report: protectedProcedure
    .input(
      z.object({
        id: z.uuid(),
        reason: z.enum(['prohibited_item', 'scam', 'harassment', 'no_show', 'other']),
        details: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const post = await loadVisible(ctx.db, input.id, ctx.user);
      if (post.authorId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "You can't report your own post." });
      }
      await ctx.db.insert(reports).values({
        reporterId: ctx.user.id,
        targetUserId: post.authorId,
        targetPostId: post.id,
        reason: input.reason,
        details: input.details || null,
      });
      return { ok: true as const };
    }),

  /** Moderator takedown (used from the moderation queue). */
  moderatorRemove: moderatorProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(communityPosts)
      .set({ removedAt: new Date(), removedById: ctx.user.id })
      .where(eq(communityPosts.id, input.id));
    return { ok: true as const };
  }),
});
