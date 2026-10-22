/**
 * Like and Share for one listing, with their counts. Used identically under a
 * Browse card and on a Community listing post, so both show (and change) the
 * very same numbers: see hooks/useListingEngagement.ts for the rules.
 *
 * The heart is a LIKE (public popularity). It is deliberately not the Saved
 * control, which stays the bookmark in Browse's header and on the listing page.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Heart, Share2 } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { useListingLike, useListingShare } from '@/hooks/useListingEngagement';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import type { FeedListing } from '@/types';

export interface EngagementBarProps {
  listing: { id: string; title: string; priceCents: number };
  engagement: FeedListing['engagement'];
  /** Where to return after signing in to like. */
  returnTo: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function EngagementBar({ listing, engagement, returnTo }: EngagementBarProps) {
  const like = useListingLike(returnTo);
  const { share, status } = useListingShare();
  const liked = engagement.viewerLiked;
  const likes = engagement.likeCount;
  const shares = engagement.shareCount;

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            liked
              ? `You liked ${listing.title}. ${plural(likes, 'like', 'likes')}. Tap to remove your like.`
              : `Like ${listing.title}. ${plural(likes, 'like', 'likes')}.`
          }
          accessibilityState={{ selected: liked, busy: like.pending }}
          onPress={() => like.toggle(listing.id, { liked, count: likes })}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          {/* Filled heart = liked; outline = not liked (shape, not just colour). */}
          <Heart size={22} color={liked ? colors.accent : colors.ink} fill={liked ? colors.accent : 'none'} />
          <Text variant="label" weight="600" color={liked ? 'accentInk' : 'ink'} style={styles.count}>
            {likes}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Share ${listing.title}. ${plural(shares, 'share', 'shares')}.`}
          onPress={() => void share(listing)}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Share2 size={21} color={colors.ink} />
          <Text variant="label" weight="600" style={styles.count}>
            {shares}
          </Text>
        </Pressable>
      </View>
      {like.error || status ? (
        <Text
          variant="caption"
          color={like.error ? 'danger' : 'inkMuted'}
          accessibilityRole={like.error ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
        >
          {like.error ?? status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: -space.sm },
  button: {
    minHeight: minTouchHeight,
    minWidth: minTouchHeight,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  pressed: { opacity: 0.6 },
  count: { fontVariant: ['tabular-nums'] },
});

export default EngagementBar;
