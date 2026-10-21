/** Re-renders the caller every `intervalMs` (default 1 min) and returns Date.now(). */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "5h left" / "40m left" / "Expiring". */
export function timeLeftLabel(expiresAt: Date, now: number): string {
  const ms = expiresAt.getTime() - now;
  if (ms <= 60_000) return 'Expiring';
  const mins = Math.floor(ms / 60_000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h left`;
  return `${mins}m left`;
}
