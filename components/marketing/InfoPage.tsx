import React from 'react';
import { View } from 'react-native';
import { Link, Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';

export function InfoPage({ title, intro, sections }: { title: string; intro: string; sections: { title: string; body: string }[] }) {
  return <Screen scroll>
    <Stack.Screen options={{ title }} />
    <View style={{ paddingVertical: space.xxl, gap: space.xl }}>
      <Logo width={150} />
      <Text variant="display" accessibilityRole="header">{title}</Text>
      <Text variant="body">{intro}</Text>
      {sections.map((section, i) => <View key={section.title} style={{ padding: space.xl, gap: space.md, borderRadius: radius.lg, backgroundColor: [colors.successSoft, colors.warningSoft, colors.demoSoft][i % 3] }}>
        <Text variant="title" accessibilityRole="header">{section.title}</Text>
        <Text variant="body">{section.body}</Text>
      </View>)}
      <Link href="/about" style={{ paddingVertical: 12 }}>What is Dibbs?</Link>
      <Link href="/why-dibbs" style={{ paddingVertical: 12 }}>Why use Dibbs?</Link>
      <Link href="/welcome" style={{ paddingVertical: 12 }}>Get started / Log in</Link>
    </View>
  </Screen>;
}
