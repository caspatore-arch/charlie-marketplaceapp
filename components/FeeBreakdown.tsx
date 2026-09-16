/**
 * Fee breakdown shown on the request-meetup sheet. Usage:
 * <FeeBreakdown quote={feeQuoteQuery.data} />
 * Always labeled "Simulated — no money moves" per DESIGN.md copy rules — never
 * imply real payment happens.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './ui/Text';
import { Divider } from './ui/Divider';
import { formatPrice } from '@/utils/format';
import type { FeeQuote } from '@/types';

export interface FeeBreakdownProps {
  quote: FeeQuote;
}

export function FeeBreakdown({ quote }: FeeBreakdownProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text variant="body" color="inkMuted">
          Item price
        </Text>
        <Text variant="body">{formatPrice(quote.priceCents)}</Text>
      </View>
      <View style={styles.row}>
        <Text variant="body" color="inkMuted">
          Platform fee ({quote.feePercent}%)
        </Text>
        <Text variant="body">{formatPrice(quote.platformFeeCents)}</Text>
      </View>
      <View style={styles.row}>
        <Text variant="body" color="inkMuted">
          Card processing (estimated)
        </Text>
        <Text variant="body">{formatPrice(quote.stripeFeeEstimateCents)}</Text>
      </View>
      <Divider style={styles.divider} />
      <View style={styles.row}>
        <Text variant="heading">Seller receives (estimated)</Text>
        <Text variant="heading">{formatPrice(quote.sellerNetEstimateCents)}</Text>
      </View>
      <Text variant="caption" color="inkMuted">
        {quote.estimateNote}
      </Text>
      <View style={styles.badge}>
        <Text variant="caption" weight="600" color="demo">
          {quote.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  divider: { marginVertical: space.xs },
  badge: {
    marginTop: space.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.demoSoft,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});

export default FeeBreakdown;
