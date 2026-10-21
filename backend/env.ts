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
  /* --------------------------------------------------------------- email */

  /** Raw EMAIL_MODE. Decisions go through resolveEmailMode() (backend/email/provider.ts). */
  get emailModeRaw(): string {
    return (process.env.EMAIL_MODE ?? 'simulated').trim().toLowerCase();
  },
  get resendApiKey(): string | undefined {
    const v = process.env.RESEND_API_KEY?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  /** e.g. "Dibbs <codes@trydibbs.com>" — the domain must be verified in Resend. */
  get emailFrom(): string | undefined {
    const v = process.env.EMAIL_FROM?.trim();
    return v && v.length > 0 ? v : undefined;
  },

  /* ----------------------------------------------------------------- sms */

  /**
   * Raw SMS_MODE. Never read for a decision — use `resolveSmsMode()` in
   * backend/sms/provider.ts, which forces `simulated` unless every live
   * credential AND SMS_LIVE_ACK=1 are present, and always in tests.
   */
  get smsModeRaw(): string {
    return (process.env.SMS_MODE ?? 'simulated').trim().toLowerCase();
  },
  get twilioAccountSid(): string | undefined {
    const v = process.env.TWILIO_ACCOUNT_SID?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  get twilioAuthToken(): string | undefined {
    const v = process.env.TWILIO_AUTH_TOKEN?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  /** Sending number (E.164) or Messaging Service SID (MG…). */
  get twilioFrom(): string | undefined {
    const v = process.env.TWILIO_FROM?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  /** Second switch for real sends, so one variable can't text real phones. */
  get smsLiveAck(): boolean {
    return process.env.SMS_LIVE_ACK === '1';
  },
  /** How often the outbox dispatcher runs in backend/server.ts. 0 disables it. */
  get smsDispatchIntervalMs(): number {
    const n = Number(process.env.SMS_DISPATCH_INTERVAL_MS ?? 30_000);
    return Number.isFinite(n) && n >= 0 ? n : 30_000;
  },
  /** Public link put in texts (the website). Falls back to the dibbs:// scheme. */
  get smsAppLinkBase(): string {
    return (process.env.SMS_APP_LINK_BASE ?? process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '').replace(/\/$/, '');
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

  /* --------------------------------------------------------------- s3 */

  /** Bucket name. Setting this is the switch that selects S3Storage over LocalDiskStorage. */
  get s3Bucket(): string | undefined {
    const v = process.env.S3_BUCKET?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  get s3Region(): string | undefined {
    const v = process.env.S3_REGION?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  /** Optional; required for R2/B2/Wasabi/any non-AWS S3-compatible endpoint. */
  get s3Endpoint(): string | undefined {
    const v = process.env.S3_ENDPOINT?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  get s3AccessKeyId(): string | undefined {
    const v = process.env.S3_ACCESS_KEY_ID?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  get s3SecretAccessKey(): string | undefined {
    const v = process.env.S3_SECRET_ACCESS_KEY?.trim();
    return v && v.length > 0 ? v : undefined;
  },
  /** Optional. When set, uploaded object URLs are served from it directly instead of proxied. */
  get s3PublicBaseUrl(): string | undefined {
    const v = process.env.S3_PUBLIC_BASE_URL?.trim();
    return v && v.length > 0 ? v.replace(/\/$/, '') : undefined;
  },

  /* ---------------------------------------------------------- http/prod */

  get nodeEnv(): string {
    return (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  },
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },
  /** Comma-separated allowlist of origins accepted in production. Ignored in development. */
  get allowedOrigins(): string[] {
    return (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  },

  /* --------------------------------------------------------- rate limits */

  get rateLimitAuthRequestCodePerMinute(): number {
    return Number(process.env.RATE_LIMIT_AUTH_REQUEST_CODE_PER_MIN ?? 5);
  },
  get rateLimitAuthVerifyCodePerMinute(): number {
    return Number(process.env.RATE_LIMIT_AUTH_VERIFY_CODE_PER_MIN ?? 10);
  },
  get rateLimitPhoneRequestPerMinute(): number {
    return Number(process.env.RATE_LIMIT_PHONE_REQUEST_PER_MIN ?? 5);
  },
  get rateLimitPhoneVerifyPerMinute(): number {
    return Number(process.env.RATE_LIMIT_PHONE_VERIFY_PER_MIN ?? 10);
  },
  get rateLimitCheckAddressPerMinute(): number {
    return Number(process.env.RATE_LIMIT_CHECK_ADDRESS_PER_MIN ?? 12);
  },
  get rateLimitUploadsPerMinute(): number {
    return Number(process.env.RATE_LIMIT_UPLOADS_PER_MIN ?? 20);
  },
  /** Per-IP cap on tRPC calls, the API surface that carries all real traffic. */
  get rateLimitApiPerMinute(): number {
    return Number(process.env.RATE_LIMIT_API_PER_MIN ?? 300);
  },

  /* ------------------------------------------------ postgres connections */

  /**
   * Pool size per backend process. The ceiling that matters is the database's
   * own connection limit divided by the number of app instances — a managed
   * Postgres hobby tier is often 20-ish in total, so two instances at the
   * node-postgres default of 10 already saturate it.
   */
  get dbPoolMax(): number {
    return Number(process.env.DB_POOL_MAX ?? 10);
  },
  /**
   * How long a request waits for a free connection before failing. The
   * node-postgres default is 0, meaning wait forever: under a burst every
   * request queues indefinitely and the process stops responding rather than
   * shedding load. A bounded wait turns that into an error the caller can see.
   */
  get dbConnectionTimeoutMs(): number {
    return Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000);
  },
  /**
   * Server-side cap on a single statement. Without it one pathological query
   * holds a pooled connection until the client gives up, which at pool size 10
   * means ten of them take the whole instance down.
   */
  get dbStatementTimeoutMs(): number {
    return Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 10_000);
  },
};

/**
 * Validate the S3 env vars as a group. Call once at startup (backend/server.ts).
 * If S3_BUCKET is set, the companion vars it needs must be present too — fail
 * loudly and early rather than falling back to local disk silently or hitting
 * a confusing SDK error on the first upload. Never logs secret values.
 */
export function validateS3Env(): void {
  if (!env.s3Bucket) return; // local disk mode — nothing to validate
  const missing: string[] = [];
  if (!env.s3Region) missing.push('S3_REGION');
  if (!env.s3AccessKeyId) missing.push('S3_ACCESS_KEY_ID');
  if (!env.s3SecretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
  if (missing.length > 0) {
    throw new Error(
      `S3_BUCKET is set but missing required env var(s): ${missing.join(', ')}. ` +
        'Set every S3_* variable listed in .env.example, or unset S3_BUCKET to use local disk storage.',
    );
  }
}
