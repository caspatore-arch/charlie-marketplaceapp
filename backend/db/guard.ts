/**
 * PGlite allows exactly one writer per data directory. If `npm run backend` is
 * already holding `backend/data/pg`, seeding or resetting from a second process
 * does not fail cleanly — it corrupts in-flight queries and the running server
 * starts returning 500s that look like application bugs.
 *
 * Both `db:seed` and `db:reset` call this first. (No-op when DATABASE_URL points
 * at a real Postgres, which handles concurrent writers properly.)
 */
import { loadEnv } from '../env';

export async function refuseIfBackendRunning(): Promise<void> {
  if (process.env.DATABASE_URL) return;
  const port = Number(process.env.PORT ?? 3000);
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return;
  } catch {
    return; // nothing listening: safe to proceed
  }
  console.error(
    `\nThe backend is already running on port ${port} and has the local database open.\n` +
      `PGlite allows only one writer, so this would break that server.\n\n` +
      `Stop it (Ctrl-C in its terminal), run this again, then start it back up.\n`,
  );
  process.exit(1);
}

// `npm run db:reset` runs this as its own step, before deleting the data dir.
if (process.argv[1] && process.argv[1].endsWith('guard.ts')) {
  loadEnv();
  void refuseIfBackendRunning();
}
