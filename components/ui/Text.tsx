/**
 * Themed text. Usage: <Text variant="title">Campus Swap</Text>
 * Defaults to `body`. `color` accepts any theme color key or a raw hex string.
 */
import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, type as typeScale } from '@/constants/theme';

export type TextVariant = keyof typeof typeScale;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: keyof typeof colors | string;
  weight?: '400' | '500' | '600' | '700';
}

export function Text({ variant = 'body', color = 'ink', weight, style, ...rest }: TextProps) {
  const resolvedColor = (colors as Record<string, string>)[color as string] ?? color;
  return (
    <RNText
      // Dynamic Type: allow the OS font-scale setting to apply.
      allowFontScaling
      style={[
        styles.base,
        typeScale[variant] as object,
        { color: resolvedColor },
        weight ? { fontWeight: weight } : null,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: undefined, // system font (SF on iOS)
  },
});

export default Text;
