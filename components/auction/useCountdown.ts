/**
 * Live-ish countdown to an auction's end time.
 *
 *   const { label, ended } = useCountdown(listing.expiresAt);
 *
 * Recomputes on an interval — every second inside the last hour, every minute
 * before that — so a detail screen ticks without re-rendering the whole tree
 * 60x a minute for an auction that ends tomorrow.
 */
import { useEffect, useMemo, useState } from 'react';

export function formatTimeLeft(msLeft: number): string {
  if (msLeft <= 0) return 'Ended';
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

/** Short form for a feed card: "3h", "12m", "Ended". */
export function formatTimeLeftShort(msLeft: number): string {
  if (msLeft <= 0) return 'Ended';
  const totalMinutes = Math.floor(msLeft / 60000);
  if (totalMinutes >= 1440) return `${Math.floor(totalMinutes / 1440)}d`;
  if (totalMinutes >= 60) return `${Math.floor(totalMinutes / 60)}h`;
  if (totalMinutes >= 1) return `${totalMinutes}m`;
  return '<1m';
}

export interface Countdown {
  msLeft: number;
  label: string;
  shortLabel: string;
  ended: boolean;
  /** Under 5 minutes — worth calling out in the UI. */
  urgent: boolean;
}

export function useCountdown(endsAt: Date | string | null | undefined): Countdown {
  const endMs = useMemo(() => {
    if (!endsAt) return null;
    const d = endsAt instanceof Date ? endsAt : new Date(endsAt);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }, [endsAt]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endMs === null) return;
    // Self-scheduling so the cadence tightens as the deadline approaches, and
    // stops entirely once the auction is over.
    const period = (remaining: number) => (remaining < 60 * 60 * 1000 ? 1000 : 60 * 1000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const remaining = endMs - t;
      if (remaining > 0) timer = setTimeout(tick, period(remaining));
    };
    const initial = endMs - Date.now();
    if (initial <= 0) {
      setNow(Date.now());
      return;
    }
    timer = setTimeout(tick, period(initial));
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [endMs]);

  const msLeft = endMs === null ? 0 : Math.max(0, endMs - now);
  return {
    msLeft,
    label: endMs === null ? '' : formatTimeLeft(msLeft),
    shortLabel: endMs === null ? '' : formatTimeLeftShort(msLeft),
    ended: endMs !== null && msLeft <= 0,
    urgent: endMs !== null && msLeft > 0 && msLeft < 5 * 60 * 1000,
  };
}
