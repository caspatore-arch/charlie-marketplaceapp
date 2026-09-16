/**
 * Polls the backend's `/api/health` endpoint so the app can surface a clear
 * "can't reach the server" banner instead of letting every screen fail with
 * a raw network error. This is the single most likely first-run failure on
 * a real iPhone (wrong LAN IP, different Wi-Fi, or the backend not running).
 *
 * - Polls only while the app is foregrounded (AppState).
 * - Backs off from a 10s interval to a 30s interval while offline, so a
 *   genuinely unreachable server isn't hammered with requests.
 * - Each check is bounded by a short AbortController timeout so a hung
 *   request can't stall the next poll.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { apiBaseUrl } from '@/lib/trpc';

export type ConnectionStatus = 'checking' | 'online' | 'offline';

const ONLINE_POLL_MS = 10_000;
const OFFLINE_POLL_MS = 30_000;
const CHECK_TIMEOUT_MS = 5_000;

export interface UseConnectionResult {
  status: ConnectionStatus;
  apiBaseUrl: string;
  /** Forces an immediate check, resetting the backoff. */
  retry: () => void;
}

export function useConnection(): UseConnectionResult {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const check = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    let ok = false;
    try {
      const res = await fetch(`${apiBaseUrl}/api/health`, { signal: controller.signal });
      ok = res.ok;
    } catch {
      ok = false;
    } finally {
      clearTimeout(timeout);
    }

    if (!mountedRef.current) return;
    setStatus(ok ? 'online' : 'offline');

    // Only keep polling while foregrounded; the AppState listener resumes
    // it when the app comes back.
    if (appStateRef.current === 'active') {
      clearTimer();
      timerRef.current = setTimeout(check, ok ? ONLINE_POLL_MS : OFFLINE_POLL_MS);
    }
  }, [clearTimer]);

  const retry = useCallback(() => {
    clearTimer();
    setStatus('checking');
    void check();
  }, [check, clearTimer]);

  useEffect(() => {
    mountedRef.current = true;
    void check();

    const subscription = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === 'active' && prev !== 'active') {
        clearTimer();
        void check();
      } else if (next !== 'active') {
        clearTimer();
      }
    });

    return () => {
      mountedRef.current = false;
      clearTimer();
      subscription.remove();
    };
  }, [check, clearTimer]);

  return { status, apiBaseUrl, retry };
}

export default useConnection;
