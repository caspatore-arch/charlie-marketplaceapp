/**
 * Campus community feed: short "interest check" posts from buyers and sellers
 * ("Anyone selling a mini fridge?", "Anyone want shirts? I have a bunch").
 *
 * Every listing also gets an automatic compact "listing post" here (a pointer
 * row with `listing_id`; see ../listing-post.ts). Its caption, price, photo,
 * status, likes, shares and comments are the LISTING's own, read live, so
 * Browse and Community can never show two different threads or counts. Writes
 * (like, comment, report, delete) go to the listing's own endpoints.
 *
 * Rules the server owns:
 *  - Campus-scoped: you only ever see, open, or report posts from your campus.
 *  - Posts do not expire. A text post stays up until its author (or a moderator)
 *    removes it; a listing post stays while its listing is live or archived and
 *    goes when the listing is sold, held by a confirmed meetup, or removed.
 *  - Identity: posts show the author's normal display name (no anonymity).
 *  - Blocks hide posts both ways. Reports go into the existing moderation queue.
 *  - Posting needs a verified campus email; reading needs a signed-in account.
 */
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql, type AnyColumn } from 'drizzle-orm';
import { z } from 'zod';

import {
  communityCommentVotes,
  communityComments,
  communityPostVotes,
  communityPosts,
  listings,
  reports,
  users,
  type CommunityPost,
} from '../../db/schema';
import type { Db } from '../../db/client';
import { notifyModeratorsOfReport } from '../../email/moderationAlerts';
import { engagementFor, listingHotExpr, listingHotParts } from '../engagement';
import { HOT_COMMENT_VOTE_WEIGHT, HOT_COMMENT_WEIGHT, decayedSum } from '../hot';
import { listingCaption } from '../listing-post';
import { blockedUserIds, toListingCards, toPublicUser } from '../lib';
import { campusVerifiedProcedure, moderatorProcedure, protectedProcedure, router } from '../trpc';

export const COMMUNITY_POST_MAX = 280;
/**
 * Light spam brake: at most this many new posts per person in any rolling
 * 24 hours (posts no longer expire, so a cap on LIVE posts would become a
 * lifetime cap). Removed posts still count, so create/delete cannot dodge it.
 */
export const COMMUNITY_MAX_POSTS_PER_DAY = 5;
const POSTING_WINDOW_MS = 24 * 60 * 60 * 1000;

export const COMMUNITY_COMMENT_MAX = 500;

/** A post is visible until it is removed. (Posts no longer expire; see the file header.) */
export function liveFilter() {
  return isNull(communityPosts.removedAt);
}

/**
 * Which comments a viewer may read: not removed, author not closed (the query
 * must join `users`), author not in the viewer's block list (either direction).
 * Post-level rules (expiry, removal, campus) come from `liveFilter` /
 * `loadVisible`, never from here, so there is one set of lifecycle conditions.
 */
export function commentReadable(hidden: string[]) {
  return and(
    isNull(communityComments.removedAt),
    isNull(users.deletedAt),
    hidden.length > 0 ? notInArray(communityComments.authorId, hidden) : undefined,
  )!;
}

/* ------------------------------------------------------------- votes */

/** A vote is +1 (up), -1 (down) or 0 (no vote / clear). Popularity only, never a safety signal. */
export type VoteValue = 1 | -1 | 0;

/**
 * Input for setVote / setCommentVote. New clients send `value`; older builds
 * send `voted` (true = upvote, false = clear), which still works. `value` wins
 * if both are present.
 */
export const voteInput = z
  .object({
    id: z.uuid(),
    value: z.union([z.literal(1), z.literal(-1), z.literal(0)]).optional(),
    voted: z.boolean().optional(),
  })
  .refine((v) => v.value !== undefined || v.voted !== undefined, { message: 'Send a vote value.' })
  .transform((v) => ({ id: v.id, value: (v.value ?? (v.voted ? 1 : 0)) as VoteValue }));

export interface VoteTally {
  upvotes: number;
  downvotes: number;
  viewerVote: VoteValue;
}

