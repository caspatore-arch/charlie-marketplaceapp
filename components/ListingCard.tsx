/**
 * 2-col grid card for Browse/Saved/Profile grids.
 * Usage: <ListingCard listing={item} onPress={() => router.push(`/listing/${item.id}`)} />
 */
import React, { memo, useCallback } from 'react';
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
import { useReduceMotion } from '@/components/browse/useReduceMotion';
import { expiresInLabel, expiresSoon, useMinuteNow } from '@/components/browse/expiry';
import type { ListingCard as ListingCardType } from '@/types';

export interface ListingCardProps {
  listing: ListingCardType;
  /** Fine for one-off callers, but an inline arrow defeats the memo below. */
  onPress?: () => void;
  /**
   * Preferred in lists: pass ONE stable callback for the whole grid and the
   * card calls it with its own id, so the memo holds across parent renders.
   */
  onPressListing?: (id: string) => void;
  /**
   * Hide the seller line where it is already implied by context — your own
   * "My listings" grid, or "More from this seller" under that seller's item.
   * Repeating one name down a whole grid is noise, not reassurance.
   */
  showSeller?: boolean;
  /**
   * Set for a listing shown in the Archive: replaces the pickup line (its
   * windows are over) with this note, e.g. "Archived · propose a time".
   */
  archivedNote?: string;
}

function ListingCardImpl({ listing, onPress, onPressListing, showSeller = true, archivedNote }: ListingCardProps) {
  const price = listing.priceCents;
  const reduceMotion = useReduceMotion();
  const id = listing.id;
  const handlePress = useCallback(() => {
    if (onPressListing) onPressListing(id);
    else onPress?.();
  }, [onPressListing, onPress, id]);

  // The pickup line is the card's reason to exist: it answers "when and where
  // could I actually get this" from the grid, without opening the listing or
  // messaging anyone. Today's slots are accented so they stay scannable.
  // Time only, no spot name: at two columns the line is ~150px wide, and
  // "Today 4–6 PM · Stud…" spends its last third on a truncated word. The
  // window is the scarce, decisive part; the spot is one tap away on detail.
  const pickup = listing.nextPickup;
  const pickupLabel = pickup ? formatPickupWindow(pickup.startsAt, pickup.endsAt) : null;
  const pickupIsToday = listing.hasAvailabilityToday && !archivedNote;
  const nowMs = useMinuteNow();
  const expiryLabel = listing.status === 'active' ? expiresInLabel(listing.expiresAt, nowMs) : null;
  const expiringSoon = expiresSoon(listing.expiresAt, nowMs);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${conditionLabel(listing.condition)}, price $${(price / 100).toFixed(0)}${
        archivedNote ? `, ${archivedNote.toLowerCase()}` : pickupLabel ? `, pickup ${pickupLabel}` : ', no pickup times listed'
      }${expiryLabel ? `, ${expiryLabel.toLowerCase()}` : ''}`}
      onPress={handlePress}
      // Feedback is a plain style swap on press-in (no animation to wait on),
      // so it lands on the first frame. Scale is dropped under Reduce Motion.
      style={({ pressed }) => [
        styles.wrap,
        pressed && (reduceMotion ? styles.pressedStill : styles.pressed),
      ]}
    >
      <View style={styles.photoWrap}>
        <Image
          source={{ uri: resolveMediaUrl(listing.coverPhotoUrl) }}
          style={styles.photo}
          contentFit="cover"
          // The photoWrap is a fixed 4:5 box with a muted fill, so a late
          // image fades over a stable block instead of shifting layout.
          transition={reduceMotion ? 0 : 220}
          cachePolicy="memory-disk"
          recyclingKey={listing.id}
        />
        {listing.seller.isDemo ? (
          <View style={styles.demoBadge}>
            <Badge kind="demo" />
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        <PriceText cents={price} />
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
            {archivedNote ?? pickupLabel ?? 'Times on the listing'}
          </Text>
        </View>
        {expiryLabel ? (
          <Text
            variant="caption"
            weight={expiringSoon ? '600' : '500'}
            color={expiringSoon ? 'accentInk' : 'inkMuted'}
            numberOfLines={1}
          >
            {expiryLabel}
          </Text>
        ) : null}
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
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  pressedStill: { opacity: 0.85 },
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

/**
 * Memoized: `listing` objects keep their identity across pages (react-query
 * structural sharing), so a card only re-renders when its own data or its
 * callback props change, not on every parent state change.
 */
export const ListingCard = memo(ListingCardImpl);

export default ListingCard;
