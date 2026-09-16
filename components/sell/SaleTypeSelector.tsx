/**
 * Fixed price vs. Auction choice at the top of the Sell form.
 * Two large, obviously-tappable cards rather than a segmented control — this
 * is the single decision that changes everything else on the form.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';

export type SaleType = 'fixed' | 'auction';

export interface SaleTypeSelectorProps {
  value: SaleType;
  onChange: (value: SaleType) => void;
  /** Locked (with a reason) once an auction has bids. */
  disabled?: boolean;
}

const OPTIONS: { value: SaleType; title: string; body: string }[] = [
  {
    value: 'fixed',
    title: 'Fixed price',
    body: 'You set the price. Buyers ask to meet you.',
  },
  {
    value: 'auction',
    title: 'Auction — 24 hours',
    body: 'Buyers bid for 24 hours. Highest bid wins.',
  },
];

export function SaleTypeSelector({ value, onChange, disabled = false }: SaleTypeSelectorProps) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${o.title}. ${o.body}`}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={[styles.card, selected && styles.cardSelected, disabled && styles.cardDisabled]}
          >
            <Text variant="label" weight="600" color={selected ? 'accent' : 'ink'}>
              {o.title}
            </Text>
            <Text variant="caption" color="inkMuted" style={styles.body}>
              {o.body}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md },
  card: {
    flex: 1,
    minHeight: 48,
    padding: space.md,
    gap: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  cardDisabled: { opacity: 0.55 },
  body: { lineHeight: 16 },
});

export default SaleTypeSelector;
