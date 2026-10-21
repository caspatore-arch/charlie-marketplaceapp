/** Countdown for "Resend code in Ns". `start(seconds)` restarts it; ticks once a second only while running. */
import { useCallback, useEffect, useState } from 'react';

export function useCooldown() {
  const [endsAt, setEndsAt] = useState(0);
  const [now, setNow] = useState(0);

  const running = endsAt > now;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setEndsAt(t + seconds * 1000);
  }, []);

  return { secondsLeft: Math.max(0, Math.ceil((endsAt - now) / 1000)), start };
}
