/** Inline message block with a polite live region. tone: error | info | success. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';

const tones = {
  error: { bg: colors.accentSoft, fg: 'danger' },
  info: { bg: colors.surfaceMuted, fg: 'inkMuted' },
  success: { bg: colors.successSoft, fg: 'success' },
  dev: { bg: colors.demoSoft, fg: 'demo' },
} as const;

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  const t = tones[tone];
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[styles.box, { backgroundColor: t.bg }]}
    >
      <Text variant="label" color={t.fg} style={styles.text}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, width: '100%' },
  text: { fontWeight: '500', lineHeight: 20 },
});

export default Notice;
