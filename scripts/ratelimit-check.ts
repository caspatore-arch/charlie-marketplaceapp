/**
 * Rate limiter keys and caps, checked without a database.
 *
 *   npm run test:ratelimit
 *
 * Covers: Cloudflare's CF-Connecting-IP wins over a faked X-Forwarded-For, so
 * changing that header per request no longer dodges a per-IP limit; signed-in
 * callers get their own bucket even on one shared IP; signed-out callers on
 * one IP get the larger IP cap; a 429 carries Retry-After.
 */
import { Hono } from 'hono';

import { __resetRateLimitsForTests, callerKey, rateLimit } from '../backend/ratelimit';

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
  const noCf = await hits(ipOnly, 6, () => ({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }));
  check('falls back to the first X-Forwarded-For entry without Cloudflare', noCf.at(-1) === 429 && noCf.slice(0, 5).every((s) => s === 200));

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

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
