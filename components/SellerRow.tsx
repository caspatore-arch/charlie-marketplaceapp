/**
 * Compact seller identity row, used on item detail. Usage:
 * <SellerRow seller={listingDetail.seller} onPress={() => router.push(`/user/${seller.id}`)} />
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { space } from '@/constants/theme';
import { Text } from './ui/Text';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';

export interface SellerRowSeller {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  isDemo?: boolean;
  campusEmailVerified?: boolean;
}

export interface SellerRowProps {
  seller: SellerRowSeller;
  onPress?: () => void;
}

export function SellerRow({ seller, onPress }: SellerRowProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`View ${seller.displayName}'s profile`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}
    >
      <Avatar uri={seller.avatarUrl} name={seller.displayName} size={36} />
      <View style={styles.info}>
        <Text variant="label" weight="600" numberOfLines={1} ellipsizeMode="tail">
          {seller.displayName}
        </Text>
        <View style={styles.badges}>
          {seller.campusEmailVerified ? <Badge kind="verified" /> : null}
          {seller.isDemo ? <Badge kind="demo" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pressed: { opacity: 0.7 },
  info: { flex: 1, gap: 4 },
  badges: { flexDirection: 'row', gap: space.xs },
});

export default SellerRow;
