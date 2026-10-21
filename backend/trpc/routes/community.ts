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
import { and, count, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { communityPostVotes, communityPosts, reports, users, type CommunityPost } from '../../db/schema';
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
  const postIds = rows.map((r) => r.id);
  const authors = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))]));
  const byId = new Map(authors.map((u) => [u.id, u]));
  const totals = await db
    .select({ postId: communityPostVotes.postId, total: count() })
    .from(communityPostVotes)
    .where(inArray(communityPostVotes.postId, postIds))
    .groupBy(communityPostVotes.postId);
  const totalById = new Map(totals.map((t) => [t.postId, Number(t.total)]));
  const mine = await db
    .select({ postId: communityPostVotes.postId })
    .from(communityPostVotes)
    .where(and(eq(communityPostVotes.userId, viewerId), inArray(communityPostVotes.postId, postIds)));
  const votedIds = new Set(mine.map((m) => m.postId));
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind,
    body: p.body,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    author: toPublicUser(byId.get(p.authorId)!),
    isMine: p.authorId === viewerId,
    /** Popularity only. Never an endorsement, and not a safety signal. */
    voteCount: totalById.get(p.id) ?? 0,
    viewerVoted: votedIds.has(p.id),
  }));
}

/**
 * Feed ranking. Every sort goes through the same `liveFilter` + campus +
 * block conditions in `feed`, so no sort can resurface an expired or removed
 * post. Sorts:
 *  - new: createdAt desc.
 *  - top: total upvotes desc, then newest.
 *  - hot: recent vote velocity with time decay. Each upvote is worth
 *    0.5^(ageMinutes / HOT_HALF_LIFE_MIN), so a vote from the last few
 *    minutes counts ~1, one from an hour ago ~0.25, and votes older than
 *    HOT_WINDOW_HOURS count 0. An old post with many old votes therefore
 *    scores ~0 and sinks; ties fall back to newest.
 *    Community posts have NO comments yet, so "hot" ranks on vote activity
 *    only. If comments are added, add their decayed count into the same sum.
 * The hot score depends on the clock, so the cursor freezes `asOf` from the
 * first page and later pages are scored at that same instant.
 */
export const HOT_HALF_LIFE_MIN = 30;
export const HOT_WINDOW_HOURS = 6;

export const communitySorts = ['new', 'top', 'hot'] as const;

const cursorSchema = z.object({
  score: z.number().finite(),
  asOf: z.number().int(),
  createdAt: z.number().int(),
  id: z.uuid(),
});

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
          sort: z.enum(communitySorts).default('new'),
          cursor: z.string().max(300).optional(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .default({ limit: 20, sort: 'new' }),
    )
    .query(async ({ ctx, input }) => {
      let cursor: z.infer<typeof cursorSchema> | null = null;
      if (input.cursor) {
        try {
          cursor = cursorSchema.parse(JSON.parse(input.cursor));
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor.' });
        }
      }
      const now = cursor ? new Date(cursor.asOf) : new Date();
      // Expiry/removal are judged at the real current time, never the frozen one.
      const conditions = [eq(communityPosts.campusId, ctx.user.campusId), liveFilter(new Date())!];
      if (input.kind) conditions.push(eq(communityPosts.kind, input.kind));
      const hidden = await blockedUserIds(ctx.db, ctx.user.id);
      if (hidden.length > 0) conditions.push(notInArray(communityPosts.authorId, hidden));

      // Per-post vote aggregates (total + time-decayed recent score).
      const asOfIso = now.toISOString();
      const v = ctx.db
        .select({
          postId: communityPostVotes.postId,
          total: count().as('total'),
          hot: sql<number>`coalesce(sum(power(0.5, extract(epoch from (${asOfIso}::timestamptz - ${communityPostVotes.createdAt})) / ${HOT_HALF_LIFE_MIN * 60}::float8)) filter (where ${communityPostVotes.createdAt} <= ${asOfIso}::timestamptz and ${communityPostVotes.createdAt} > ${asOfIso}::timestamptz - make_interval(hours => ${HOT_WINDOW_HOURS})), 0)::float8`.as('hot'),
        })
        .from(communityPostVotes)
        .groupBy(communityPostVotes.postId)
        .as('v');

      const totalExpr = sql<number>`coalesce(${v.total}, 0)::float8`;
      const hotExpr = sql<number>`coalesce(${v.hot}, 0)::float8`;
      const scoreExpr = input.sort === 'top' ? totalExpr : input.sort === 'hot' ? hotExpr : sql<number>`0::float8`;

      if (cursor) {
        const cAt = new Date(cursor.createdAt);
        const tie = or(
          lt(communityPosts.createdAt, cAt),
          and(eq(communityPosts.createdAt, cAt), lt(communityPosts.id, cursor.id)),
        )!;
        conditions.push(
          input.sort === 'new'
            ? tie
            : or(sql`${scoreExpr} < ${cursor.score}::float8`, and(sql`${scoreExpr} = ${cursor.score}::float8`, tie)!)!,
        );
      }

      const ordering =
        input.sort === 'new'
          ? [desc(communityPosts.createdAt), desc(communityPosts.id)]
          : [sql`${scoreExpr} desc`, desc(communityPosts.createdAt), desc(communityPosts.id)];

      const rows = await ctx.db
        .select({ post: communityPosts, score: scoreExpr })
        .from(communityPosts)
        .leftJoin(v, eq(v.postId, communityPosts.id))
        .where(and(...conditions))
        .orderBy(...ordering)
        .limit(input.limit + 1);
      const pageRows = rows.slice(0, input.limit);
      const last = rows.length > input.limit ? pageRows[pageRows.length - 1] : undefined;
      return {
        items: await shape(
          ctx.db,
          pageRows.map((r) => r.post),
          ctx.user.id,
        ),
        nextCursor: last
          ? JSON.stringify({
              score: Number(last.score),
              asOf: now.getTime(),
              createdAt: last.post.createdAt.getTime(),
              id: last.post.id,
            })
          : undefined,
        serverNow: now,
      };
    }),

  /**
   * Set (not toggle) the viewer's upvote. Idempotent by design: a double-tap
   * or a retry sends the same target state and cannot flip it back. The
   * (post_id, user_id) primary key makes a duplicate insert a no-op even under
   * concurrency. Only live posts on the viewer's campus can be voted on.
   */
  setVote: protectedProcedure
    .input(z.object({ id: z.uuid(), voted: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const post = await loadVisible(ctx.db, input.id, ctx.user);
      if (input.voted) {
        await ctx.db
          .insert(communityPostVotes)
          .values({ postId: post.id, userId: ctx.user.id })
          .onConflictDoNothing();
      } else {
        await ctx.db
          .delete(communityPostVotes)
          .where(and(eq(communityPostVotes.postId, post.id), eq(communityPostVotes.userId, ctx.user.id)));
      }
      const [row] = await ctx.db
        .select({ total: count() })
        .from(communityPostVotes)
        .where(eq(communityPostVotes.postId, post.id));
      return { id: post.id, voteCount: Number(row?.total ?? 0), viewerVoted: input.voted };
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
