/**
 * One Browse listing: the existing ListingCard (photo, price, title, pickup,
 * expiry, seller — unchanged; tapping the photo opens the listing; in the
 * Archive the pickup line says the listing is archived) followed by
 * its like/share row and up to two top comments. The engagement numbers come
 * from the listing itself, the same ones Community shows.
 */
import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { ListingCard } from '@/components/ListingCard';
import { useMinuteNow } from '@/components/browse/expiry';
import { EngagementBar } from '@/components/engagement/EngagementBar';
import { CommentPreview } from '@/components/engagement/CommentPreview';
import { space } from '@/constants/theme';
import type { FeedListing } from '@/types';

export interface FeedListingCardProps {
  item: FeedListing;
  onOpen: (id: string) => void;
}

function FeedListingCardImpl({ item, onOpen }: FeedListingCardProps) {
  const open = useCallback(() => onOpen(item.id), [onOpen, item.id]);
  const nowMs = useMinuteNow();
  // Past its 24 hours (swept to 'expired', or still 'active' awaiting the sweep).
  const archived =
    item.status === 'expired' ||
    (item.status === 'active' && item.expiresAt != null && new Date(item.expiresAt).getTime() <= nowMs);
  return (
    <View style={styles.wrap}>
      <ListingCard
        listing={item}
        onPressListing={onOpen}
        archivedNote={archived ? 'Archived · propose a time' : undefined}
      />
      <EngagementBar listing={item} engagement={item.engagement} returnTo="/" />
      <CommentPreview
        title={item.title}
        comments={item.engagement.topComments}
        commentCount={item.engagement.commentCount}
        onOpen={open}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
});

/** Memoized like ListingCard: `item` keeps its identity unless its own data changes. */
export const FeedListingCard = memo(FeedListingCardImpl);

export default FeedListingCard;
