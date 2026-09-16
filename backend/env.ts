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
  /** User ids granted basic moderation access (report review). */
  get moderatorUserIds(): string[] {
    return (process.env.MODERATOR_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  },
  /* ------------------------------------------------------------ payments */

  /**
   * Raw value of PAYMENTS_MODE. Never read this directly for a decision —
   * use `resolvePaymentsMode()` in backend/stripe/client.ts, which forces
   * `simulated` when there is no secret key (docs/AUCTIONS.md §3).
   */
  get paymentsModeRaw(): string {
    return (process.env.PAYMENTS_MODE ?? 'simulated').trim().toLowerCase();
  },
  get stripeSecretKey(): string | undefined {
    const v = process.env.STRIPE_SECRET_KEY?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  get stripeWebhookSecret(): string | undefined {
    const v = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  /** `live` additionally requires this, so one variable cannot reach real money. */
  get stripeLiveAck(): boolean {
    return process.env.STRIPE_LIVE_ACK === '1';
  },
  /**
   * How many days Stripe holds a seller's funds before paying them out —
   * `settings.payouts.schedule.delay_days` on the connected Express account.
   *
   * **Default 0**, which this app maps to Stripe's `minimum` (the lowest value
   * the seller's country allows) — i.e. pay the seller out as fast as Stripe
   * will. That is the riskiest setting under direct charges: a dispute that
   * lands after payout usually finds no seller balance to draw from, so
   * Stripe's negative-balance rules push the residual loss back onto the
   * platform. `7` is the recommended pilot value. See docs/AUCTIONS.md §3.
   *
   * Validated as an integer 0–30; anything else throws rather than silently
   * choosing a number nobody intended.
   */
  get payoutDelayDays(): number {
    const raw = process.env.PAYOUT_DELAY_DAYS?.trim();
    if (raw === undefined || raw === '') return 0;
    if (!/^\d+$/.test(raw)) {
      throw new Error(`PAYOUT_DELAY_DAYS must be a whole number 0–30, got "${raw}".`);
    }
    const n = Number(raw);
    if (n < 0 || n > 30) {
      throw new Error(`PAYOUT_DELAY_DAYS must be between 0 and 30, got ${n}.`);
    }
    return n;
  },

  /** Public base URL Stripe returns the seller to after Connect onboarding. */
  get publicAppUrl(): string {
    return (process.env.PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(
      /\/$/,
      '',
    );
  },

  /** Where LocalDiskStorage keeps uploaded files. */
  get uploadsDir(): string {
    return process.env.UPLOADS_DIR ?? 'backend/data/uploads';
  },
};
