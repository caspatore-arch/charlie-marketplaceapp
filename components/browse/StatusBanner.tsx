/**
 * Full-width banner shown on item detail when a listing is reserved, sold,
 * or expired. Copy per docs/DESIGN.md's "rules of copy" section.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';
import type { ListingStatus } from '@/types';

export interface StatusBannerProps {
  status: ListingStatus;
  /** A buyer (not the seller) is looking: an expired listing is in the Archive and can still be requested. */
  buyerView?: boolean;
}

const COPY: Partial<Record<ListingStatus, { title: string; bg: string; fg: string }>> = {
  reserved: { title: 'Reserved — waiting for pickup', bg: colors.warningSoft, fg: colors.warning },
  sold: { title: 'Sold', bg: colors.successSoft, fg: colors.success },
  expired: { title: 'Expired — seller can relist', bg: colors.surfaceMuted, fg: colors.inkMuted },
};

export function StatusBanner({ status, buyerView = false }: StatusBannerProps) {
  const base = COPY[status];
  if (!base) return null;
  const copy =
    status === 'expired' && buyerView ? { ...base, title: 'Archived — you can still ask for a meetup' } : base;

  return (
    <View style={[styles.wrap, { backgroundColor: copy.bg }]} accessibilityRole="text">
      <Text variant="label" weight="600" color={copy.fg}>
        {copy.title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    marginBottom: space.lg,
  },
});

export default StatusBanner;
