/**
 * headerLeft for modal screens: a close (X) icon with a 48pt target and
 * padding, so it never collides with the title. Uses router.back().
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { colors, minTouchHeight, space } from '@/constants/theme';

export function HeaderCloseButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
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

export default HeaderCloseButton;
