/**
 * Usage: <Avatar uri={seller.avatarUrl} name={seller.displayName} size={32} />
 * Falls back to the person's initial on a muted circle when no photo.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '@/constants/theme';
import { Text } from './Text';
import { resolveMediaUrl } from '@/lib/trpc';

export interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
}

export function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?';
  const dimensions = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        accessibilityLabel={name ? `${name}'s avatar` : 'User avatar'}
        source={{ uri: resolveMediaUrl(uri) }}
        style={[styles.base, dimensions]}
        contentFit="cover"
        transition={150}
      />
    );
  }

  return (
    <View
      accessibilityLabel={name ? `${name}'s avatar` : 'User avatar'}
      style={[styles.base, styles.fallback, dimensions]}
    >
      <Text variant="label" weight="600" color="inkMuted">
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
  fallback: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default Avatar;
