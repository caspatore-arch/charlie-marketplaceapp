/**
 * Surface container with the app's one soft shadow. Usage: <Card><Text>...</Text></Card>
 * Pass `onPress` to make it tappable (adds accessibilityRole="button").
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, space } from '@/constants/theme';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, padded = true, accessibilityLabel }: CardProps) {
  const content = [styles.card, padded && styles.padded, style];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [...content, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={content}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow,
  },
  padded: { padding: space.lg },
  pressed: { opacity: 0.92 },
});

export default Card;
