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
import { Camera } from 'lucide-react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextLink } from '@/components/ui/TextLink';
import { useReduceMotion } from '@/components/browse/useReduceMotion';
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
    body: 'A photo, a price, and when you can meet. Listings expire after a day. If yours does not sell, repost it lower.',
  },
  {
    title: 'A buyer books a time and spot',
    body: 'No “is this still available?” A buyer who likes the price picks a 15-minute slot at a public campus spot, from the times you offered.',
  },
  {
    title: 'Meet, check it, hand it over',
    body: 'Meet in public on campus. Check the item together, pay the seller directly, and confirm the handoff in Dibbs.',
  },
];

// "Get a Dibbs offer": the Dibbs team buys the item directly. Owner asked
// (Nov 3) to promise an offer within an hour and a same-day sale; the hour
// only holds while staff are on, so the copy says "during team hours".
// Payment happens outside the app, so the copy never says "paid" or "cash".
const OFFER_STEPS = [
  { title: 'Snap a photo', body: 'Photos or a short video, plus what it is. No listing and no asking price.' },
  { title: 'Get an offer within an hour', body: 'A real person on the Dibbs team looks at it and sends you an offer.' },
  { title: 'Sell it the same day', body: 'Pick a time at a campus spot, we check the item together, and you decide whether to take the final offer.' },
];

