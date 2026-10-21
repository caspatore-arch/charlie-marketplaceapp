/** Accessible checkbox row (>= 48pt target). Unchecked unless the caller says otherwise. */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';

export function CheckboxRow({
  checked,
  onToggle,
  label,
  accessibilityLabel,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: React.ReactNode;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      style={[styles.row, disabled ? styles.disabled : null]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.box, checked ? styles.boxChecked : null]}>
        {checked ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.label}>{label}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 48, paddingVertical: space.sm },
  disabled: { opacity: 0.5 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  dot: { width: 10, height: 10, borderRadius: 3, backgroundColor: colors.white },
  label: { flex: 1 },
});

export default CheckboxRow;
