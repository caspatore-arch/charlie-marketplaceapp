/**
 * Selectable choice used by the offer sheet for windows, times and spots.
 * Selected is shown by a check, a heavier border and bolder text as well as
 * colour, so the choice is never colour-only. Red text on the tint uses
 * `accentInk` (plain `accent` on `accentSoft` fails contrast).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';

export interface ChoiceChipProps {
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

export function ChoiceChip({ label, sublabel, selected, onPress, accessibilityLabel }: ChoiceChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? (sublabel ? `${label}. ${sublabel}` : label)}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        {selected ? <Check size={16} color={colors.accentInk} strokeWidth={3} /> : null}
        <Text variant="label" weight={selected ? '700' : '500'} color={selected ? 'accentInk' : 'ink'}>
          {label}
        </Text>
      </View>
      {sublabel ? (
        <Text variant="caption" color={selected ? 'accentInk' : 'inkMuted'}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderWidth: 2,
    // Offset the thicker border so the chip does not change size on select.
    paddingHorizontal: space.md - 1,
    paddingVertical: space.sm - 1,
  },
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});

export default ChoiceChip;
