/**
 * Skeleton for the Browse grid. It mirrors the real cell (ListingCard inside
 * the FlatList in app/(tabs)/index.tsx): the same 4:5 photo box, the same
 * row gap / side padding, the same `flex: 1` + `maxWidth: 1/numColumns` cell
 * rule, and text lines sized to the price / title / meta / pickup / seller
 * rows. When real data replaces it the cells fill in; nothing reflows.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { radius, space } from '@/constants/theme';

export interface BrowseGridSkeletonProps {
  /** Must match the grid's current column count. */
  numColumns?: number;
  /** Number of rows to draw. Default 3 (a first screenful); 1 for a footer. */
  rows?: number;
}

export function BrowseGridSkeleton({ numColumns = 2, rows = 3 }: BrowseGridSkeletonProps) {
  const maxWidth = `${(100 / numColumns).toFixed(4)}%` as `${number}%`;
  return (
    <View style={styles.grid} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={styles.row}>
          {Array.from({ length: numColumns }).map((__, c) => (
            <View key={c} style={[styles.cell, { maxWidth }]}>
              {/* height: undefined lets the 4:5 aspect ratio size the block */}
              <Skeleton radius={radius.md} style={styles.photo} />
              <View style={styles.info}>
                <Skeleton width="38%" height={18} />
                <Skeleton width="80%" height={16} />
                <Skeleton width="55%" height={14} />
                <Skeleton width="62%" height={14} />
                <Skeleton width="45%" height={18} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Same as the FlatList: contentContainer gap between rows, row gap between
  // cells, space.lg side padding.
  grid: { gap: space.md, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', gap: space.md },
  cell: { flex: 1 },
  photo: { height: undefined, aspectRatio: 4 / 5 },
  info: { paddingTop: space.sm, gap: 2 },
});

export default BrowseGridSkeleton;
