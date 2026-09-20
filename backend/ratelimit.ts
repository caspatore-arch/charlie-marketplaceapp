/**
 * Small in-memory, per-IP, fixed-window rate limiter. No new dependency.
 *
 * IMPORTANT — single instance only. State lives in a `Map` in this process's
 * memory. It resets on restart and is NOT shared across multiple instances:
 * if you ever run more than one backend process (multiple containers, a
 * scaled deploy, PM2 cluster mode, ...) each instance enforces its own
 * separate limit, so the *effective* per-IP limit becomes
 * `limit * instance count` and a client can dodge it by landing on a
 * different instance. That is fine for a single-instance pilot deploy; it is
 * not a substitute for a shared limiter. If you ever scale horizontally,
 * replace this with a shared store (Redis via e.g. `@upstash/ratelimit`, or
 * a limiter at the edge/reverse-proxy/CDN layer) — see docs/DEPLOY.md.
 */
import { createHash } from 'node:crypto';

import type { Context, Next } from 'hono';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bound memory growth: opportunistically sweep expired buckets on access
// instead of running a timer (keeps this dependency-free and inert in tests).
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function clientIp(c: Context): string {
  // Trust standard proxy headers (set by most hosts fronting the container:
  // Fly, Render, Railway, a load balancer). Falls back to a constant so local
  // dev (no proxy) still gets a single shared bucket rather than throwing.
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

/**
 * Identifies the caller for limiting: the session when there is one, the IP
 * only when there is not.
 *
 * Keying purely on IP is wrong for a campus app. Several hundred students
 * share one NAT gateway on campus wifi, so a per-IP bucket treats the whole
 * campus as a single client and throttles everyone the moment the building
 * gets busy — the exact hour the app most needs to work. A signed-in user
 * carries a bearer token, which gives them their own bucket wherever they are.
 *
 * The token is hashed rather than used directly, so the limiter's map cannot
 * become a second place session tokens sit in plaintext.
 */
export function callerKey(c: Context): string {
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token.length > 0) {
      return `s:${createHash('sha256').update(token).digest('base64url').slice(0, 22)}`;
    }
  }
  return `ip:${clientIp(c)}`;
}

/**
 * Returns Hono middleware that allows `limit` requests per `windowMs` per
 * (caller, `name`) pair, and responds 429 with a plain-English message once
 * exceeded. `keyOf` defaults to the client IP; pass `callerKey` for limits on
 * surfaces that authenticated users hit in normal use.
 */
export function rateLimit(
  name: string,
  limit: number,
  windowMs: number,
  keyOf: (c: Context) => string = (c) => `ip:${clientIp(c)}`,
) {
  return async (c: Context, next: Next) => {
    if (!(limit > 0)) return next(); // limit <= 0 disables this limiter
    const now = Date.now();
    sweep(now);

    const key = `${name}:${keyOf(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > limit) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        { error: 'Too many requests. Please wait a moment and try again.' },
        429,
      );
    }

    return next();
  };
}

/** Test-only: clears all buckets so limiter state doesn't leak between test runs. */
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}
