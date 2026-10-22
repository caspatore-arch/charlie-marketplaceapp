/**
 * Everything the feeds show about a listing's activity, read in one place so
 * Browse and Community can only ever show the same numbers: likes, shares,
 * the comment count and up to two preview comments. All of it comes from the
 * listing's own rows (`listing_likes`, `listing_shares`, `listing_comments`),
 * never from a Community-side copy. One grouped query per signal for the whole
 * page, no per-listing queries.
 */
import { and, count, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import { listingComments, listingLikes, listingShares, users } from '../db/schema';
import { HOT_COMMENT_WEIGHT, decayedSum } from './hot';
import { blockedUserIds } from './lib';

/** Preview comments shown under a listing in a feed. */
export const COMMENT_PREVIEW_MAX = 2;

/**
 * Which listing comments a viewer may read: not removed, author not closed
 * (the query must join `users`), author not in the viewer's block list.
 * Shared with `listingComment.list` so the preview and the thread agree.
 */
export function readableListingComments(hidden: string[]) {
  return and(
    isNull(listingComments.removedAt),
    isNull(users.deletedAt),
    hidden.length > 0 ? notInArray(listingComments.authorId, hidden) : undefined,
  )!;
}

export type ListingEngagement = {
  likeCount: number;
  viewerLiked: boolean;
  /** Distinct signed-in people who handed the link to a share sheet (uncancelled) or copied it. Not delivery proof. */
  shareCount: number;
  viewerShared: boolean;
  /** Comments this viewer can read, replies included (matches the thread on the listing page). */
  commentCount: number;
  /** At most COMMENT_PREVIEW_MAX top-level comments. No vote totals: listing comments have no votes. */
  topComments: { id: string; body: string; createdAt: Date; author: { id: string; displayName: string; avatarUrl: string | null } }[];
};

/**
 * Engagement for a page of listings as `viewerId` (null = signed out) may see it.
 *
 * "Top" comments: top-level comments only, most-discussed first (replies the
 * viewer can read), then oldest first so a question sits above its answers'
 * newer chatter. Removed comments, closed accounts and blocked people never
 * show, exactly as in the full thread.
 */
export async function engagementFor(
  db: Db,
  listingIds: string[],
  viewerId: string | null,
): Promise<Map<string, ListingEngagement>> {
  const out = new Map<string, ListingEngagement>();
  if (listingIds.length === 0) return out;
  const hidden = viewerId ? await blockedUserIds(db, viewerId) : [];

  const [likeTotals, myLikes, shareTotals, myShares, commentTotals, topLevel, replyTotals] = await Promise.all([
    db
      .select({ id: listingLikes.listingId, total: count() })
      .from(listingLikes)
      .where(inArray(listingLikes.listingId, listingIds))
      .groupBy(listingLikes.listingId),
    viewerId
      ? db
          .select({ id: listingLikes.listingId })
          .from(listingLikes)
          .where(and(eq(listingLikes.userId, viewerId), inArray(listingLikes.listingId, listingIds)))
      : Promise.resolve([] as { id: string }[]),
    db
      .select({ id: listingShares.listingId, total: count() })
      .from(listingShares)
      .where(inArray(listingShares.listingId, listingIds))
      .groupBy(listingShares.listingId),
    viewerId
      ? db
          .select({ id: listingShares.listingId })
          .from(listingShares)
          .where(and(eq(listingShares.userId, viewerId), inArray(listingShares.listingId, listingIds)))
      : Promise.resolve([] as { id: string }[]),
    db
      .select({ id: listingComments.listingId, total: count() })
      .from(listingComments)
      .innerJoin(users, eq(users.id, listingComments.authorId))
      .where(and(inArray(listingComments.listingId, listingIds), readableListingComments(hidden)))
      .groupBy(listingComments.listingId),
    db
      .select({ comment: listingComments, author: users })
      .from(listingComments)
      .innerJoin(users, eq(users.id, listingComments.authorId))
      .where(
        and(
          inArray(listingComments.listingId, listingIds),
          isNull(listingComments.parentId),
          readableListingComments(hidden),
        ),
      )
      .orderBy(listingComments.createdAt, listingComments.id)
      // A listing lives 24 hours, so threads stay small; this only bounds a pathological one.
      .limit(1000),
    db
      .select({ parentId: listingComments.parentId, total: count() })
      .from(listingComments)
      .innerJoin(users, eq(users.id, listingComments.authorId))
      .where(
        and(
          inArray(listingComments.listingId, listingIds),
          isNotNull(listingComments.parentId),
          readableListingComments(hidden),
        ),
      )
      .groupBy(listingComments.parentId),
  ]);

  const likes = new Map(likeTotals.map((r) => [r.id, Number(r.total)]));
  const liked = new Set(myLikes.map((r) => r.id));
  const shares = new Map(shareTotals.map((r) => [r.id, Number(r.total)]));
  const shared = new Set(myShares.map((r) => r.id));
  const comments = new Map(commentTotals.map((r) => [r.id, Number(r.total)]));
  const replies = new Map(replyTotals.map((r) => [r.parentId!, Number(r.total)]));

  const topByListing = new Map<string, typeof topLevel>();
  for (const row of topLevel) {
    const list = topByListing.get(row.comment.listingId);
    if (list) list.push(row);
    else topByListing.set(row.comment.listingId, [row]);
  }

  for (const id of listingIds) {
    // `topLevel` is already oldest-first; a stable sort on reply count keeps that as the tie-break.
    const ranked = [...(topByListing.get(id) ?? [])]
      .sort((a, b) => (replies.get(b.comment.id) ?? 0) - (replies.get(a.comment.id) ?? 0))
      .slice(0, COMMENT_PREVIEW_MAX);
    out.set(id, {
      likeCount: likes.get(id) ?? 0,
      viewerLiked: liked.has(id),
      shareCount: shares.get(id) ?? 0,
      viewerShared: shared.has(id),
      commentCount: comments.get(id) ?? 0,
      topComments: ranked.map(({ comment, author }) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        author: { id: author.id, displayName: author.displayName, avatarUrl: author.avatarUrl },
      })),
    });
  }
  return out;
}

