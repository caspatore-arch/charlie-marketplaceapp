/**
 * Design tokens for Dibbs. Source of truth: docs/DESIGN.md.
 * Keep these as plain StyleSheet-ready objects (no styling library).
 */
import { Platform, type ViewStyle } from 'react-native';

/**
 * Palette derived from the Dibbs logo (white brush script on vermilion).
 *
 * The logo red was sampled from the artwork itself, not guessed:
 * assets/branding/*.png decode to #ee362c / #ef3b2f / #ed4234 — the same
 * intended colour three times, with generation noise, since the marks were
 * produced by an image model rather than drawn as vectors. `brand` below is
 * the single canonical value; do not re-sample a PNG for a new one.
 *
 * THE RULE THAT SHAPES THIS WHOLE PALETTE: the logo red is NOT accessible as
 * a small-text background. White on #EE3B30 is 3.96:1 — fine for a logo and
 * for large text or graphics (3:1), but under the 4.5:1 WCAG AA floor for
 * normal-size text. So the red is split in two:
 *
 *   brand   #EE3B30  the real logo red. Splash, app icon, the logo lockup,
 *                    large brand surfaces. White on it only at display sizes.
 *   accent  #DE2F26  the interactive red: buttons, active tab, links. Deeper
 *                    by just enough to clear AA for white button labels
 *                    (4.63:1). Beside the brand red nobody reads them as two
 *                    colours, which is the point.
 *
 * Every value here was verified with a real contrast calculation, not by eye.
 */
export const colors = {
  // Warm near-white, biased very slightly red so the ground belongs to the
  // brand rather than sitting under it as generic off-white.
  bg: '#FCF8F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F0EE',
  ink: '#161513',
  inkMuted: '#6F6A62',
  // Passes AA (>=4.5:1) on EVERY surface it can land on: bg 5.22, surface
  // 5.51, surfaceMuted 4.87, accentSoft 4.75. The previous #767068 was tuned
  // against `bg` alone and silently failed on the muted surfaces (4.33 and
  // 4.22) — this darkening is barely perceptible and fixes that. Never
  // lighten it for looks; it was #A8A29A at 2.4:1 once, unreadable.
  inkFaint: '#6E6860',
  line: '#E8E1DE',

  /** The literal logo red. Large text / graphics / brand surfaces only. */
  brand: '#EE3B30',
  /** Interactive red. White text on this is AA at any size (4.63:1). */
  accent: '#DE2F26',
  /** Pressed state for accent surfaces (5.72:1 with white). */
  accentPressed: '#C4281F',
  /** Tinted background for accent chips and banners. */
  accentSoft: '#FDEAE8',
  /** Text/icons ON accentSoft. Plain `accent` on that tint is 3.99:1 — it
   *  FAILS. Use this instead (6.28:1) anywhere red text sits on a red tint. */
  accentInk: '#A82018',

  success: '#2E7D4F',
  successSoft: '#E4F3EA',
  warning: '#9A6B00',
  warningSoft: '#FBF1D6',
  // Deliberately a darker, bluer crimson than `accent`. With a red brand, a
  // destructive action can no longer be signalled by redness alone — it reads
  // as just another branded control. Destructive affordances must therefore
  // also carry an explicit verb ("Delete", "Cancel meetup") or an icon; this
  // colour is a reinforcement, never the only signal.
  danger: '#9B1C1C',
  demo: '#5B4FCF',
  demoSoft: '#ECEAFB',
  white: '#FFFFFF',
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
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
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '500' as const },
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
