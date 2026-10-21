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

/**
 * The link to hand to other people. https:// whenever we know the public
 * origin (always on web; on native only when EXPO_PUBLIC_WEB_BASE_URL is set),
 * otherwise the dibbs:// deep link. Third-party intent URLs need the https form.
 */
export function listingShareUrl(id: string): string {
  const base = webBaseUrl();
  if (base) return `${base}/listing/${id}`;
  return `dibbs://listing/${id}`;
}

/** True when the OS share sheet can be opened (all native, or web with navigator.share). */
export function canUseShareSheet(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

/**
 * Opens the OS share sheet with no alerts, so callers can show their own
 * confirmation. Returns 'cancelled' when the user closes the sheet.
 */
export async function openShareSheet(args: { title: string; text: string; url: string }): Promise<ShareOutcome> {
  try {
    if (Platform.OS !== 'web') {
      const result = await Share.share({ title: args.title, message: `${args.text}\n${args.url}`, url: args.url });
      return result.action === Share.dismissedAction ? 'cancelled' : 'shared';
    }
    await navigator.share({ title: args.title, text: args.text, url: args.url });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

/** Copies text to the clipboard (web). Returns whether it actually worked. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
  const url = listingShareUrl(listing.id);
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
