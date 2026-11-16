/**
 * Public FAQ (route `/faq`), readable signed out. The questions and answers
 * live in scripts/content/faq.ts, which scripts/prerender-public.ts also uses
 * to write the crawlable copy and FAQPage data for this page, so the two
 * can never disagree. Same look as app/about.tsx (InfoPage).
 */
import React from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextLink } from '@/components/ui/TextLink';
import { colors, radius, space } from '@/constants/theme';
import { FAQ, FAQ_HEADING, FAQ_INTRO } from '@/scripts/content/faq';

export default function Faq() {
  const router = useRouter();
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'FAQ' }} />
      <View style={{ paddingVertical: space.xxl, gap: space.xl }}>
        <Logo width={150} />
        <Text variant="display" accessibilityRole="header">{FAQ_HEADING}</Text>
        <Text variant="lead" color="inkMuted">{FAQ_INTRO}</Text>
        {FAQ.map((item) => (
          <View
            key={item.question}
            style={{ padding: space.xl, gap: space.sm, borderRadius: radius.lg, backgroundColor: colors.tint }}
          >
            <Text variant="title" accessibilityRole="header">{item.question}</Text>
            <Text variant="bodySm">{item.answer}</Text>
          </View>
        ))}
        <Button title="Create account" size="lg" onPress={() => router.push('/welcome')} />
        <View>
          <TextLink href="/about">What is Dibbs?</TextLink>
          <TextLink href="/why-dibbs">Why use Dibbs?</TextLink>
          <TextLink href="/welcome">Already have an account? Log in</TextLink>
        </View>
      </View>
    </Screen>
  );
}