/**
 * Per-listing aggregates for the Hottest ranking and the "top" total, as
 * subqueries to LEFT JOIN on the listing id (`listings.id`, or
 * `community_posts.listing_id`). Callers combine `hot` as: each like x1, each
 * readable comment x HOT_COMMENT_WEIGHT, each share x1 (`listingHotExpr`).
 * Same decay and window as Community post votes (see ./hot).
 */
export function listingHotParts(db: Db, asOf: Date, hidden: string[]) {
  const asOfIso = asOf.toISOString();
  const likes = db
    .select({
      listingId: listingLikes.listingId,
      total: count().as('ll_total'),
      hot: decayedSum(asOfIso, listingLikes.createdAt).as('ll_hot'),
    })
    .from(listingLikes)
    .groupBy(listingLikes.listingId)
    .as('ll');
  const comments = db
    .select({
      listingId: listingComments.listingId,
      hot: decayedSum(asOfIso, listingComments.createdAt).as('lc_hot'),
    })
    .from(listingComments)
    .innerJoin(users, eq(users.id, listingComments.authorId))
    .where(readableListingComments(hidden))
    .groupBy(listingComments.listingId)
    .as('lc');
  const shares = db
    .select({
      listingId: listingShares.listingId,
      hot: decayedSum(asOfIso, listingShares.createdAt).as('ls_hot'),
    })
    .from(listingShares)
    .groupBy(listingShares.listingId)
    .as('ls');
  return { likes, comments, shares };
}

/** The one Hottest formula for a listing, from `listingHotParts` joined on its id. */
export function listingHotExpr(parts: ReturnType<typeof listingHotParts>) {
  return sql<number>`(coalesce(${parts.likes.hot}, 0) + ${HOT_COMMENT_WEIGHT}::float8 * coalesce(${parts.comments.hot}, 0) + coalesce(${parts.shares.hot}, 0))::float8`;
}
