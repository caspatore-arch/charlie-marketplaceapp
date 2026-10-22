/** Header X for the listing forms: same look as HeaderCloseButton, but the parent decides what closing does (discard guard). */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, minTouchHeight, space } from '@/constants/theme';

export function GuardedCloseButton({ onPress, label = 'Close' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
    >
      <X size={24} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: minTouchHeight,
    minHeight: minTouchHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  pressed: { opacity: 0.6 },
});
