/**
 * 2-col grid card for Browse/Saved/Profile grids.
 * Usage: <ListingCard listing={item} onPress={() => router.push(`/listing/${item.id}`)} />
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './ui/Text';
import { Badge } from './ui/Badge';
import { PriceText } from './ui/PriceText';
import { Avatar } from './ui/Avatar';
import { resolveMediaUrl } from '@/lib/trpc';
import { conditionLabel } from '@/utils/format';
import { useCountdown } from './auction/useCountdown';
import type { ListingCard as ListingCardType } from '@/types';

export interface ListingCardProps {
  listing: ListingCardType;
  onPress: () => void;
}

export function ListingCard({ listing, onPress }: ListingCardProps) {
  const isAuction = listing.saleType === 'auction';
  const { shortLabel, ended } = useCountdown(isAuction ? listing.expiresAt : null);
  const price = isAuction ? listing.currentPriceCents : listing.priceCents;
  const auctionNote = isAuction
    ? ended
      ? 'Auction · Ended'
      : `Auction · ${shortLabel} left`
    : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${conditionLabel(listing.condition)}, ${
        isAuction ? `auction, current bid` : 'price'
      } $${(price / 100).toFixed(0)}${auctionNote ? `, ${auctionNote}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <View style={styles.photoWrap}>
        <Image
          source={{ uri: resolveMediaUrl(listing.coverPhotoUrl) }}
          style={styles.photo}
          contentFit="cover"
          transition={150}
        />
        {listing.hasAvailabilityToday ? (
          <View style={styles.todayPill}>
            <Text variant="caption" weight="600" color="white">
              Today
            </Text>
          </View>
        ) : null}
        {listing.seller.isDemo ? (
          <View style={styles.demoBadge}>
            <Badge kind="demo" />
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        <PriceText cents={price} />
        {auctionNote ? (
          <Text variant="caption" color={ended ? 'inkFaint' : 'inkMuted'} numberOfLines={1}>
            {auctionNote}
          </Text>
        ) : null}
        <Text variant="label" numberOfLines={1} style={styles.title}>
          {listing.title}
        </Text>
        <Text variant="caption" color="inkMuted" numberOfLines={1}>
          {conditionLabel(listing.condition)}
          {listing.size ? ` · ${listing.size}` : ''}
        </Text>
        <View style={styles.sellerRow}>
          <Avatar uri={listing.seller.avatarUrl} name={listing.seller.displayName} size={18} />
          <Text variant="caption" color="inkFaint" numberOfLines={1} style={styles.sellerName}>
            {listing.seller.displayName}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: radius.md, overflow: 'hidden' },
  pressed: { opacity: 0.9 },
  photoWrap: {
    aspectRatio: 4 / 5,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  photo: { width: '100%', height: '100%' },
  todayPill: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    backgroundColor: colors.ink,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  demoBadge: { position: 'absolute', top: space.sm, right: space.sm },
  info: { paddingTop: space.sm, gap: 2 },
  title: { color: colors.ink },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  sellerName: { flexShrink: 1 },
});

export default ListingCard;
