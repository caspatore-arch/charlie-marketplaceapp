/**
 * Usage: <Button title="Send request" onPress={submit} loading={isPending} />
 * variant: 'primary' | 'secondary' | 'ghost' | 'danger'. size: 'md' | 'lg'.
 * Always ≥48pt tall and carries accessibilityRole="button".
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  style,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        size === 'lg' ? styles.lg : styles.md,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? colors.ink : colors.white} />
      ) : (
        <>
          {icon}
          <Text
            variant="heading"
            weight="600"
            color={variant === 'secondary' || variant === 'ghost' ? 'ink' : 'white'}
            // A solid button clamps to one line: a wrapped filled button reads
            // as a broken box. A ghost button is really a text link, and its
            // labels are sentences ("Use your phone number instead"), which at
            // 375px clipped to "Use your phone number ins…" — losing the only
            // route to the other sign-in method. Links wrap; buttons don't.
            numberOfLines={variant === 'ghost' ? 2 : 1}
            style={styles.label}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    minHeight: minTouchHeight,
    paddingHorizontal: space.xl,
  },
  // flexShrink lets a long label wrap inside the row instead of overflowing it
  // (the row is flexDirection: 'row', so without this the Text refuses to
  // narrow). textAlign keeps a wrapped second line centred under the first.
  label: { flexShrink: 1, textAlign: 'center' },
  md: { minHeight: minTouchHeight, paddingVertical: space.md },
  lg: { minHeight: minTouchHeight + 6, paddingVertical: space.lg },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

const variantStyles: Record<ButtonVariant, ViewStyle> = StyleSheet.create({
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceMuted },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.danger },
});

export default Button;
