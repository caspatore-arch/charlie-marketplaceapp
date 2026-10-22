import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { TextLink } from '@/components/ui/TextLink';
import { colors, radius, space } from '@/constants/theme';

export function InfoPage({ title, intro, sections }: { title: string; intro: string; sections: { title: string; body: string }[] }) {
  return <Screen scroll>
    <Stack.Screen options={{ title }} />
    <View style={{ paddingVertical: space.xxl, gap: space.xl }}>
      <Text variant="display" accessibilityRole="header">{title}</Text>
      <Text variant="body">{intro}</Text>
      {sections.map((section) => <View key={section.title} style={{ padding: space.xl, gap: space.md, borderRadius: radius.lg, backgroundColor: colors.tint }}>
        <Text variant="title" accessibilityRole="header">{section.title}</Text>
        <Text variant="body">{section.body}</Text>
      </View>)}
      <View>
        <TextLink href="/about">What is Dibbs?</TextLink>
        <TextLink href="/why-dibbs">Why use Dibbs?</TextLink>
        <TextLink href="/welcome">Get started / Log in</TextLink>
      </View>
    </View>
  </Screen>;
}
