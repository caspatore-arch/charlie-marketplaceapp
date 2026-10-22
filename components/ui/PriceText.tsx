/**
 * Usage: <PriceText cents={listing.priceCents} /> — bold, tabular-nums per DESIGN.md.
 */
import React from 'react';
import { Text, type TextProps } from './Text';
import { formatPrice } from '@/utils/format';

export interface PriceTextProps extends Omit<TextProps, 'variant' | 'children'> {
  cents: number;
  /** `lg` for the main price on a detail page. */
  size?: 'md' | 'lg';
}

export function PriceText({ cents, size = 'md', style, ...rest }: PriceTextProps) {
  return (
    <Text
      variant={size === 'lg' ? 'displaySm' : 'price'}
      style={size === 'lg' ? [{ fontVariant: ['tabular-nums'] as const }, style] : style}
      {...rest}
    >
      {formatPrice(cents)}
    </Text>
  );
}

export default PriceText;
