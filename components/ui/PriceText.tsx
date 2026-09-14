/**
 * Usage: <PriceText cents={listing.priceCents} /> — bold, tabular-nums per DESIGN.md.
 */
import React from 'react';
import { Text, type TextProps } from './Text';
import { formatPrice } from '@/utils/format';

export interface PriceTextProps extends Omit<TextProps, 'variant' | 'children'> {
  cents: number;
}

export function PriceText({ cents, ...rest }: PriceTextProps) {
  return (
    <Text variant="price" {...rest}>
      {formatPrice(cents)}
    </Text>
  );
}

export default PriceText;
