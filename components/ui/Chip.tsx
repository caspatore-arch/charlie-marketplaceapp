/**
 * Selectable filter pill. Usage:
 * <Chip label="Clothing" selected={cat === 'clothing'} onPress={() => setCat('clothing')} />
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Overrides the spoken label when the visible text is not self-explanatory
   *  on its own — e.g. a chip that adds a pickup window rather than filtering. */
  accessibilityLabel?: string;
}

export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
  accessibilityLabel,
}: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      // The pill is 36pt tall by design, below the 48pt minimum target in
      // docs/DESIGN.md. hitSlop buys back the difference without changing how
      // a row of chips looks.
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text variant="label" weight="500" color={selected ? 'accent' : 'inkMuted'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
});

export default Chip;
