/**
 * Community rules screen. Public, plain read. All text comes from
 * constants/legal.ts (PROHIBITED_ITEMS, CONDUCT_RULES, MEETUP_SAFETY,
 * HOW_TO_REPORT) so the Terms and this screen cannot drift apart.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { TextLink } from '@/components/ui/TextLink';
import { colors, radius, space } from '@/constants/theme';
import {
  CONDUCT_RULES,
  DRAFT_BANNER,
  HOW_TO_REPORT,
  LAST_UPDATED,
  MEETUP_SAFETY,
  PROHIBITED_ITEMS,
  RULES_INTRO,
  RULES_TITLE,
} from '@/constants/legal';

function RuleList({ heading, items }: { heading: string; items: string[] }) {
  return (
    <View style={styles.section}>
      <Text variant="heading" style={styles.heading} accessibilityRole="header">
        {heading}
      </Text>
      {items.map((item) => (
        <Text key={item} variant="body" color="inkMuted" style={styles.paragraph} selectable>
          {`•  ${item}`}
        </Text>
      ))}
    </View>
  );
}

export default function RulesScreen() {
  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: RULES_TITLE }} />

      <View style={styles.banner} accessibilityRole="text">
        <Text variant="label" weight="600" color="warning" style={styles.bannerTitle}>
          Draft — not final
        </Text>
        <Text variant="body" color="warning" style={styles.bannerBody}>
          {DRAFT_BANNER}
        </Text>
      </View>

      <Text variant="title" style={styles.title} accessibilityRole="header">
        {RULES_TITLE}
      </Text>
      <Text variant="small" color="inkMuted" selectable>
        Last updated: {LAST_UPDATED}
      </Text>

      <View style={styles.summary}>
        <Text variant="body" style={styles.paragraph}>
          {RULES_INTRO}
        </Text>
      </View>

      <RuleList heading="What you may not list" items={PROHIBITED_ITEMS} />
      <RuleList heading="How to behave" items={CONDUCT_RULES} />
      <RuleList heading="Meetup safety" items={MEETUP_SAFETY} />
      <RuleList heading="How to report and block" items={HOW_TO_REPORT} />

      <View style={styles.footer}>
        <Text variant="label" color="inkMuted">
          See also
        </Text>
        <TextLink href="/legal/terms">Terms of Service</TextLink>
        <TextLink href="/legal/privacy">Privacy Policy</TextLink>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.huge },
  banner: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
    gap: space.xs,
  },
  bannerTitle: {},
  bannerBody: { lineHeight: 20 },
  summary: { backgroundColor: colors.tint, borderRadius: radius.xl, padding: space.lg, marginTop: space.lg },
  footer: { marginTop: space.xxxl, gap: space.sm },
  title: { marginTop: space.xl, marginBottom: space.sm },
  section: { marginTop: space.xl },
  heading: { marginBottom: space.sm },
  paragraph: { lineHeight: 22, marginBottom: space.sm },
});
