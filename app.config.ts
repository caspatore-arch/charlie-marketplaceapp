import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * ============================================================================
 * APP IDENTITY — the ONLY place in this codebase to change these five values.
 * ============================================================================
 *
 * Everything below is a deliberate placeholder. The brand name and the iOS
 * bundle identifier are the founder's decision, not something to be guessed
 * by an AI assistant or an engineer — so they have not been guessed here.
 *
 * `app.json` still exists (Expo/EAS tooling expects a config file to be
 * present) and still carries the same placeholder identity values for
 * anything that reads app.json directly without going through this file —
 * but for the app that actually gets built, THIS file wins: the `name`,
 * `slug`, `version`, `scheme`, and `ios.bundleIdentifier` fields below
 * override whatever app.json says. Only edit the five constants here; do
 * not "fix" app.json's copies separately, or the two will drift.
 *
 * WHAT EACH VALUE AFFECTS, AND WHY IT MATTERS:
 *
 * - DISPLAY_NAME       The name under the app icon on a phone's home screen,
 *                       and the name shown in TestFlight / the App Store
 *                       listing. Currently "Campus Swap (dev)" — deliberately
 *                       an obvious placeholder so nobody mistakes a dev build
 *                       for a real release. Change this once the brand name
 *                       is decided.
 *
 * - SLUG                The URL-friendly project identifier Expo/EAS uses
 *                       internally (project dashboard URL, `expo start`
 *                       output, etc). Cosmetic — safe to leave as-is, but
 *                       update it if you rename the project for real.
 *
 * - BUNDLE_IDENTIFIER   The permanent iOS identity of this app, in
 *                       "com.yourcompany.yourappname" format. Apple ties
 *                       EVERYTHING to this one string: the App Store Connect
 *                       app record, TestFlight, push notification
 *                       certificates, in-app purchase products.
 *
 *                       ⚠️  A bundle identifier CANNOT be changed after the
 *                       app's first submission to Apple. "com.placeholder
 *                       .campusswap" will build and install fine for
 *                       internal/TestFlight testing — there is no rush to
 *                       change it for that — but it MUST be your real,
 *                       final choice before you ever run
 *                       `eas submit --platform ios` against a
 *                       production build. See docs/APP-STORE.md.
 *
 * - SCHEME              The URL scheme used for deep links inside the app
 *                       (e.g. "campusswap://listing/123"). Should generally
 *                       match the brand once one is chosen; not visible to
 *                       users otherwise.
 *
 * - VERSION             The user-facing version string (e.g. "1.0.0") shown
 *                       in the App Store listing. This is separate from the
 *                       invisible internal iOS "build number", which
 *                       `eas.json`'s `production` profile auto-increments on
 *                       every build — you only bump VERSION by hand when you
 *                       actually ship a new version to users.
 *
 * Full submission walkthrough: docs/APP-STORE.md.
 * ============================================================================
 */
const DISPLAY_NAME = 'Campus Swap (dev)'; // 🔴 PLACEHOLDER — brand name undecided, founder's call
const SLUG = 'campus-swap';
const BUNDLE_IDENTIFIER = 'com.placeholder.campusswap'; // 🔴 PLACEHOLDER — cannot change after first Apple submission
const SCHEME = 'campusswap';
const VERSION = '1.0.0';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: DISPLAY_NAME,
  slug: SLUG,
  version: VERSION,
  scheme: SCHEME,
  ios: {
    ...config.ios,
    bundleIdentifier: BUNDLE_IDENTIFIER,
  },
});
