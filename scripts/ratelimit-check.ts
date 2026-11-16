/**
 * Rate limiter keys and caps, checked without a database.
 *
 *   npm run test:ratelimit
 *
 * Covers: Cloudflare's CF-Connecting-IP wins over a faked X-Forwarded-For, so
 * changing that header per request no longer dodges a per-IP limit; without
 * Cloudflare only the right-most (proxy-added) X-Forwarded-For hop counts;
 * True-Client-IP and X-Real-IP are ignored; signed-in callers get their own
 * bucket even on one shared IP; a token that is not a live session gets no
 * bucket of its own; signed-out callers on one IP get the larger IP cap; a
 * 429 carries Retry-After. Sessions come from a stub resolver, so no database.
 */
import { Hono } from 'hono';

import { __resetRateLimitsForTests, callerKey, rateLimit, setSessionResolver } from '../backend/ratelimit';

// Stand-in for the session lookup backend/hono.ts installs: only these two
// tokens are live sessions.
const LIVE: Record<string, string> = { 'Bearer alice-token': 'alice', 'Bearer bob-token': 'bob' };
let lookups = 0;
setSessionResolver(async (header) => {
  lookups += 1;
  return LIVE[header] ?? null;
});

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function hits(app: Hono, n: number, headers: (i: number) => Record<string, string>) {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) codes.push((await app.request('/x', { headers: headers(i) })).status);
  return codes;
}

async function main() {
  const ipOnly = new Hono();
  ipOnly.use('*', rateLimit('ip-only', 5, 60_000));
  ipOnly.get('/x', (c) => c.text('ok'));

  __resetRateLimitsForTests();
  const spoofed = await hits(ipOnly, 8, (i) => ({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': `198.18.0.${i}` }));
  check('faked X-Forwarded-For cannot dodge the limit behind Cloudflare', spoofed.filter((s) => s === 429).length === 3, spoofed.join(','));

  __resetRateLimitsForTests();
  const twoVisitors = [
    ...(await hits(ipOnly, 5, () => ({ 'cf-connecting-ip': '203.0.113.8' }))),
    ...(await hits(ipOnly, 5, () => ({ 'cf-connecting-ip': '203.0.113.9' }))),
  ];
  check('different real visitors get separate buckets', twoVisitors.every((s) => s === 200));

  __resetRateLimitsForTests();
  const noCf = await hits(ipOnly, 6, (i) => ({ 'x-forwarded-for': `198.51.100.${i}, 10.0.0.1` }));
  check('without Cloudflare, only the right-most X-Forwarded-For hop counts', noCf.at(-1) === 429 && noCf.slice(0, 5).every((s) => s === 200), noCf.join(','));

  __resetRateLimitsForTests();
  const fakeHeaders = await hits(ipOnly, 6, (i) => ({ 'true-client-ip': `198.18.1.${i}`, 'x-real-ip': `198.18.2.${i}` }));
  check('True-Client-IP and X-Real-IP cannot pick a bucket', fakeHeaders.at(-1) === 429, fakeHeaders.join(','));

  const api = new Hono();
  api.use('*', rateLimit('api', 3, 60_000, callerKey, 10));
  api.get('/x', (c) => c.text('ok'));

  __resetRateLimitsForTests();
  const sameWifi = { 'cf-connecting-ip': '203.0.113.20' };
  const anon = await hits(api, 10, () => sameWifi);
  check('signed-out visitors on one wifi get the larger IP cap', anon.every((s) => s === 200));
  const anonOver = await api.request('/x', { headers: sameWifi });
  check('the IP cap still ends in a 429 with Retry-After', anonOver.status === 429 && !!anonOver.headers.get('retry-after'));

  const alice = await hits(api, 3, () => ({ ...sameWifi, authorization: 'Bearer alice-token' }));
  const bob = await hits(api, 3, () => ({ ...sameWifi, authorization: 'Bearer bob-token' }));
  check('signed-in people on that same wifi are not blocked by it', [...alice, ...bob].every((s) => s === 200));
  const aliceOver = (await api.request('/x', { headers: { ...sameWifi, authorization: 'Bearer alice-token' } })).status;
  check('each signed-in person still has their own cap', aliceOver === 429);
  check('confirmed sessions are cached, not looked up on every request', lookups <= 2, `${lookups} lookups`);

  __resetRateLimitsForTests();
  const randomTokens = await hits(api, 12, (i) => ({ 'cf-connecting-ip': '203.0.113.30', authorization: `Bearer random-${i}-${Math.random()}` }));
  check(
    'random bearer tokens share the IP bucket instead of getting fresh ones',
    randomTokens.slice(0, 10).every((s) => s === 200) && randomTokens.slice(10).every((s) => s === 429),
    randomTokens.join(','),
  );

  __resetRateLimitsForTests();
  setSessionResolver(async () => {
    throw new Error('database down');
  });
  const dbDown = await hits(api, 11, () => ({ 'cf-connecting-ip': '203.0.113.31', authorization: 'Bearer alice-token' }));
  check('a failed session lookup falls back to the IP bucket (still limited)', dbDown.at(-1) === 429, dbDown.join(','));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
