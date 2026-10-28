/**
 * Counts one site visit for the founder dashboard (POST /api/visit). On the
 * web it fires once per browser tab, so reloads and in-app navigation don't
 * add more; in the phone app it fires once per launch. Sends only the
 * platform name. Failures are ignored: counting must never affect the app.
 */
import { Platform } from 'react-native';

import { apiBaseUrl } from '@/lib/trpc';

const KEY = 'dibbs.visitCounted';
let sent = false;

export function countVisit(): void {
  if (sent) return;
  sent = true;
  const platform = Platform.OS === 'web' || Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
  if (!platform) return;
  if (platform === 'web') {
    try {
      if (window.sessionStorage.getItem(KEY)) return;
      window.sessionStorage.setItem(KEY, '1');
    } catch {
      // storage blocked (private mode); count anyway
    }
  }
  fetch(`${apiBaseUrl}/api/visit?platform=${platform}`, { method: 'POST' }).catch(() => {});
}
