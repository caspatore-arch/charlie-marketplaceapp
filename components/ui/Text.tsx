/**
 * Themed text. Usage: <Text variant="title">Dibbs</Text>
 * Defaults to `body`. `color` accepts any theme color key or a raw hex string.
 */
import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, fontFamilyFor, type as typeScale, type FontWeight } from '@/constants/theme';

export type TextVariant = keyof typeof typeScale;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: keyof typeof colors | string;
  weight?: FontWeight;
}

export function Text({ variant = 'body', color = 'ink', weight, style, ...rest }: TextProps) {
  const base = typeScale[variant] as { fontWeight: FontWeight };
  // Resolve weight to its own font family, and strip fontWeight so RN/web
  // doesn't try to synthesise bold on top of an already-weighted face.
  const family = fontFamilyFor(weight ?? base.fontWeight);
  const resolvedColor = (colors as Record<string, string>)[color as string] ?? color;
  return (
    <RNText
      // Dynamic Type: allow the OS font-scale setting to apply.
      allowFontScaling
      style={[
        styles.base,
        typeScale[variant] as object,
        { color: resolvedColor },
        { fontFamily: family, fontWeight: 'normal' },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {},
});

export default Text;
