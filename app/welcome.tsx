/**
 * Website landing / onboarding. Desktop (>= breakpoints.lg): two-column hero —
 * how Dibbs works on the left, the sign-up card (same flow as
 * /auth/sign-in) on the right. Mobile: stacks, card first under the headline.
 * Copy is deliberately plain: payments are simulated, a campus email proves
 * you are a student there (not who you are), nothing is guaranteed.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { AuthMethods } from '@/components/auth/AuthMethods';
import { useAuth } from '@/hooks/useAuth';
import { breakpoints, colors, radius, shadow, space } from '@/constants/theme';

const LOGO = require('../assets/branding/dibbs-campus-marketplace-logo.png');

const STEPS = [
  {
    title: 'List it for 24 hours',
    body: 'Post a photo, a price, and the times you can meet. Every listing lives one day, so what you see is what’s actually still around.',
  },
  {
    title: 'Buyers book an exact time and spot',
    body: 'No “still available?” back-and-forth. A buyer picks a 30-minute slot and a campus meetup spot from your open times.',
  },
  {
    title: 'Make an offer',
    body: 'Think the price is high? Offer less. If the seller accepts, the item is held for you for an hour so you can book.',
  },
  {
    title: 'Community posts',
    body: 'Looking for something, or have extras? Post to your campus board. Posts disappear after 24 hours too.',
  },
];

const HONEST = [
  'Payments are simulated in this prototype — no money moves.',
  'A verified campus email means someone controls a school email address. It is not an identity check.',
  'Meet in public campus spots and use your own judgment — Dibbs can’t promise how a meetup goes.',
];

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoints.lg;
  const router = useRouter();
  const { status } = useAuth();

  // Remember whether this visit started signed in, so finishing sign-up in the
  // card doesn't swap the card away mid-flow.
  const [startedSignedIn, setStartedSignedIn] = useState<boolean | null>(null);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || status === 'loading') return;
    decided.current = true;
    setStartedSignedIn(status === 'signedIn');
  }, [status]);

  const browse = () => router.replace('/');

  const card = (
    <View style={[styles.card, isDesktop ? styles.cardDesktop : null]}>
      {startedSignedIn ? (
        <View style={styles.cardBody}>
          <Text variant="title">You’re signed in</Text>
          <Text variant="body" color="inkMuted">
            Pick up where you left off.
          </Text>
          <Button title="Browse listings" onPress={browse} />
          <Button title="Account settings" variant="ghost" onPress={() => router.push('/settings')} />
        </View>
      ) : startedSignedIn === null ? (
        <View style={styles.cardBody}>
          <Text variant="body" color="inkMuted">
            Loading…
          </Text>
        </View>
      ) : (
        <View style={styles.cardBody}>
          <Text variant="title" accessibilityRole="header">
            Get started
          </Text>
          <AuthMethods hideFirstHeading cardIntro onFinished={browse} />
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.page}>
      <Stack.Screen options={{ headerShown: false, title: 'Dibbs — campus marketplace' }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.inner, isDesktop ? styles.innerDesktop : null]}>
          <View style={styles.nav}>
            <Image source={LOGO} style={styles.logo} contentFit="cover" accessibilityLabel="Dibbs" />
            <View style={styles.navActions}>
              <Pressable onPress={browse} accessibilityRole="link" style={styles.navLink}>
                <Text variant="label" weight="600">
                  Browse listings
                </Text>
              </Pressable>
              {status === 'signedIn' ? null : (
                <Pressable
                  onPress={() => router.push('/auth/sign-in')}
                  accessibilityRole="link"
                  style={styles.navLink}
                >
                  <Text variant="label" weight="600" color="accent">
                    Sign in
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={[styles.hero, isDesktop ? styles.heroDesktop : null]}>
            <View style={[styles.left, isDesktop ? styles.leftDesktop : null]}>
              <Text variant="caption" color="accent" weight="700" style={styles.kicker}>
                CAMPUS MARKETPLACE
              </Text>
              <Text
                variant="display"
                accessibilityRole="header"
                style={[styles.headline, isDesktop ? styles.headlineDesktop : null]}
              >
                Buy and sell on campus, one day at a time.
              </Text>
              <Text variant="body" color="inkMuted" style={styles.lede}>
                Dibbs is a student marketplace built around meeting up. Every listing lasts 24 hours, and every
                purchase comes with a time and a place.
              </Text>

              {isDesktop ? null : <View style={styles.mobileCard}>{card}</View>}

              <View style={styles.ctaRow}>
                <Button title="Browse listings" variant="secondary" onPress={browse} />
              </View>

              <View style={styles.steps} accessibilityRole="list">
                {STEPS.map((s, i) => (
                  <View key={s.title} style={styles.step} accessibilityRole="none">
                    <View style={styles.stepNum}>
                      <Text variant="label" weight="700" color="accent">
                        {i + 1}
                      </Text>
                    </View>
                    <View style={styles.stepText}>
                      <Text variant="heading">{s.title}</Text>
                      <Text variant="body" color="inkMuted">
                        {s.body}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {isDesktop ? <View style={styles.right}>{card}</View> : null}
          </View>

          <View style={styles.honest}>
            <Text variant="heading" style={styles.honestTitle}>
              Straight talk
            </Text>
            {HONEST.map((line) => (
              <Text key={line} variant="body" color="inkMuted">
                • {line}
              </Text>
            ))}
            <View style={styles.legalRow}>
              <Text variant="label" color="accent" weight="600" accessibilityRole="link" onPress={() => router.push('/legal/terms')}>
                Terms
              </Text>
              <Text variant="label" color="accent" weight="600" accessibilityRole="link" onPress={() => router.push('/legal/privacy')}>
                Privacy
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, alignItems: 'center', paddingBottom: space.huge },
  inner: { width: '100%', paddingHorizontal: space.lg },
  innerDesktop: { maxWidth: 1120, paddingHorizontal: space.xxxl },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  logo: { width: 72, height: 48, borderRadius: radius.md },
  navActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  navLink: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.sm },
  hero: { gap: space.xxl, paddingTop: space.lg },
  heroDesktop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.huge, paddingTop: space.xxxl },
  left: { gap: space.lg },
  leftDesktop: { flex: 1.2 },
  right: { flex: 1, maxWidth: 440, position: 'sticky' as never, top: space.xl } as never,
  kicker: { letterSpacing: 1.2 },
  headline: { fontSize: 36, lineHeight: 42 },
  headlineDesktop: { fontSize: 52, lineHeight: 58, letterSpacing: -1 },
  lede: { fontSize: 18, lineHeight: 26 },
  mobileCard: { width: '100%' },
  ctaRow: { flexDirection: 'row', gap: space.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow,
  },
  cardDesktop: { width: '100%' },
  cardBody: { padding: space.xxl, gap: space.md },
  steps: { gap: space.xl, marginTop: space.lg },
  step: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { flex: 1, gap: space.xs },
  honest: {
    marginTop: space.huge,
    padding: space.xxl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    gap: space.sm,
  },
  honestTitle: { marginBottom: space.xs },
  legalRow: { flexDirection: 'row', gap: space.xl, marginTop: space.md },
});
