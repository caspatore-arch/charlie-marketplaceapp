/**
 * Like and share for one listing, shared by Browse cards and Community listing
 * posts so they behave identically.
 *
 * Likes: the server stores one like per (listing, person) behind a database
 * UNIQUE key and `setLike` takes the TARGET state, never "toggle", so a
 * double-tap or retry cannot add a second like. The button updates the cached
 * feeds optimistically (both Browse and Community at once), ignores taps while
 * its request is in flight, and rolls back on failure. A like is not a save:
 * the Saved bookmark is a different control and a different table.
 *
 * Shares: external apps never tell us whether anything was posted, so the count
 * follows the one rule documented in docs/CONTRACT.md ("Likes, shares and
 * Hottest"): it counts a signed-in person who handed the link to the OS or
 * browser share sheet and did not cancel it, or who copied the link. One per
 * person per listing. It is never presented as "posted to Instagram".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { patchListingEngagement } from '@/lib/listingEngagementCache';
import { trpc } from '@/lib/trpc';
import { formatPrice } from '@/utils/format';
import { canUseShareSheet, copyTextToClipboard, listingShareUrl, openShareSheet } from '@/utils/shareListing';

export function useListingLike(returnTo: string) {
  const qc = useQueryClient();
  const requireAuth = useRequireAuth();
  const mutation = trpc.listing.setLike.useMutation();
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (listingId: string, current: { liked: boolean; count: number }) => {
      if (!requireAuth(returnTo) || inFlight.current) return;
      inFlight.current = true;
      setError(null);
      const nextLiked = !current.liked;
      patchListingEngagement(qc, listingId, {
        viewerLiked: nextLiked,
        likeCount: Math.max(0, current.count + (nextLiked ? 1 : -1)),
      });
      try {
        const res = await mutation.mutateAsync({ id: listingId, liked: nextLiked });
        patchListingEngagement(qc, listingId, { viewerLiked: res.viewerLiked, likeCount: res.likeCount });
      } catch (e) {
        patchListingEngagement(qc, listingId, { viewerLiked: current.liked, likeCount: current.count });
        const code = (e as { data?: { code?: string } }).data?.code;
        if (code === 'UNAUTHORIZED') requireAuth(returnTo);
        else setError("Couldn't save your like. Try again.");
      } finally {
        inFlight.current = false;
      }
    },
    [qc, requireAuth, returnTo, mutation],
  );

  return { toggle, error, pending: mutation.isPending };
}

export function useListingShare() {
  const qc = useQueryClient();
  const { status: authStatus } = useAuth();
  const record = trpc.listing.recordShare.useMutation();
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const say = useCallback((message: string | null) => {
    setStatus(message);
    if (timer.current) clearTimeout(timer.current);
    if (message) timer.current = setTimeout(() => setStatus(null), 4000);
  }, []);

  const share = useCallback(
    async (listing: { id: string; title: string; priceCents: number }) => {
      const content = {
        title: listing.title,
        text: `${listing.title} for ${formatPrice(listing.priceCents)} on Dibbs`,
        url: listingShareUrl(listing.id),
      };
      let via: 'share_sheet' | 'copy_link' | null = null;

      if (canUseShareSheet()) {
        const outcome = await openShareSheet(content);
        if (outcome === 'cancelled') return;
        if (outcome === 'shared') via = 'share_sheet';
      }
      if (!via) {
        // No share sheet here, or it would not open: copying the link is the share.
        if (await copyTextToClipboard(content.url)) {
          via = 'copy_link';
          say('Link copied.');
        } else {
          say(`Could not copy automatically. Link: ${content.url}`);
        }
      }
      // Signed-out shares still work; they just cannot be counted (no one to de-duplicate).
      if (!via || authStatus !== 'signedIn') return;
      try {
        const res = await record.mutateAsync({ id: listing.id, via });
        patchListingEngagement(qc, listing.id, { shareCount: res.shareCount, viewerShared: true });
      } catch {
        // The share itself already happened; a failed count is not worth interrupting the user.
      }
    },
    [authStatus, qc, record, say],
  );

  return { share, status };
}