export const NO_VOTES: VoteTally = { upvotes: 0, downvotes: 0, viewerVote: 0 };

/** Wire fields for a tally. `voteCount`/`viewerVoted` are the old upvote-only fields, kept for older app builds. */
export function voteFields(t: VoteTally) {
  return {
    /** Net popularity: upvotes minus downvotes. Can be negative. */
    score: t.upvotes - t.downvotes,
    upvotes: t.upvotes,
    downvotes: t.downvotes,
    /** The viewer's own vote: 1, -1 or 0. */
    viewerVote: t.viewerVote,
    /** Deprecated alias: the upvote count. */
    voteCount: t.upvotes,
    /** Deprecated alias: whether the viewer upvoted. */
    viewerVoted: t.viewerVote === 1,
  };
}

/** Up/down counts and the viewer's own vote for many posts or comments, in two grouped queries. */
export async function voteTallies(
  db: Db,
  kind: 'post' | 'comment',
  ids: string[],
  viewerId: string,
): Promise<Map<string, VoteTally>> {
  const out = new Map<string, VoteTally>();
  if (ids.length === 0) return out;
  const table = (kind === 'post' ? communityPostVotes : communityCommentVotes) as typeof communityPostVotes;
  const idCol = (kind === 'post' ? communityPostVotes.postId : communityCommentVotes.commentId) as typeof communityPostVotes.postId;
  const grouped = await db
    .select({
      id: idCol,
      up: sql<number>`(count(*) filter (where ${table.value} = 1))::int`,
      down: sql<number>`(count(*) filter (where ${table.value} = -1))::int`,
    })
    .from(table)
    .where(inArray(idCol, ids))
    .groupBy(idCol);
  for (const g of grouped) out.set(String(g.id), { upvotes: Number(g.up), downvotes: Number(g.down), viewerVote: 0 });
  const mine = await db
    .select({ id: idCol, value: table.value })
    .from(table)
    .where(and(eq(table.userId, viewerId), inArray(idCol, ids)));
  for (const m of mine) {
    const t = out.get(String(m.id)) ?? { ...NO_VOTES };
    t.viewerVote = m.value === -1 ? -1 : 1;
    out.set(String(m.id), t);
  }
  return out;
}

async function shape(db: Db, rows: CommunityPost[], viewerId: string) {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.id);
  const authors = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))]));
  const byId = new Map(authors.map((u) => [u.id, u]));
  const tallies = await voteTallies(db, 'post', postIds, viewerId);
  // One grouped query for every post's comment count (no N+1). Counts only
  // what this viewer can actually read: not removed, author not closed, author
  // not blocked either way.
  const hidden = await blockedUserIds(db, viewerId);
  const commentTotals = await db
    .select({ postId: communityComments.postId, total: count() })
    .from(communityComments)
    .innerJoin(users, eq(users.id, communityComments.authorId))
    .where(and(inArray(communityComments.postId, postIds), commentReadable(hidden)))
    .groupBy(communityComments.postId);
  const commentsById = new Map(commentTotals.map((t) => [t.postId, Number(t.total)]));

  // Listing posts: the listing is the source of truth for everything shown.
  const listingIds = [...new Set(rows.flatMap((r) => (r.listingId ? [r.listingId] : [])))];
  const listingRows = listingIds.length
    ? await db.select().from(listings).where(inArray(listings.id, listingIds))
    : [];
  const [cards, engagement] = await Promise.all([
    toListingCards(db, listingRows),
    engagementFor(db, listingIds, viewerId),
  ]);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const listingById = new Map(listingRows.map((l) => [l.id, l]));

  return rows.map((p) => {
    const eng = p.listingId ? engagement.get(p.listingId) : undefined;
    const listing = p.listingId ? listingById.get(p.listingId) : undefined;
    return {
      id: p.id,
      kind: p.kind,
      body: listing ? listingCaption(listing) : p.body,
      createdAt: p.createdAt,
      author: toPublicUser(byId.get(p.authorId)!),
      isMine: p.authorId === viewerId,
      /**
       * Popularity only. Never an endorsement, and not a safety signal. For a
       * listing post: the listing's likes (up only, no downvotes).
       */
      ...voteFields(
        eng
          ? { upvotes: eng.likeCount, downvotes: 0, viewerVote: eng.viewerLiked ? 1 : 0 }
          : (tallies.get(p.id) ?? NO_VOTES),
      ),
      /** Popularity only, like votes. Counts comments this viewer can read. For a listing post: the listing's comments. */
      commentCount: eng ? eng.commentCount : (commentsById.get(p.id) ?? 0),
      /** Null for an ordinary text post. Otherwise the live listing card this post links to. */
      listing: (p.listingId ? (cardById.get(p.listingId) ?? null) : null),
      /** Null for an ordinary text post. Otherwise the listing's likes, shares and preview comments. */
      engagement: eng ?? null,
    };
  });
}

