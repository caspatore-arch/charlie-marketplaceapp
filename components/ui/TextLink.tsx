/**
 * Usage: <TextLink href="/about">What is Dibbs?</TextLink>
 *        <TextLink onPress={skip}>Skip for now</TextLink>
 * Inline-style navigation link: accent ink, underlined, 48pt tall hit target,
 * accessibilityRole="link". Pass `href` to navigate or `onPress` for an action.
 * Text uses accentInk because plain accent is 4.4:1 on the page ground (<4.5).
 */
import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Link, type Href } from 'expo-router';
import { minTouchHeight, space } from '@/constants/theme';
import { Text, type TextVariant } from './Text';

export interface TextLinkProps {
  children: string;
  href?: Href;
  onPress?: () => void;
  variant?: TextVariant;
  /** Text alignment inside the target; links are left-aligned by default. */
  align?: 'flex-start' | 'center' | 'flex-end';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function TextLink({
  children,
  href,
  onPress,
  variant = 'label',
  align = 'flex-start',
  style,
  accessibilityLabel,
  testID,
}: TextLinkProps) {
  const body = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? children}
      onPress={onPress}
      testID={testID}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      style={({ pressed }) => [styles.target, { alignSelf: align }, pressed && styles.pressed, style]}
    >
      <Text variant={variant} weight="600" color="accentInk" style={styles.text}>
        {children}
      </Text>
    </Pressable>
  );
  if (href) {
    return (
      <Link href={href} asChild>
        {body}
      </Link>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  target: { minHeight: minTouchHeight, justifyContent: 'center', paddingHorizontal: space.xs },
  text: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.7 },
});

export default TextLink;
