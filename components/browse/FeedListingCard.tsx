/**
 * One Browse listing: the existing ListingCard (photo, price, title, pickup,
 * expiry, seller — unchanged; tapping the photo opens the listing) followed by
 * its like/share row and up to two top comments. The engagement numbers come
 * from the listing itself, the same ones Community shows.
 */
import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { ListingCard } from '@/components/ListingCard';
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
  return (
    <View style={styles.wrap}>
      <ListingCard listing={item} onPressListing={onOpen} />
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
