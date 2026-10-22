/** Loading placeholder shaped like the listing page: gallery, price, title, chips, seller row, body. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, space } from '@/constants/theme';
import { Skeleton } from './Skeleton';

export function ListingDetailSkeleton() {
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel="Loading listing">
      <Skeleton height={320} radius={radius.md} />
      <Skeleton width={96} height={28} />
      <Skeleton width="75%" height={22} />
      <View style={styles.row}>
        <Skeleton width={72} height={32} radius={radius.pill} />
        <Skeleton width={88} height={32} radius={radius.pill} />
        <Skeleton width={64} height={32} radius={radius.pill} />
      </View>
      <View style={styles.row}>
        <Skeleton width={40} height={40} radius={20} />
        <Skeleton width={140} height={16} />
      </View>
      <Skeleton width="100%" height={14} />
      <Skeleton width="90%" height={14} />
      <Skeleton width="60%" height={14} />
      <Skeleton height={48} radius={radius.md} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

export default ListingDetailSkeleton;
