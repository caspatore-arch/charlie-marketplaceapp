import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * ============================================================================
 * APP IDENTITY — the ONLY place in this codebase to change these five values.
 * ============================================================================
 *
 * The brand name is DECIDED: the app is called Dibbs (double "b" — not the
 * dictionary spelling "dibs"). The iOS bundle identifier below is still the
 * founder's to confirm; see the ⚠️ note under BUNDLE_IDENTIFIER.
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
 *                       listing.
 *
 *                       ⚠️  "Dibbs" alone is ALREADY TAKEN on the App Store by
 *                       at least two unrelated apps, including a local-deals
 *                       app from Dibbs Technologies LLC and a collectibles
 *                       marketplace from Collectible Holdings Inc. App Store
 *                       names must be unique, so the *store listing* name will
 *                       have to be differentiated (e.g. "Dibbs — Campus
 *                       Resale"). That is a separate field in App Store
 *                       Connect; this constant is the home-screen name, which
 *                       has no uniqueness requirement and can stay "Dibbs".
 *                       See docs/APP-STORE.md.
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
 *                       app's first submission to Apple. "com.aspatore.dibbs"
 *                       is a reasonable default and will build and install
 *                       fine for internal/TestFlight testing — but CONFIRM it
 *                       is what you want (e.g. swap the middle segment for a
 *                       real company name if you incorporate) before you ever
 *                       run `eas submit --platform ios` against a production
 *                       build. See docs/APP-STORE.md.
 *
 * - SCHEME              The URL scheme used for deep links inside the app
 *                       ("dibbs://listing/123"). Not visible to users, but it
 *                       is NOT free-floating: `app/listing/[id].tsx` builds
 *                       share links with this exact prefix. Change one and
 *                       you must change the other, or shared links die.
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
const DISPLAY_NAME = 'Dibbs';
const SLUG = 'dibbs';
const BUNDLE_IDENTIFIER = 'com.aspatore.dibbs'; // 🟡 CONFIRM BEFORE FIRST APPLE SUBMISSION — permanent after that
const SCHEME = 'dibbs'; // must match the dibbs:// share links in app/listing/[id].tsx
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