/**
 * A listing post stays up while its listing is live OR archived (unsold past
 * its 24 hours): 'active' or 'expired'. Sold, held by a confirmed meetup
 * ('reserved') and removed listings leave Community, as they leave Browse.
 */
function listingLive() {
  return inArray(listings.status, ['active', 'expired']);
}

const LISTING_POST_NOTE = 'That post is a listing. Like, comment or report it from the listing.';
function assertNotListingPost(post: CommunityPost) {
  if (post.listingId) throw new TRPCError({ code: 'BAD_REQUEST', message: LISTING_POST_NOTE });
}

/**
 * Feed ranking. Every sort goes through the same `liveFilter` + campus +
 * block conditions in `feed`, so no sort can resurface an expired or removed
 * post. Sorts:
 *  - new: createdAt desc.
 *  - top: total upvotes desc, then newest.
 *  - hot: recent activity with time decay. Three signals are summed, each
 *    weighted by 0.5^(ageMinutes / HOT_HALF_LIFE_MIN) of its own timestamp, so
 *    something from the last few minutes counts ~1, from an hour ago ~0.25, and
 *    anything older than HOT_WINDOW_HOURS counts 0:
 *      1. each upvote on the post                      x 1
 *      2. each comment on the post (readable to the viewer)  x HOT_COMMENT_WEIGHT
 *      3. each upvote on those comments, by vote time  x HOT_COMMENT_VOTE_WEIGHT
 *    A thread that was busy hours ago therefore scores ~0 and sinks; a quiet
 *    post that just got a conversation rises. Ties fall back to newest.
 *    Removed comments, comments by closed or blocked accounts, and anything on
 *    an expired or removed post never contribute (the post filters in `feed`
 *    still apply to the whole query).
 * The hot score depends on the clock, so the cursor freezes `asOf` from the
 * first page and later pages are scored at that same instant. The recipe lives
 * in ../hot so Browse's Hottest uses the very same decay. A listing post is
 * scored from its listing's likes, comments and shares (same formula as Browse).
 */
export { HOT_HALF_LIFE_MIN, HOT_WINDOW_HOURS, HOT_COMMENT_WEIGHT, HOT_COMMENT_VOTE_WEIGHT } from '../hot';

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
    .where(and(eq(communityPosts.id, id), eq(communityPosts.campusId, viewer.campusId), liveFilter()))
    .limit(1);
  if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: 'That post has expired or was removed.' });
  if (post.listingId) {
    const [live] = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.id, post.listingId), listingLive()))
      .limit(1);
    if (!live) throw new TRPCError({ code: 'NOT_FOUND', message: 'That post has expired or was removed.' });
  }
  if (post.authorId !== viewer.id) {
    const hidden = await blockedUserIds(db, viewer.id);
    if (hidden.includes(post.authorId)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'That post has expired or was removed.' });
    }
  }
  return post;
}

/**
 * Loads a comment the viewer may act on, or NOT_FOUND. The parent post must
 * pass `loadVisible` (live, campus, not blocked), and the comment must be
 * readable (not removed, author not closed, not blocked either way).
 */
