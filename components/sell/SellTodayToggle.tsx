/**
 * "Sell today" toggle for the Sell form. Copy is fixed per docs/DESIGN.md:
 * explains the 24h expiry, relisting, and that an accepted meetup keeps its
 * agreed time even after the listing would otherwise expire.
 */
import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';

export interface SellTodayToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function SellTodayToggle({ value, onChange }: SellTodayToggleProps) {
  return (
    <View style={styles.row}>
      <View style={styles.textCol}>
        <Text variant="label" weight="600">
          Sell today
        </Text>
        <Text variant="caption" color="inkMuted" style={styles.copy}>
          Expires in 24 hours. You can relist anytime. An accepted meetup keeps its agreed time.
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.line, true: colors.accent }}
        thumbColor={colors.white}
        accessibilityRole="switch"
        accessibilityLabel="Sell today"
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  textCol: { flex: 1, gap: space.xs },
  copy: { lineHeight: 16 },
});

export default SellTodayToggle;
