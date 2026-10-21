/**
 * Share a listing URL on all three surfaces:
 *
 *  • iOS/Android native — delegates to React Native's Share sheet, which
 *    already works today. The link uses the custom `dibbs://` scheme because
 *    expo-router's deep-link handler understands it on device.
 *
 *  • iOS Safari (and other mobile web browsers) — uses navigator.share, which
 *    triggers the native iOS share sheet. The link is an `https://` URL so it
 *    is actually useful to the recipient (a custom scheme is meaningless in a
 *    browser). Falls back to clipboard + alert if the API is not available.
 *
 *  • Desktop web — navigator.share is usually absent. Copies the URL to the
 *    clipboard and shows a browser alert so the user gets feedback rather than
 *    nothing at all (the previous silent no-op was the bug).
 *
 * The `https://` base URL comes from:
 *   1. `EXPO_PUBLIC_WEB_BASE_URL` baked into the bundle at build time — set
 *      this to the final deployed origin (e.g. "https://dibbs.yourdomain.com").
 *   2. `window.location.origin` at runtime — correct for any dev or preview
 *      deploy even without setting the env var.
 *
 * Follows the same Platform-branch pattern as utils/confirm.ts.
 */
import { Platform, Share, Alert } from 'react-native';

function webBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export async function shareListing(listing: { id: string; title: string }): Promise<void> {
  if (Platform.OS !== 'web') {
    // Native iOS / Android — keep existing behaviour unchanged.
    const link = `dibbs://listing/${listing.id}`;
    try {
      await Share.share({
        title: listing.title,
        message: `${listing.title}\n${link}`,
        url: link,
      });
    } catch {
      // User cancelled or share unavailable — nothing to do.
    }
    return;
  }

  // Web: build a real https:// URL.
  const url = `${webBaseUrl()}/listing/${listing.id}`;
  const shareData: ShareData = { title: listing.title, url };

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData);
    } catch (err) {
      // AbortError means the user closed the sheet — not an error worth surfacing.
      if (err instanceof Error && err.name !== 'AbortError') {
        // Unexpected failure: fall through to clipboard.
        await copyToClipboard(url);
      }
    }
    return;
  }

  // navigator.share unavailable (most desktop browsers).
  await copyToClipboard(url);
}

async function copyToClipboard(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    // window.alert works on web; it blocks until dismissed, same as Alert.alert
    // on native. This matches the pattern in utils/confirm.ts.
    if (typeof window !== 'undefined') {
      window.alert('Link copied to clipboard.');
    }
  } catch {
    // Clipboard write failed (e.g. page not focused). Surface the URL so the
    // user can at least copy it manually.
    if (typeof window !== 'undefined') {
      window.alert(`Copy this link:\n${url}`);
    }
  }
}
