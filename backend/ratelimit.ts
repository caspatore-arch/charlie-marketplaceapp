/**
 * Small in-memory, per-caller, fixed-window rate limiter. No new dependency.
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

export function clientIp(c: Context): string {
  // Which header can be trusted depends on what sits in front of us.
  //
  // Production runs on Render, which fronts every request with Cloudflare.
  // Cloudflare always overwrites CF-Connecting-IP with the address that opened
  // the connection to it, so a value a client sends is discarded before it
  // reaches us — that is the one header a visitor cannot choose.
  //
  // True-Client-IP is NOT read: Cloudflare only sets it on Enterprise plans, so
  // on other plans a client-sent value would pass straight through.
  //
  // X-Forwarded-For is a fallback for hosts without Cloudflare. Proxies append
  // to it, so everything left of the last entry is whatever the client wrote
  // (seen in the 2026-10-26 production load test: a fresh fake "IP" per
  // request dodged every limiter). Only the right-most entry was added by the
  // proxy nearest to us, so that is the one used. X-Real-IP is not read: with
  // no proxy in front, a client sets it to anything.
  //
  // Local dev (no proxy, no headers) gets one shared 'unknown' bucket.
  const cf = c.req.header('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
  return 'unknown';
}

/**
 * Turns a bearer token into a stable id for the person it belongs to, or null
 * when it is not a live session. Set once by backend/hono.ts (which owns the
 * database lookup) so this file stays free of database imports and the
 * limiter check script can run without one. Until it is set, every caller is
 * keyed by IP — the safe default.
 */
type SessionResolver = (authorizationHeader: string) => Promise<string | null>;
let resolveSession: SessionResolver = async () => null;

export function setSessionResolver(fn: SessionResolver): void {
  resolveSession = fn;
  sessionCache.clear();
}

// Recently confirmed sessions, so the limiter does not add a database round
// trip to every signed-in request. Only real sessions are cached (a stream of
// random tokens cannot fill it), entries live a minute, and the map is capped.
// A signed-out token can keep its own bucket for up to a minute; it still
// cannot do anything else, because createContext checks the session itself.
const SESSION_CACHE_TTL_MS = 60_000;
const SESSION_CACHE_MAX = 10_000;
const sessionCache = new Map<string, { id: string; expiresAt: number }>();

function tokenDigest(auth: string): string {
  return createHash('sha256').update(auth).digest('base64url').slice(0, 22);
}

/**
 * Identifies the caller for limiting: the signed-in person when the bearer
 * token is a real session, the IP otherwise.
 *
 * Keying purely on IP is wrong for a campus app. Several hundred students
 * share one NAT gateway on campus wifi, so a per-IP bucket treats the whole
 * campus as a single client and throttles everyone the moment the building
 * gets busy — the exact hour the app most needs to work. A signed-in user
 * carries a bearer token, which gives them their own bucket wherever they are.
 *
 * A token only earns its own bucket once it resolves to a live session.
 * Keying on any token string let a signed-out client send a fresh random
 * token per request and get a fresh bucket each time.
 *
 * Keys hold a hash or a user id, never a token, so the limiter's map cannot
 * become a second place session tokens sit in plaintext.
 */
export async function callerKey(c: Context): Promise<string> {
  const auth = c.req.header('authorization')?.trim();
  if (auth && /^Bearer\s+\S/i.test(auth)) {
    const digest = tokenDigest(auth);
    const now = Date.now();
    const cached = sessionCache.get(digest);
    if (cached && cached.expiresAt > now) return `u:${cached.id}`;
    let id: string | null = null;
    try {
      id = await resolveSession(auth);
    } catch {
      id = null; // database trouble: fall back to the IP bucket, never fail open
    }
    if (id) {
      if (sessionCache.size >= SESSION_CACHE_MAX) sessionCache.clear();
      sessionCache.set(digest, { id, expiresAt: now + SESSION_CACHE_TTL_MS });
      return `u:${id}`;
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
  sessionLimit: number,
  windowMs: number,
  keyOf: (c: Context) => string | Promise<string> = (c) => `ip:${clientIp(c)}`,
  /** Cap for callers keyed by IP; defaults to the same limit. Signed-out
   *  visitors on one campus wifi share an IP, so their bucket needs room. */
  ipLimit: number = sessionLimit,
) {
  return async (c: Context, next: Next) => {
    const who = await keyOf(c);
    const limit = who.startsWith('ip:') ? ipLimit : sessionLimit;
    if (!(limit > 0)) return next(); // limit <= 0 disables this limiter
    const now = Date.now();
    sweep(now);

    const key = `${name}:${who}`;
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
  sessionCache.clear();
}
