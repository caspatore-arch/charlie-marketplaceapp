/**
 * Small labeled pill. Usage:
 * <Badge kind="demo" /> <Badge kind="verified" /> <Badge kind="status" label="Reserved" tone="warning" />
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './Text';

export type BadgeKind = 'demo' | 'verified' | 'status';
export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface BadgeProps {
  kind: BadgeKind;
  /** Required when kind="status"; ignored otherwise (demo/verified have fixed copy). */
  label?: string;
  tone?: BadgeTone;
}

const toneStyles: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.accentSoft, fg: colors.danger },
  neutral: { bg: colors.surfaceMuted, fg: colors.inkMuted },
};

export function Badge({ kind, label, tone = 'neutral' }: BadgeProps) {
  if (kind === 'demo') {
    return (
      <View style={[styles.pill, { backgroundColor: colors.demoSoft }]}>
        <Text variant="caption" weight="600" color="demo">
          Demo
        </Text>
      </View>
    );
  }

  if (kind === 'verified') {
    return (
      <View style={[styles.pill, { backgroundColor: colors.successSoft }]}>
        <Text variant="caption" weight="600" color="success">
          Campus email verified
        </Text>
      </View>
    );
  }

  const t = toneStyles[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text variant="caption" weight="600" color={t.fg}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});

export default Badge;
