/**
 * Terms of Service screen. Renders the shared placeholder content from
 * constants/legal.ts — see that file's header comment before editing any
 * copy. This screen must stay a plain, scrollable read: no forms, no
 * acceptance action here (the sign-up gate that requires agreeing to these
 * Terms lives in app/auth/verify.tsx).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { TextLink } from '@/components/ui/TextLink';
import { Button } from '@/components/ui/Button';
import { colors, radius, space } from '@/constants/theme';
import { DRAFT_BANNER, LAST_UPDATED, OPERATOR_CONTACT_EMAIL, TERMS_SUMMARY, TERMS_SECTIONS, TERMS_TITLE } from '@/constants/legal';

export default function TermsScreen() {
  const router = useRouter();
  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: TERMS_TITLE }} />

      <View style={styles.banner} accessibilityRole="text">
        <Text variant="label" weight="600" color="warning" style={styles.bannerTitle}>
          Draft — not final
        </Text>
        <Text variant="body" color="warning" style={styles.bannerBody}>
          {DRAFT_BANNER}
        </Text>
      </View>

      <Text variant="title" style={styles.title}>
        {TERMS_TITLE}
      </Text>
      <Text variant="small" color="inkMuted" selectable>
        Last updated: {LAST_UPDATED}
      </Text>
      <Text variant="small" color="inkMuted" selectable>
        Contact: {OPERATOR_CONTACT_EMAIL}
      </Text>

      <View style={styles.summary}>
        <Text variant="heading" style={styles.heading}>
          In plain English
        </Text>
        {TERMS_SUMMARY.map((line) => (
          <Text key={line} variant="body" style={styles.paragraph}>
            {line}
          </Text>
        ))}
      </View>

      {TERMS_SECTIONS.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text variant="heading" style={styles.heading}>
            {section.heading}
          </Text>
          {section.body.map((paragraph, i) => (
            <Text
              key={i}
              variant="body"
              color="inkMuted"
              style={styles.paragraph}
              selectable
            >
              {paragraph}
            </Text>
          ))}
        </View>
      ))}

      <View style={styles.footer}>
        <Text variant="label" color="inkMuted">
          See also
        </Text>
        <TextLink href="/legal/privacy">Privacy Policy</TextLink>
        <Button title="Back to settings" variant="secondary" onPress={() => router.navigate('/settings')} />
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
