/**
 * Design tokens for Campus Swap. Source of truth: docs/DESIGN.md.
 * Keep these as plain StyleSheet-ready objects (no styling library).
 */
import { Platform, type ViewStyle } from 'react-native';

export const colors = {
  bg: '#FAF8F5',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EDE7',
  ink: '#161513',
  inkMuted: '#6F6A62',
  // 4.62:1 on `bg`, 4.90:1 on `surface` — WCAG AA for small text. It sits close
  // to `inkMuted` on purpose: on a near-white ground a genuinely faint grey
  // cannot reach 4.5:1. Do not lighten this back to a prettier value (it was
  // #A8A29A at 2.4:1, unreadable for low-vision users).
  inkFaint: '#767068',
  line: '#E6E1DA',
  accent: '#C8442B',
  accentSoft: '#FBE9E4',
  success: '#2E7D4F',
  successSoft: '#E4F3EA',
  warning: '#9A6B00',
  warningSoft: '#FBF1D6',
  danger: '#B3261E',
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

/** Type scale. Use with Text component's `variant` prop. */
export const type = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
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

export const theme = { colors, radius, space, type, shadow, minTouchHeight };
export default theme;