async function loadVisibleComment(db: Db, id: string, viewer: { id: string; campusId: string }) {
  const [row] = await db
    .select({ comment: communityComments, authorDeleted: users.deletedAt })
    .from(communityComments)
    .innerJoin(users, eq(users.id, communityComments.authorId))
    .where(eq(communityComments.id, id))
    .limit(1);
  const gone = () => new TRPCError({ code: 'NOT_FOUND', message: 'That comment is no longer available.' });
  if (!row || row.comment.removedAt || row.authorDeleted) throw gone();
  try {
    await loadVisible(db, row.comment.postId, viewer);
  } catch {
    throw gone();
  }
  if (row.comment.authorId !== viewer.id) {
    const hidden = await blockedUserIds(db, viewer.id);
    if (hidden.includes(row.comment.authorId)) throw gone();
  }
  return row.comment;
}

async function shapeComments(
  db: Db,
  rows: { comment: typeof communityComments.$inferSelect; author: typeof users.$inferSelect }[],
  viewerId: string,
) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.comment.id);
  const tallies = await voteTallies(db, 'comment', ids, viewerId);
  return rows.map(({ comment, author }) => ({
    id: comment.id,
    postId: comment.postId,
    /** Null for a top-level comment; otherwise the top-level comment this replies to. */
    parentId: comment.parentId,
    body: comment.body,
    createdAt: comment.createdAt,
    author: toPublicUser(author),
    isMine: comment.authorId === viewerId,
    /** Popularity only. Never an endorsement, and not a safety signal. */
    ...voteFields(tallies.get(comment.id) ?? NO_VOTES),
  }));
}

