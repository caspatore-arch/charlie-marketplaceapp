/**
 * The Dibbs logo, rendered from the shipped artwork (never re-typeset).
 *
 * The artwork is white script, so it needs a brand-red ground. `wordmark`
 * uses the pre-flattened red PNG; `lockup` is transparent, so it is wrapped in
 * a brand-red rounded box. Aspect ratios come from the source files.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius } from '@/constants/theme';

const ASSETS = {
  wordmark: {
    source: require('../../assets/branding/dibbs-wordmark-red.png'),
    ratio: 900 / 376,
  },
  lockup: {
    source: require('../../assets/branding/dibbs-lockup-white.png'),
    ratio: 1100 / 565,
  },
} as const;

export interface LogoProps {
  variant?: 'wordmark' | 'lockup';
  /** Rendered width in px; height follows the artwork's aspect ratio. */
  width?: number;
  style?: StyleProp<ViewStyle>;
}

export function Logo({ variant = 'wordmark', width = 96, style }: LogoProps) {
  const { source, ratio } = ASSETS[variant];
  const height = Math.round(width / ratio);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Dibbs"
      style={[
        { width, height, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.brand },
        style,
      ]}
    >
      <Image source={source} style={{ width, height }} contentFit="contain" accessible={false} />
    </View>
  );
}

export default Logo;
