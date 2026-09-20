/**
 * 2-col grid card for Browse/Saved/Profile grids.
 * Usage: <ListingCard listing={item} onPress={() => router.push(`/listing/${item.id}`)} />
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Clock3 } from 'lucide-react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './ui/Text';
import { Badge } from './ui/Badge';
import { PriceText } from './ui/PriceText';
import { Avatar } from './ui/Avatar';
import { resolveMediaUrl } from '@/lib/trpc';
import { conditionLabel, formatPickupWindow } from '@/utils/format';
import { useCountdown } from './auction/useCountdown';
import type { ListingCard as ListingCardType } from '@/types';

export interface ListingCardProps {
  listing: ListingCardType;
  onPress: () => void;
  /**
   * Hide the seller line where it is already implied by context — your own
   * "My listings" grid, or "More from this seller" under that seller's item.
   * Repeating one name down a whole grid is noise, not reassurance.
   */
  showSeller?: boolean;
}

export function ListingCard({ listing, onPress, showSeller = true }: ListingCardProps) {
  const isAuction = listing.saleType === 'auction';
  const { shortLabel, ended } = useCountdown(isAuction ? listing.expiresAt : null);
  const price = isAuction ? listing.currentPriceCents : listing.priceCents;
  const auctionNote = isAuction
    ? ended
      ? 'Auction · Ended'
      : `Auction · ${shortLabel} left`
    : null;

  // The pickup line is the card's reason to exist: it answers "when and where
  // could I actually get this" from the grid, without opening the listing or
  // messaging anyone. Today's slots are accented so they stay scannable.
  // Time only, no spot name: at two columns the line is ~150px wide, and
  // "Today 4–6 PM · Stud…" spends its last third on a truncated word. The
  // window is the scarce, decisive part; the spot is one tap away on detail.
  const pickup = listing.nextPickup;
  const pickupLabel = pickup ? formatPickupWindow(pickup.startsAt, pickup.endsAt) : null;
  const pickupIsToday = listing.hasAvailabilityToday;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${conditionLabel(listing.condition)}, ${
        isAuction ? `auction, current bid` : 'price'
      } $${(price / 100).toFixed(0)}${auctionNote ? `, ${auctionNote}` : ''}${
        pickupLabel ? `, pickup ${pickupLabel}` : ', no pickup times listed'
      }`}
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
        <View style={styles.pickupRow}>
          <Clock3
            size={11}
            color={pickupIsToday ? colors.accent : colors.inkFaint}
            strokeWidth={2.5}
          />
          <Text
            variant="caption"
            weight={pickupIsToday ? '600' : '500'}
            color={pickupIsToday ? 'accent' : 'inkFaint'}
            numberOfLines={1}
            style={styles.pickupText}
          >
            {pickupLabel ?? 'Ask for a time'}
          </Text>
        </View>
        {showSeller ? (
          <View style={styles.sellerRow}>
            <Avatar uri={listing.seller.avatarUrl} name={listing.seller.displayName} size={18} />
            <Text variant="caption" color="inkFaint" numberOfLines={1} style={styles.sellerName}>
              {listing.seller.displayName}
            </Text>
          </View>
        ) : null}
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
  demoBadge: { position: 'absolute', top: space.sm, right: space.sm },
  info: { paddingTop: space.sm, gap: 2 },
  title: { color: colors.ink },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  pickupText: { flexShrink: 1 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  sellerName: { flexShrink: 1 },
});

export default ListingCard;