// The four reasons, in the owner's order. Safe-and-sure is worded as facts the
// app makes true, never as a guarantee.
const PITCH = [
  {
    title: 'Quick, with no haggling',
    body: 'The price is the price. Buyers decide if it is right and agree to a time and place, so there is no negotiating and no lowball spam.',
  },
  {
    title: 'Sell the same day',
    body: 'Need money for a trip or a night out? Sell the thing you have not touched in months today. Did not sell in a day? Repost it lower.',
  },
  {
    title: 'Free, and you keep 100%',
    body: 'No fees and no transaction costs. Sellers keep everything they ask for.',
  },
  {
    title: 'Safe and sure',
    body: 'Public spots on campus, other students who verified a campus email, a booked time with a reminder, and report and block when you need them.',
  },
];

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const router = useRouter();
  const scroll = useRef<ScrollView>(null);
  const howRef = useRef<View>(null);
  const cardRef = useRef<View>(null);
  const reduceMotion = useReduceMotion();
  const { status } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signup');
  // Set when they came in through a "Get a Dibbs offer" button, so signing up
  // lands them on the photo form instead of the feed.
  const [wantsOffer, setWantsOffer] = useState(false);
  // Once the card finishes we navigate ourselves; this stops the signed-in
  // redirect below from racing it and skipping profile setup.
  const [finishing, setFinishing] = useState(false);

  // A returning visitor with a live session skips the front door.
  if (status === 'signedIn' && !finishing) return <Redirect href="/" />;

  // Measure the target against the scroll content itself, so the offset is in
  // one coordinate frame no matter how deeply the target is nested.
  const scrollToRef = (target: React.RefObject<View | null>) => {
    const content = scroll.current?.getInnerViewNode();
    if (!target.current || !content) return;
    target.current.measureLayout(
      content as never,
      (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - space.lg), animated: !reduceMotion }),
      () => {},
    );
  };

  const onFinished = ({ isNewAccount }: AuthFinish) => {
    setFinishing(true);
    if (wantsOffer) {
      router.replace(isNewAccount ? '/create-profile?next=offer' : '/dibbs-offer/new');
    } else {
      router.replace(isNewAccount ? '/create-profile' : '/');
    }
  };

  const startOffer = () => {
    setWantsOffer(true);
    setMode('signup');
    scrollToRef(cardRef);
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

      <Text variant="displaySm" accessibilityRole="header">
        {mode === 'signup' ? 'Make your Dibbs account' : 'Welcome back'}
      </Text>

      <Text variant="body" color="inkMuted">
        {wantsOffer
          ? 'Make a free account, then send your photos to the Dibbs team for an offer.'
          : 'Sign in with your email to buy, sell and book a meetup. It is free, and sellers keep 100%.'}
      </Text>

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

      <TextLink
        align="center"
        variant="small"
        onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')}
      >
        {mode === 'signup' ? 'Already have an account? Log in' : 'New to Dibbs? Create an account'}
      </TextLink>
    </View>
  );

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false, title: 'Dibbs — the UArizona student marketplace' }} />
      <ScrollView ref={scroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Hero: the logo's own red, so the transparent wordmark has no seam. */}
        <View style={styles.hero}>
          <View style={styles.inner}>
            <View style={styles.topRow}>
              <Image
                source={WORDMARK}
                accessibilityLabel="Dibbs"
                contentFit="contain"
                style={{ width: wide ? 268 : 150, aspectRatio: WORDMARK_RATIO }}
              />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Log in"
                onPress={() => {
                  setMode('login');
                  scrollToRef(cardRef);
                }}
                style={styles.loginLink}
              >
                <Text variant="label" weight="700" color="white" style={styles.loginText}>
                  Log in
                </Text>
              </Pressable>
            </View>
            <Text variant="label" weight="600" color="white" style={styles.tagline}>
              CAMPUS MARKETPLACE
            </Text>
            {/* Headline and lede stay large: white on brand red is 3.96:1,
                which only passes for large text. Don't shrink them. */}
            <Text
              variant="hero"
              color="white"
              weight="700"
              accessibilityRole="header"
              style={[styles.h1, wide ? styles.h1Wide : null]}
            >
              Sell it today. Buy it tomorrow.
            </Text>
            <Text variant="lead" color="white" weight="600" style={styles.lede}>
              The quick, free campus marketplace for UArizona students. No haggling, sellers keep 100%, handed off in person on campus.
            </Text>
            <View style={styles.pill}>
              <Text variant="small" color="white" weight="600" style={styles.pillText}>
                University of Arizona students
              </Text>
            </View>
            {/* The Dibbs offer sits up here so it's one of the first things
                people see, not something they have to scroll to. */}
            <View style={styles.heroOffer}>
              <Camera size={22} color={colors.white} />
              <Text variant="body" color="white" weight="600" style={styles.heroOfferText}>
                Rather not list it? Send a photo to the Dibbs team and get an offer, within an hour during team hours.
              </Text>
            </View>
            <View style={styles.ctaRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create account"
                onPress={() => {
                  setWantsOffer(false);
                  setMode('signup');
                  scrollToRef(cardRef);
                }}
                style={({ pressed }) => [styles.cta, pressed ? { opacity: 0.85 } : null]}
              >
                <Text variant="heading" weight="700" color="accentInk">
                  Create account
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get a Dibbs offer"
                onPress={startOffer}
                style={({ pressed }) => [styles.ctaOutline, pressed ? { opacity: 0.85 } : null]}
              >
                <Text variant="heading" weight="700" color="white">
                  Get a Dibbs offer
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="How it works"
                onPress={() => scrollToRef(howRef)}
                style={styles.navLink}
              >
                <Text variant="label" weight="700">How it works</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.inner}>
          <View style={styles.offer}>
            <Text variant="caption" weight="700" color="accentInk" style={styles.sectionLabel}>
              GET A DIBBS OFFER
            </Text>
            <Text variant="displaySm" accessibilityRole="header">Sell it to Dibbs in three steps.</Text>
            <View style={[styles.offerSteps, wide ? styles.offerStepsWide : null]}>
              {OFFER_STEPS.map((s, i) => (
                <View key={s.title} style={[styles.offerStep, wide ? styles.offerStepWide : null]}>
                  <View style={styles.num}>
                    <Text variant="label" weight="700" color="accentInk">
                      {i + 1}
                    </Text>
                  </View>
                  <View style={styles.stepText}>
                    <Text variant="heading" weight="700">{s.title}</Text>
                    <Text variant="bodySm" color="inkMuted" style={styles.stepBody}>{s.body}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.offerFoot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create an account to get a Dibbs offer"
                onPress={startOffer}
                style={({ pressed }) => [styles.offerCta, pressed ? { opacity: 0.85 } : null]}
              >
                <Text variant="label" weight="700" color="white">Get a Dibbs offer</Text>
              </Pressable>
              <Text variant="small" color="inkMuted" style={styles.offerNote}>
                Offers within an hour during Dibbs team hours. You agree on how you get paid with the team; the app doesn’t handle payment.
              </Text>
            </View>
          </View>

          <View style={styles.benefits}>
            <Text variant="displaySm" accessibilityRole="header">Why students use Dibbs</Text>
            {PITCH.map((item) => (
              <View key={item.title} style={styles.benefit}>
                <Text variant="heading" accessibilityRole="header">{item.title}</Text>
                <Text variant="bodySm">{item.body}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.panel, wide ? styles.panelWide : null]}>

            <View ref={howRef} collapsable={false} style={[styles.steps, wide ? styles.stepsWide : null]}>
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
                    <Text variant="bodySm" color="inkMuted" style={styles.stepBody}>
                      {s.body}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View ref={cardRef} collapsable={false} style={wide ? styles.cardCol : undefined}>{card}</View>
          </View>

          <View style={styles.plain}>
            <Text variant="label" weight="700">
              What Dibbs is not
            </Text>
            <Text variant="label" color="inkMuted">
              Dibbs doesn’t hold your money, handle payment, or check who anyone is. A campus email shows someone controls that address, not who they are or whether to trust them. Meet in public, on campus, and use your own judgment.
            </Text>
          </View>

          <View style={styles.footer}>
            <Text variant="caption" color="inkFaint">
              Dibbs is an independent student project and is not affiliated with or endorsed by the University of
              Arizona.
            </Text>
            <View style={styles.legalRow}>
              <TextLink variant="small" href="/legal/terms">Terms</TextLink>
              <TextLink variant="small" href="/legal/privacy">Privacy</TextLink>
              <TextLink variant="small" href="/about">About</TextLink>
              <TextLink variant="small" href="/why-dibbs">Why Dibbs</TextLink>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loginLink: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.sm },
  loginText: { textDecorationLine: 'underline' },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, marginTop: space.xl },
  cta: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
    backgroundColor: colors.white,
    borderRadius: radius.md,
  },
  ctaOutline: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radius.md,
  },
  heroOffer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xl,
    maxWidth: 560,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroOfferText: { flex: 1 },
  navLink: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.md, backgroundColor: colors.white, borderRadius: radius.pill },
  offer: {
    marginTop: space.xxxl,
    padding: space.xl,
    gap: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  offerSteps: { gap: space.lg },
  offerStepsWide: { flexDirection: 'row', gap: space.xxl },
  offerStep: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  offerStepWide: { flex: 1 },
  offerFoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  offerCta: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  offerNote: { flexShrink: 1, flexBasis: 260 },
  benefits: { gap: space.md, paddingTop: space.xxxl },
  benefit: { padding: space.xl, borderRadius: radius.lg, gap: space.sm, backgroundColor: colors.tint },
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingBottom: 72 },
  inner: { width: '100%', maxWidth: 1060, alignSelf: 'center', paddingHorizontal: space.lg },

  hero: { backgroundColor: colors.brand, paddingTop: space.huge + space.xs, paddingBottom: 52 },
  tagline: { marginTop: space.xl, letterSpacing: 2.2 },
  h1: { marginTop: space.lg, maxWidth: 560 },
  h1Wide: { fontSize: 60, lineHeight: 63, letterSpacing: -1.3 },
  lede: { marginTop: 18, maxWidth: 520 },
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
  pillText: { letterSpacing: 0.3 },

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
  stepBody: { marginTop: 4 },

  cardCol: {
    width: 420,
    ...(Platform.OS === 'web' ? ({ position: 'sticky', top: 24 } as object) : null),
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: space.xxxl - space.xs,
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
  loading: { gap: space.md },

  plain: {
    marginTop: space.section,
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
  legalRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg },
});
