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
}

const COPY: Partial<Record<ListingStatus, { title: string; bg: string; fg: string }>> = {
  reserved: { title: 'Reserved — waiting for pickup', bg: colors.warningSoft, fg: colors.warning },
  sold: { title: 'Sold', bg: colors.successSoft, fg: colors.success },
  expired: { title: 'Expired — seller can relist', bg: colors.surfaceMuted, fg: colors.inkMuted },
};

export function StatusBanner({ status }: StatusBannerProps) {
  const copy = COPY[status];
  if (!copy) return null;

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
