/**
 * Tiny .env loader. Deliberately dependency-free (no dotenv):
 * reads `.env` from the repo root once and fills in any keys that are not
 * already present in process.env (real env always wins).
 */
import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const file = path.resolve(process.cwd(), '.env');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env is fine — defaults below cover the dev path
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // strip a single layer of matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

export const env = {
  get databaseUrl(): string | undefined {
    const v = process.env.DATABASE_URL;
    return v && v.length > 0 ? v : undefined;
  },
  get pgliteDir(): string {
    return process.env.PGLITE_DIR ?? 'backend/data/pg';
  },
  get port(): number {
    return Number(process.env.PORT ?? 3000);
  },
  get devLogin(): boolean {
    return process.env.DEV_LOGIN === '1';
  },
  get platformFeePercent(): number {
    const n = Number(process.env.PLATFORM_FEE_PERCENT ?? 10);
    return Number.isFinite(n) ? n : 10;
  },
  get allowedEmailDomains(): string[] {
    return (process.env.ALLOWED_EMAIL_DOMAINS ?? 'arizona.edu,demo.campus.test')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  },
  /** Where LocalDiskStorage keeps uploaded files. */
  get uploadsDir(): string {
    return process.env.UPLOADS_DIR ?? 'backend/data/uploads';
  },
};
