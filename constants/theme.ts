/**
 * Design tokens for Dibbs. Source of truth: docs/DESIGN.md.
 * Keep these as plain StyleSheet-ready objects (no styling library).
 */
import { Platform, type ViewStyle } from 'react-native';

/**
 * Palette taken from the Dibbs Instagram: white wordmark on navy.
 *
 * The navy was sampled from the footer band of the Instagram post artwork
 * (it decodes to #0D305B across the set), so `brand` is that value, not a
 * guess. White on it is ~12:1, so unlike the old logo red there is no need to
 * split a "brand" colour from an "interactive" one for contrast; both are the
 * same navy and `accentPressed` darkens it for pressed states.
 *
 * Contrast notes: `accentInk` on `accentSoft` is ~11:1. Red is now used only
 * for `danger`, which finally makes destructive actions look different from
 * ordinary branded controls.
 */
export const colors = {
  // Near-white ground.
  bg: '#FCF8F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F0EE',
  /** Neutral warm tint for decorative cards (marketing/info sections). Use
   *  this, never successSoft/warningSoft/demoSoft, which carry status meaning. */
  tint: '#F0EAE6',
  ink: '#161513',
  inkMuted: '#6F6A62',
  // Passes AA (>=4.5:1) on EVERY surface it can land on: bg 5.22, surface
  // 5.51, surfaceMuted 4.87, accentSoft 4.75. The previous #767068 was tuned
  // against `bg` alone and silently failed on the muted surfaces (4.33 and
  // 4.22) — this darkening is barely perceptible and fixes that. Never
  // lighten it for looks; it was #A8A29A at 2.4:1 once, unreadable.
  inkFaint: '#6E6860',
  line: '#E8E1DE',

  /** The Instagram navy. Brand surfaces, splash, logo lockup. */
  brand: '#0D305B',
  /** Interactive navy. White text on this is AA at any size (~12:1). */
  accent: '#0D305B',
  /** Pressed state for accent surfaces. */
  accentPressed: '#09233F',
  /** Tinted background for accent chips and banners. */
  accentSoft: '#E6EDF6',
  /** Text/icons ON accentSoft. */
  accentInk: '#0D305B',

  success: '#2E7D4F',
  successSoft: '#E4F3EA',
  warning: '#9A6B00',
  warningSoft: '#FBF1D6',
  // Destructive actions. Red is now reserved for this, but still pair it with
  // an explicit verb ("Delete", "Cancel meetup") or icon, never colour alone.
  danger: '#9B1C1C',
  demo: '#5B4FCF',
  demoSoft: '#ECEAFB',
  white: '#FFFFFF',
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  /** Large cards (auth/sign-up card, hero panels). */
  xl: 22,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  /** Gap between major page sections. */
  section: 56,
} as const;

/**
 * Brand typeface: Montserrat, matching the geometric sans of the logo tagline.
 * React Native cannot synthesise weights from a custom font, so each weight is
 * its own loaded family (see app/_layout.tsx). Select with `fontFamilyFor`.
 * The stack after the family is the fallback if the fonts fail to load.
 */
export type FontWeight = '400' | '500' | '600' | '700';

const fallbackStack = Platform.select({
  web: ', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: '',
});

const familyByWeight: Record<FontWeight, string> = {
  '400': 'Montserrat_400Regular',
  '500': 'Montserrat_500Medium',
  '600': 'Montserrat_600SemiBold',
  '700': 'Montserrat_700Bold',
};

/** fontFamily for a weight. On web includes a system sans fallback stack;
 *  natively an unloaded family falls back to the system font automatically. */
export function fontFamilyFor(weight: FontWeight): string {
  return `${familyByWeight[weight]}${fallbackStack}`;
}

/** Type scale. Use with Text component's `variant` prop. fontWeight is kept
 *  alongside (Text maps it to the matching family and drops it). */
export const type = {
  /** Marketing hero headline (phone). Use 60/63 on wide screens inline. */
  hero: { fontSize: 38, lineHeight: 42, fontWeight: '700' as const, letterSpacing: -0.8 },
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  /** Between display and title: card and section headlines. */
  displaySm: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.3 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '600' as const },
  /** Intro paragraph under a headline. */
  lead: { fontSize: 20, lineHeight: 29, fontWeight: '400' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  /** Secondary paragraph copy (step descriptions, card body). */
  bodySm: { fontSize: 15, lineHeight: 23, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  // Montserrat's default figures are proportional; tabular-nums keeps price
  // columns aligned (Montserrat ships a `tnum` feature, honoured on web/iOS).
  price: { fontSize: 17, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as const },
};

/** One soft card shadow, iOS-tuned; Android uses elevation. */
export const shadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: {
    elevation: 3,
  },
  default: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
}) as ViewStyle;

/** Minimum touch target size per DESIGN.md accessibility rules. */
export const minTouchHeight = 48;

/**
 * Responsive breakpoints. Source of truth: docs/DESIGN.md § Responsive layout.
 * Only `lg` is load-bearing today: it is the single line between the phone
 * layout and the desktop layout. Read width from `useWindowDimensions`, never
 * `Dimensions.get()`, or a desktop window resize is never picked up.
 */
export const breakpoints = {
  sm: 390,   // iPhone 14 Pro / standard phone
  md: 600,   // large phone / split-view tablet pane
  lg: 768,   // tablet portrait / small laptop window
  xl: 1024,  // laptop / wide browser
} as const;

/**
 * Maximum content column width for desktop breakpoints. Source of truth: docs/DESIGN.md.
 * 860px fits a 3-column product grid (≈ 3 × 260px card + gutters) without
 * feeling cavernous on a 1440px monitor. It is wide enough that the two-column
 * phone grid also looks intentional if the window is narrow-desktop, yet
 * narrow enough to keep reading lines comfortable in text-heavy screens.
 */
export const maxContentWidth = 860;

export const theme = { colors, radius, space, type, shadow, minTouchHeight, breakpoints, maxContentWidth };
export default theme;
