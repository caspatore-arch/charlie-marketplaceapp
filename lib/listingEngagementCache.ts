/**
 * Keeps every cached feed in step when one listing's likes or shares change.
 *
 * Browse (`listing.feed`) and Community (`community.feed`, listing posts) read
 * the SAME server numbers, so a like made in one must show in the other
 * without a refetch (a refetch would also re-rank the list under the user's
 * finger when sorted by Hottest). Patching the cached pages in place does both:
 * instant everywhere, nothing reorders until the next real refresh.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { FeedListing } from '@/types';

export type ListingEngagementPatch = Partial<Pick<FeedListing['engagement'], 'likeCount' | 'viewerLiked' | 'shareCount' | 'viewerShared'>>;

type Pages = { pages: { items: Record<string, any>[] }[]; pageParams: unknown[] } | undefined;

/** tRPC v11 keys look like [['listing', 'feed'], { input, type }]. */
function isProcedure(queryKey: readonly unknown[], path: [string, string]): boolean {
  const head = queryKey[0];
  return Array.isArray(head) && head[0] === path[0] && head[1] === path[1];
}

function mapItems(old: Pages, fn: (item: Record<string, any>) => Record<string, any>): Pages {
  if (!old) return old;
  return { ...old, pages: old.pages.map((page) => ({ ...page, items: page.items.map(fn) })) };
}

export function patchListingEngagement(qc: QueryClient, listingId: string, patch: ListingEngagementPatch): void {
  qc.setQueriesData<Pages>({ predicate: (q) => isProcedure(q.queryKey, ['listing', 'feed']) }, (old) =>
    mapItems(old, (item) => (item.id === listingId ? { ...item, engagement: { ...item.engagement, ...patch } } : item)),
  );
  qc.setQueriesData<Pages>({ predicate: (q) => isProcedure(q.queryKey, ['community', 'feed']) }, (old) =>
    mapItems(old, (post) =>
      post.listing?.id === listingId
        ? {
            ...post,
            // A listing post's upvote IS the listing's like.
            ...(patch.likeCount !== undefined ? { voteCount: patch.likeCount, upvotes: patch.likeCount, score: patch.likeCount } : null),
            ...(patch.viewerLiked !== undefined ? { viewerVoted: patch.viewerLiked, viewerVote: patch.viewerLiked ? 1 : 0 } : null),
            engagement: { ...post.engagement, ...patch },
          }
        : post,
    ),
  );
}
