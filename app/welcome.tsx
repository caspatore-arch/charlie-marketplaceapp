/**
 * The front door of trydibbs.com: create an account or log in.
 *
 * This replaces the old static waitlist page (waitlist/index.html) and keeps
 * its look on purpose — full-bleed brand-red band with the white wordmark,
 * "How it works" steps, the account card lapping onto the band, and the
 * "What Dibbs is not" strip. The card is the real sign-in flow, so signing up
 * here creates an account instead of joining a list.
 *
 * Where people go next:
 * - new account  -> /create-profile (photo, name, bio), then the app
 * - existing     -> the app
 * - already signed in when they land here -> the app, no card needed
 *
 * Copy stays plain: a campus email proves you are a student there, not that
 * you are trustworthy, and Dibbs holds no money.
 */
import React, { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { AuthMethods } from '@/components/auth/AuthMethods';
import type { AuthFinish, AuthMode } from '@/components/auth/EmailAuthFlow';
import { useAuth } from '@/hooks/useAuth';
import { colors, radius, shadow, space } from '@/constants/theme';

const WORDMARK = require('../assets/branding/dibbs-wordmark-white.png');
const WORDMARK_RATIO = 900 / 376;

// Two-column from here up, same as the old page's 880px media query.
const WIDE = 880;

const STEPS = [
  {
    title: 'List it for 24 hours',
    body: 'A photo, a price, and when you can meet. Posts expire after a day, keeping yesterday’s listings out of today’s feed.',
  },
  {
    title: 'Buyers book an exact time and spot',
    body: 'No “is this still available?” Pick a 15-minute slot at a campus meetup spot from the times the seller already offered.',
  },
  {
    title: 'Meet, check it, make it yours',
    body: 'Meet in public on campus. Check the item together, arrange payment directly, and confirm the handoff in Dibbs.',
  },
];

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const router = useRouter();
  const scroll = useRef<ScrollView>(null);
  const sections = useRef<Record<string, number>>({});
  const { status } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signup');
  // Once the card finishes we navigate ourselves; this stops the signed-in
  // redirect below from racing it and skipping profile setup.
  const [finishing, setFinishing] = useState(false);

  // A returning visitor with a live session skips the front door.
  if (status === 'signedIn' && !finishing) return <Redirect href="/" />;

  const onFinished = ({ isNewAccount }: AuthFinish) => {
    setFinishing(true);
    router.replace(isNewAccount ? '/create-profile' : '/');
  };

  const card = (
    <View style={[styles.card, wide ? styles.cardWide : null]}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['signup', 'login'] as const).map((m) => {
          const active = mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tab, active ? styles.tabActive : null]}
            >
              <Text variant="label" weight={active ? '700' : '600'} color={active ? 'ink' : 'inkMuted'}>
                {m === 'signup' ? 'Create account' : 'Log in'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text variant="title" accessibilityRole="header" style={styles.cardTitle}>
        {mode === 'signup' ? 'Make your Dibbs account' : 'Welcome back'}
      </Text>

      <Text variant="body" color="inkMuted">Sell what you no longer use, discover affordable secondhand finds, and book a campus meetup. Verify your campus email to start buying, selling, or posting.</Text>

      {status === 'loading' || finishing ? (
        <View style={styles.loading}>
          <Skeleton height={48} />
          <Skeleton height={52} />
        </View>
      ) : (
        // Keyed on mode so switching tabs starts the flow fresh rather than
        // carrying a half-entered code from one tab into the other.
        <AuthMethods key={mode} mode={mode} hideFirstHeading cardIntro onFinished={onFinished} />
      )}

      <Text variant="caption" color="inkMuted" style={styles.switchLine}>
        {mode === 'signup' ? 'Already have an account? ' : 'New to Dibbs? '}
        <Text
          variant="caption"
          weight="700"
          color="accent"
          accessibilityRole="link"
          onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')}
        >
          {mode === 'signup' ? 'Log in' : 'Create an account'}
        </Text>
      </Text>
    </View>
  );

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false, title: 'Dibbs — the UArizona student marketplace' }} />
      <ScrollView ref={scroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Hero: the logo's own red, so the transparent wordmark has no seam. */}
        <View style={styles.hero}>
          <View style={styles.inner}>
            <Image
              source={WORDMARK}
              accessibilityLabel="Dibbs"
              contentFit="contain"
              style={{ width: wide ? 268 : 190, aspectRatio: WORDMARK_RATIO }}
            />
            <View style={styles.nav}>
              {['About us', 'How it works', 'Why use Dibbs', 'Get started'].map((label) => (
                <Pressable key={label} accessibilityRole="button" onPress={() => label === 'About us' ? router.push('/about') : label === 'Why use Dibbs' ? router.push('/why-dibbs') : scroll.current?.scrollTo({ y: (sections.current.content ?? 0) + (sections.current[label] ?? 0) + (label === 'Get started' ? (sections.current.cardOffset ?? 0) : 0), animated: false })} style={styles.navLink}>
                  <Text variant="label" weight="700">{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text variant="label" weight="600" color="white" style={styles.tagline}>
              CAMPUS MARKETPLACE
            </Text>
            {/* Headline and lede stay large: white on brand red is 3.96:1,
                which only passes for large text. Don't shrink them. */}
            <Text
              variant="display"
              color="white"
              weight="700"
              accessibilityRole="header"
              style={[styles.h1, wide ? styles.h1Wide : null]}
            >
              Buy and sell on campus, one day at a time.
            </Text>
            <Text variant="body" color="white" weight="600" style={styles.lede}>
              A marketplace just for UArizona students — clothes, shoes, dorm stuff, books and tech, handed off in
              person on campus.
            </Text>
            <View style={styles.pill}>
              <Text variant="caption" color="white" weight="600" style={styles.pillText}>
                University of Arizona students
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.inner} onLayout={(e) => { sections.current['content'] = e.nativeEvent.layout.y; }}>
          <View style={styles.about} onLayout={(e) => { sections.current['About us'] = e.nativeEvent.layout.y; }}>
            <Text variant="title" accessibilityRole="header">About us</Text>
            <Text variant="body">Good stuff deserves another semester.</Text>
            <Text variant="body" color="inkMuted">Dibbs is an independent campus marketplace starting at the University of Arizona. We’re making it easier to pass along the clothes, books, tech, and dorm finds you no longer need to someone nearby who does.</Text>
          </View>
          <View style={styles.benefits} onLayout={(e) => { sections.current['Why use Dibbs'] = e.nativeEvent.layout.y; }}>
            <Text variant="title" accessibilityRole="header">Why use Dibbs?</Text>
            <Text variant="body">Less back-and-forth. More actual meetups.</Text>
            {[
              ['Stay close to campus', 'Browse your campus community and choose a campus meetup spot. Less travel makes a handoff easier to fit between classes.', colors.successSoft],
              ['Know when you can meet', 'Sellers share availability up front. Buyers book an exact 15-minute slot, so both people have a clear plan.', colors.warningSoft],
              ['Find something fresh', 'Listings expire after 24 hours. Share your link with friends while it’s live, or make an offer on a find you love.', colors.demoSoft],
            ].map(([title, body, backgroundColor]) => (
              <View key={title} style={[styles.benefit, { backgroundColor }]}>
                <Text variant="heading" accessibilityRole="header">{title}</Text>
                <Text variant="body">{body}</Text>
              </View>
            ))}
          </View>
          <View onLayout={(e) => { sections.current['How it works'] = e.nativeEvent.layout.y; sections.current['Get started'] = sections.current['How it works']; }} style={[styles.panel, wide ? styles.panelWide : null]}>

            <View style={[styles.steps, wide ? styles.stepsWide : null]}>
              <Text variant="caption" weight="700" color="accentInk" style={styles.sectionLabel}>
                HOW IT WORKS
              </Text>
              {STEPS.map((s, i) => (
                <View key={s.title} style={styles.step}>
                  <View style={styles.num}>
                    <Text variant="label" weight="700" color="accentInk">
                      {i + 1}
                    </Text>
                  </View>
                  <View style={styles.stepText}>
                    <Text variant="heading" weight="700">
                      {s.title}
                    </Text>
                    <Text variant="body" color="inkMuted" style={styles.stepBody}>
                      {s.body}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View onLayout={(e) => { sections.current.cardOffset = e.nativeEvent.layout.y; }} style={wide ? styles.cardCol : undefined}>{card}</View>
          </View>

          <View style={styles.plain}>
            <Text variant="label" weight="700">
              What Dibbs is not
            </Text>
            <Text variant="label" color="inkMuted">
              Dibbs doesn’t hold your money, handle payment, or check who anyone is. A campus email proves someone is
              in control of that campus email address. It does not verify identity or trustworthiness. Meet in public, on campus, and use your own judgment.
            </Text>
          </View>

          <View style={styles.footer}>
            <Text variant="caption" color="inkFaint">
              Dibbs is an independent student project and is not affiliated with or endorsed by the University of
              Arizona.
            </Text>
            <View style={styles.legalRow}>
              <Text variant="caption" color="accent" weight="600" accessibilityRole="link" onPress={() => router.push('/legal/terms')}>
                Terms
              </Text>
              <Text variant="caption" color="accent" weight="600" accessibilityRole="link" onPress={() => router.push('/legal/privacy')}>
                Privacy
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  navLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, backgroundColor: colors.white, borderRadius: radius.pill },
  about: { paddingVertical: space.xxxl, gap: space.md },
  benefits: { gap: space.md },
  benefit: { padding: space.xl, borderRadius: radius.lg, gap: space.sm },
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingBottom: 72 },
  inner: { width: '100%', maxWidth: 1060, alignSelf: 'center', paddingHorizontal: space.lg },

  hero: { backgroundColor: colors.brand, paddingTop: 44, paddingBottom: 52 },
  tagline: { marginTop: 10, letterSpacing: 2.2 },
  h1: { marginTop: 30, maxWidth: 560, fontSize: 38, lineHeight: 42, letterSpacing: -0.8 },
  h1Wide: { fontSize: 60, lineHeight: 63, letterSpacing: -1.3 },
  lede: { marginTop: 18, maxWidth: 520, fontSize: 20, lineHeight: 29 },
  pill: {
    alignSelf: 'flex-start',
    marginTop: 26,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.17)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.42)',
  },
  pillText: { fontSize: 13, letterSpacing: 0.3 },

  // The card laps onto the red band, as on the old page.
  panel: { gap: space.xxxl, marginTop: 28 },
  panelWide: { flexDirection: 'row', alignItems: 'flex-start', gap: 48 },

  steps: { paddingTop: space.lg, gap: 26 },
  stepsWide: { flex: 1, paddingTop: 60 },
  sectionLabel: { letterSpacing: 1.7, marginBottom: -6 },
  step: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  num: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { flex: 1 },
  stepBody: { marginTop: 4, fontSize: 15, lineHeight: 23 },

  cardCol: {
    width: 420,
    ...(Platform.OS === 'web' ? ({ position: 'sticky', top: 24 } as object) : null),
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    padding: 28,
    gap: space.md,
    ...shadow,
  },
  cardWide: { width: '100%' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: space.xs,
  },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  tabActive: { backgroundColor: colors.surface, ...shadow },
  cardTitle: { fontSize: 23 },
  loading: { gap: space.md },
  switchLine: { textAlign: 'center', marginTop: space.xs, fontSize: 13 },

  plain: {
    marginTop: 56,
    padding: space.xxl,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    gap: space.sm,
  },
  footer: {
    marginTop: space.huge,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: space.md,
  },
  legalRow: { flexDirection: 'row', gap: space.xl },
});
