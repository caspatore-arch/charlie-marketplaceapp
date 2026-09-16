/**
 * The auction block on an item detail screen: current price, bid count, a
 * ticking countdown to the end, the buy-it-now price when there is one, and
 * the recent bid history (display names only).
 *
 *   <AuctionPanel listing={listing} bids={bidsQuery.data ?? []} />
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { PriceText } from '@/components/ui/PriceText';
import { Badge } from '@/components/ui/Badge';
import { Divider } from '@/components/ui/Divider';
import { formatPrice, formatRelative } from '@/utils/format';
import { useCountdown } from './useCountdown';

export interface AuctionBidRow {
  id: string;
  amountCents: number;
  createdAt: Date | string;
  bidder: { displayName: string };
}

export interface AuctionPanelProps {
  currentPriceCents: number;
  startPriceCents: number | null;
  buyoutPriceCents: number | null;
  bidCount: number;
  expiresAt: Date | string | null;
  /** Newest first. Pass an empty array while loading. */
  bids?: AuctionBidRow[];
}

export function AuctionPanel({
  currentPriceCents,
  startPriceCents,
  buyoutPriceCents,
  bidCount,
  expiresAt,
  bids = [],
}: AuctionPanelProps) {
  const { label, ended, urgent } = useCountdown(expiresAt);
  const recent = bids.slice(0, 4);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Badge kind="status" label="Auction" tone="neutral" />
        <Text
          variant="label"
          color={ended ? 'inkFaint' : urgent ? 'danger' : 'inkMuted'}
          accessibilityLabel={ended ? 'This auction has ended' : `Time left: ${label}`}
        >
          {ended ? 'Ended' : label}
        </Text>
      </View>

      <View style={styles.priceRow}>
        <View>
          <Text variant="caption" color="inkMuted">
            {bidCount > 0 ? 'Current bid' : 'Starting price'}
          </Text>
          <PriceText cents={currentPriceCents} />
        </View>
        <View style={styles.right}>
          <Text variant="caption" color="inkMuted">
            {bidCount === 1 ? '1 bid' : `${bidCount} bids`}
          </Text>
          {buyoutPriceCents != null ? (
            <Text variant="caption" color="inkMuted">
              Buy it now {formatPrice(buyoutPriceCents)}
            </Text>
          ) : null}
        </View>
      </View>

      {bidCount === 0 && startPriceCents != null ? (
        <Text variant="caption" color="inkMuted" style={styles.note}>
          One bid wins it at {formatPrice(startPriceCents)} — that is the seller&apos;s floor.
        </Text>
      ) : null}

      {recent.length > 0 ? (
        <>
          <Divider style={styles.divider} />
          <Text variant="label" color="inkMuted" style={styles.historyTitle}>
            Recent bids
          </Text>
          {recent.map((b) => (
            <View key={b.id} style={styles.bidRow}>
              <Text variant="body" numberOfLines={1} style={styles.bidder}>
                {b.bidder.displayName}
              </Text>
              <Text variant="caption" color="inkFaint" style={styles.when}>
                {formatRelative(b.createdAt)}
              </Text>
              <Text variant="label">{formatPrice(b.amountCents)}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  right: { alignItems: 'flex-end', gap: 2 },
  note: { marginTop: space.xs },
  divider: { marginVertical: space.md },
  historyTitle: { marginBottom: space.xs },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  bidder: { flexShrink: 1 },
  when: { flexGrow: 1 },
});

export default AuctionPanel;
