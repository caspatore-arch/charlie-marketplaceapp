import React from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextLink } from '@/components/ui/TextLink';
import { colors, radius, space } from '@/constants/theme';

export interface InfoSection {
  title: string;
  body: string;
}

/**
 * Marketing page template (About, Why use Dibbs). A primary call to action sits
 * at the top and again at the bottom so nobody has to scroll to sign up.
 * `numbered` renders the sections as steps. `current` hides the link to the
 * page you are already on.
 */
export function InfoPage({
  title,
  intro,
  sections,
  numbered = false,
  current,
}: {
  title: string;
  intro: string;
  sections: InfoSection[];
  numbered?: boolean;
  current?: 'about' | 'why';
}) {
  const router = useRouter();
  const cta = <Button title="Create account" size="lg" onPress={() => router.push('/welcome')} />;
  return (
    <Screen scroll>
      <Stack.Screen options={{ title }} />
      <View style={{ paddingVertical: space.xxl, gap: space.xl }}>
        <Logo width={150} />
        <Text variant="display" accessibilityRole="header">{title}</Text>
        <Text variant="lead" color="inkMuted">{intro}</Text>
        {cta}
        {sections.map((section, i) => (
          <View
            key={section.title}
            style={{ padding: space.xl, gap: space.sm, borderRadius: radius.lg, backgroundColor: colors.tint }}
          >
            {numbered ? (
              <Text variant="caption" weight="700" color="accentInk" style={{ letterSpacing: 1.4 }}>
                {`STEP ${i + 1}`}
              </Text>
            ) : null}
            <Text variant="title" accessibilityRole="header">{section.title}</Text>
            <Text variant="bodySm">{section.body}</Text>
          </View>
        ))}
        {cta}
        <View>
          {current !== 'about' ? <TextLink href="/about">What is Dibbs?</TextLink> : null}
          {current !== 'why' ? <TextLink href="/why-dibbs">Why use Dibbs?</TextLink> : null}
          <TextLink href="/welcome">Already have an account? Log in</TextLink>
        </View>
      </View>
    </Screen>
  );
}
