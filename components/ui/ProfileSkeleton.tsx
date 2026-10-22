/** Loading placeholder shaped like a profile: avatar, name, meta line, action row, listing grid. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, space } from '@/constants/theme';
import { Skeleton } from './Skeleton';

export function ProfileSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading profile">
      <View style={styles.header}>
        <Skeleton width={96} height={96} radius={48} />
        <Skeleton width={160} height={22} />
        <Skeleton width={110} height={14} />
        <View style={styles.row}>
          <Skeleton width={120} height={48} radius={radius.md} />
          <Skeleton width={120} height={48} radius={radius.md} />
        </View>
      </View>
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.cell}>
            <Skeleton height={150} radius={radius.md} />
            <Skeleton width="60%" height={16} style={styles.gapTop} />
            <Skeleton width="80%" height={14} style={styles.gapTop} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '47%', flexGrow: 1 },
  gapTop: { marginTop: space.sm },
});

export default ProfileSkeleton;
