/**
 * 2-column skeleton grid shown while the Browse feed's first page loads.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { space } from '@/constants/theme';

export function BrowseGridSkeleton() {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} style={styles.cell}>
          <Skeleton height={200} radius={14} />
          <Skeleton width="60%" height={16} style={styles.line} />
          <Skeleton width="40%" height={12} style={styles.line} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '47%', gap: space.xs },
  line: { marginTop: 2 },
});

export default BrowseGridSkeleton;
