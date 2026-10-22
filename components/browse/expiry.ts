import { useSyncExternalStore } from 'react';

/** Shared "Expires in Xh" wording for cards and the listing page (listings live 24h). */
export function expiresInLabel(expiresAt: Date | string | null | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'Expires in under 1m';
  if (mins < 60) return `Expires in ${mins}m`;
  return `Expires in ${Math.floor(mins / 60)}h`;
}

/** True when a live listing has under an hour left. */
export function expiresSoon(expiresAt: Date | string | null | undefined, now: number): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime() - now;
  return ms > 0 && ms < 3_600_000;
}

// One shared minute ticker for every card on screen (not one timer per card).
let minuteNow = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const subscribers = new Set<() => void>();

function subscribe(cb: () => void) {
  subscribers.add(cb);
  if (!timer) {
    minuteNow = Date.now();
    timer = setInterval(() => {
      minuteNow = Date.now();
      subscribers.forEach((fn) => fn());
    }, 60_000);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Current time, refreshed once a minute, shared across all subscribers. */
export function useMinuteNow(): number {
  return useSyncExternalStore(subscribe, () => minuteNow, () => minuteNow);
}