export const communityRouter = router({
  feed: protectedProcedure
    .input(
      z
        .object({
          kind: z.enum(['buying', 'selling']).optional(),
          sort: z.enum(communitySorts).default('new'),
          /** false hides listing posts (regular posts only). Omitted = true, today's behaviour. */
          includeListings: z.boolean().default(true),
          cursor: z.string().max(300).optional(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .default({ limit: 20, sort: 'new', includeListings: true }),
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
      const conditions = [
        eq(communityPosts.campusId, ctx.user.campusId),
        // Text posts: the post's own 24h expiry. Listing posts: the listing's
        // own status and deadline (so sold, expired or removed listings leave
        // Community exactly when they leave Browse).
        or(
          and(isNull(communityPosts.listingId), liveFilter()),
          and(isNotNull(communityPosts.listingId), liveFilter(), listingLive()),
        )!,
      ];
      if (input.kind) conditions.push(eq(communityPosts.kind, input.kind));
      if (!input.includeListings) conditions.push(isNull(communityPosts.listingId));
      const hidden = await blockedUserIds(ctx.db, ctx.user.id);
      if (hidden.length > 0) conditions.push(notInArray(communityPosts.authorId, hidden));

      // Per-post vote aggregates (total + time-decayed recent score).
      const asOfIso = now.toISOString();
      const v = ctx.db
        .select({
          postId: communityPostVotes.postId,
          net: sql<number>`coalesce(sum(${communityPostVotes.value}), 0)::float8`.as('net'),
          hot: decayedSum(asOfIso, communityPostVotes.createdAt, communityPostVotes.value).as('v_hot'),
        })
        .from(communityPostVotes)
        .groupBy(communityPostVotes.postId)
        .as('v');

      // Decayed comment activity and comment-upvote activity, per post. Same
      // readability rules the viewer gets when reading the comments.
      const decayed = (col: AnyColumn) => decayedSum(asOfIso, col);
      const cm = ctx.db
        .select({ postId: communityComments.postId, hot: decayed(communityComments.createdAt).as('cm_hot') })
        .from(communityComments)
        .innerJoin(users, eq(users.id, communityComments.authorId))
        .where(commentReadable(hidden))
        .groupBy(communityComments.postId)
        .as('cm');
      const cv = ctx.db
        .select({ postId: communityComments.postId, hot: decayedSum(asOfIso, communityCommentVotes.createdAt, communityCommentVotes.value).as('cv_hot') })
        .from(communityCommentVotes)
        .innerJoin(communityComments, eq(communityComments.id, communityCommentVotes.commentId))
        .innerJoin(users, eq(users.id, communityComments.authorId))
        .where(commentReadable(hidden))
        .groupBy(communityComments.postId)
        .as('cv');

      // A listing post is ranked by its listing's own likes, comments and
      // shares (the same formula Browse's Hottest uses); text posts have none.
      const lp = listingHotParts(ctx.db, now, hidden);
      const totalExpr = sql<number>`(coalesce(${v.net}, 0) + coalesce(${lp.likes.total}, 0))::float8`;
      const hotExpr = sql<number>`(coalesce(${v.hot}, 0) + ${HOT_COMMENT_WEIGHT}::float8 * coalesce(${cm.hot}, 0) + ${HOT_COMMENT_VOTE_WEIGHT}::float8 * coalesce(${cv.hot}, 0) + ${listingHotExpr(lp)})::float8`;
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
        .leftJoin(cm, eq(cm.postId, communityPosts.id))
        .leftJoin(cv, eq(cv.postId, communityPosts.id))
        .leftJoin(listings, eq(listings.id, communityPosts.listingId))
        .leftJoin(lp.likes, eq(lp.likes.listingId, communityPosts.listingId))
        .leftJoin(lp.comments, eq(lp.comments.listingId, communityPosts.listingId))
        .leftJoin(lp.shares, eq(lp.shares.listingId, communityPosts.listingId))
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
   * Set (not toggle) the viewer's vote: 1 = up, -1 = down, 0 = clear. The old
   * `{ voted: boolean }` shape still works (true = 1, false = 0). Idempotent
   * by design: a double-tap or a retry sends the same target value and cannot
   * flip it. The (post_id, user_id) primary key plus upsert means a person has
   * at most one vote per post, even under concurrency. Only live posts on the
   * viewer's campus can be voted on. Votes are popularity only.
   */
  setVote: protectedProcedure.input(voteInput).mutation(async ({ ctx, input }) => {
    const post = await loadVisible(ctx.db, input.id, ctx.user);
    assertNotListingPost(post);
    if (input.value === 0) {
      await ctx.db
        .delete(communityPostVotes)
        .where(and(eq(communityPostVotes.postId, post.id), eq(communityPostVotes.userId, ctx.user.id)));
    } else {
      await ctx.db
        .insert(communityPostVotes)
        .values({ postId: post.id, userId: ctx.user.id, value: input.value })
        .onConflictDoUpdate({
          target: [communityPostVotes.postId, communityPostVotes.userId],
          set: { value: input.value, createdAt: new Date() },
          setWhere: sql`${communityPostVotes.value} <> ${input.value}`,
        });
    }
    const t = (await voteTallies(ctx.db, 'post', [post.id], ctx.user.id)).get(post.id) ?? NO_VOTES;
    return { id: post.id, ...voteFields(t) };
  }),

  /**
   * Comments on one post, oldest first. The post is loaded through
   * `loadVisible` (live + campus + block), so a comment on an expired or
   * removed post is not readable. Signed-in only because the post itself is
   * campus-scoped; a signed-out visitor never reaches posts at all.
   */
  comments: protectedProcedure
    .input(z.object({ postId: z.uuid(), limit: z.number().int().min(1).max(100).default(100) }))
    .query(async ({ ctx, input }) => {
      const post = await loadVisible(ctx.db, input.postId, ctx.user);
      assertNotListingPost(post);
      const hidden = await blockedUserIds(ctx.db, ctx.user.id);
      const rows = await ctx.db
        .select({ comment: communityComments, author: users })
        .from(communityComments)
        .innerJoin(users, eq(users.id, communityComments.authorId))
        .where(and(eq(communityComments.postId, post.id), commentReadable(hidden)))
        .orderBy(communityComments.createdAt, communityComments.id)
        .limit(input.limit);
      return shapeComments(ctx.db, rows, ctx.user.id);
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        postId: z.uuid(),
        /** Reply to this comment. Replies are one level deep: replying to a reply attaches to its top-level comment. */
        parentId: z.uuid().optional(),
        body: z
          .string()
          .trim()
          .min(1, 'Write something first.')
          .max(COMMUNITY_COMMENT_MAX, `Keep it under ${COMMUNITY_COMMENT_MAX} characters.`),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const post = await loadVisible(ctx.db, input.postId, ctx.user);
      assertNotListingPost(post);
      let parentId: string | null = null;
      if (input.parentId) {
        // Must be readable to the viewer (not removed, not blocked) and on this post.
        const parent = await loadVisibleComment(ctx.db, input.parentId, ctx.user);
        if (parent.postId !== post.id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'That comment is on a different post.' });
        }
        parentId = parent.parentId ?? parent.id;
      }
      const [comment] = await ctx.db
        .insert(communityComments)
        .values({ postId: post.id, parentId, authorId: ctx.user.id, body: input.body })
        .returning();
      const [shaped] = await shapeComments(ctx.db, [{ comment: comment!, author: ctx.user }], ctx.user.id);
      return shaped!;
    }),

  /** Set (not toggle) the viewer's vote on a comment. Same idempotent contract and old-shape support as `setVote`. */
  setCommentVote: protectedProcedure.input(voteInput).mutation(async ({ ctx, input }) => {
    const comment = await loadVisibleComment(ctx.db, input.id, ctx.user);
    if (input.value === 0) {
      await ctx.db
        .delete(communityCommentVotes)
        .where(and(eq(communityCommentVotes.commentId, comment.id), eq(communityCommentVotes.userId, ctx.user.id)));
    } else {
      await ctx.db
        .insert(communityCommentVotes)
        .values({ commentId: comment.id, userId: ctx.user.id, value: input.value })
        .onConflictDoUpdate({
          target: [communityCommentVotes.commentId, communityCommentVotes.userId],
          set: { value: input.value, createdAt: new Date() },
          setWhere: sql`${communityCommentVotes.value} <> ${input.value}`,
        });
    }
    const t = (await voteTallies(ctx.db, 'comment', [comment.id], ctx.user.id)).get(comment.id) ?? NO_VOTES;
    return { id: comment.id, ...voteFields(t) };
  }),

  /** Author deletes their own comment (soft removal, like posts). */
  removeComment: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [comment] = await ctx.db
      .select()
      .from(communityComments)
      .where(eq(communityComments.id, input.id))
      .limit(1);
    if (!comment || comment.removedAt) throw new TRPCError({ code: 'NOT_FOUND', message: 'That comment no longer exists.' });
    if (comment.authorId !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own comments.' });
    }
    await ctx.db
      .update(communityComments)
      .set({ removedAt: new Date(), removedById: ctx.user.id })
      .where(eq(communityComments.id, comment.id));
    return { ok: true as const };
  }),

  /** Moderator takedown of a single comment. */
  moderatorRemoveComment: moderatorProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(communityComments)
        .set({ removedAt: new Date(), removedById: ctx.user.id })
        .where(eq(communityComments.id, input.id));
      return { ok: true as const };
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
      const recent = await ctx.db
        .select({ id: communityPosts.id })
        .from(communityPosts)
        .where(
          and(
            eq(communityPosts.authorId, ctx.user.id),
            // Automatic listing posts are not "posts you wrote": they must not eat the cap.
            isNull(communityPosts.listingId),
            // Removed posts count too, so delete-and-repost cannot dodge the brake.
            gt(communityPosts.createdAt, new Date(now.getTime() - POSTING_WINDOW_MS)),
          ),
        );
      if (recent.length >= COMMUNITY_MAX_POSTS_PER_DAY) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `You can post ${COMMUNITY_MAX_POSTS_PER_DAY} times a day. Try again later.`,
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
    if (post.listingId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This post is your listing. Remove the listing itself to take it down.',
      });
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
      const [report] = await ctx.db
        .insert(reports)
        .values({
          reporterId: ctx.user.id,
          targetUserId: post.authorId,
          // A listing post is reported as the LISTING, so the moderator sees the
          // item (and can remove it) in the same queue as reports from Browse.
          targetListingId: post.listingId,
          targetPostId: post.listingId ? null : post.id,
          reason: input.reason,
          details: input.details || null,
        })
        .returning();
      await notifyModeratorsOfReport(ctx.db, report!);
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
