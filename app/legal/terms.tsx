/**
 * Terms of Service screen. Renders the shared placeholder content from
 * constants/legal.ts — see that file's header comment before editing any
 * copy. This screen must stay a plain, scrollable read: no forms, no
 * acceptance action here (the sign-up gate that requires agreeing to these
 * Terms lives in app/auth/verify.tsx).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';
import { DRAFT_BANNER, TERMS_SECTIONS, TERMS_TITLE } from '@/constants/legal';

export default function TermsScreen() {
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
  title: { marginTop: space.xl, marginBottom: space.sm },
  section: { marginTop: space.xl },
  heading: { marginBottom: space.sm },
  paragraph: { lineHeight: 22, marginBottom: space.sm },
});
