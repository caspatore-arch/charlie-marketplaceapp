/**
 * HTTP-layer hardening, checked against the in-process server and a
 * throwaway PGlite.
 *
 *   npm run test:hardening
 *
 * Covers: tRPC batching is refused before any call runs; the sign-in code
 * limiters fire through path variants (trailing slash, encoded letter, query
 * string, case change) and across the email/phone twins; random bearer tokens
 * do not get fresh buckets; the Stripe webhook and test hook are gone in
 * production with simulated payments and still answer otherwise; oversized and
 * chunked bodies get a 413 before they are buffered; a `demo-` named user
 * upload cannot overwrite seeded art; a non-image with an image type is
 * refused; served uploads carry nosniff; /api/health reports storage mode.
 * Modules load with `await import(...)` after the env block (see archive-check).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR = 'backend/data/hardening-check-pg';
process.env.DATABASE_URL = ''; // never touch a hosted database
process.env.NODE_ENV = 'test';
process.env.UPLOADS_DIR = 'backend/data/hardening-check-uploads';
process.env.PRIVATE_UPLOADS_DIR = 'backend/data/hardening-check-private';
process.env.PAYMENTS_MODE = 'simulated';
process.env.DEV_LOGIN = '1';
process.env.RATE_LIMIT_AUTH_REQUEST_CODE_PER_MIN = '3';
process.env.RATE_LIMIT_AUTH_VERIFY_CODE_PER_MIN = '3';
process.env.RATE_LIMIT_PHONE_REQUEST_PER_MIN = '3';
process.env.RATE_LIMIT_PHONE_VERIFY_PER_MIN = '3';
process.env.RATE_LIMIT_API_PER_MIN = '10000';
process.env.RATE_LIMIT_API_ANON_PER_MIN = '40';
process.env.RATE_LIMIT_UPLOADS_PER_MIN = '1000';
delete process.env.EMAIL_MODE;
delete process.env.SMS_MODE;
delete process.env.S3_BUCKET;
delete process.env.S3_PRIVATE_BUCKET;
for (const dir of [process.env.PGLITE_DIR, process.env.UPLOADS_DIR, process.env.PRIVATE_UPLOADS_DIR]) {
  fs.rmSync(path.resolve(dir), { recursive: true, force: true });
}

let n = 0;
let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  n += 1;
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${String(n).padStart(2)}. ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);

/** A body that streams in `chunks` pieces with no Content-Length (chunked upload). */
function streamOf(totalBytes: number, chunk = 1024 * 1024): ReadableStream<Uint8Array> {
  const piece = new Uint8Array(chunk);
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const size = Math.min(chunk, totalBytes - sent);
      controller.enqueue(size === chunk ? piece : piece.subarray(0, size));
      sent += size;
    },
  });
}

async function main() {
  const { count } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const { campuses, emailCodes, sessions, users } = await import('../backend/db/schema');
  const { hashToken } = await import('../backend/trpc/create-context');
  const { storage } = await import('../backend/storage');
  const { FAKE_WEBHOOK_SIGNATURE } = await import('../backend/stripe/fake');
  const { app } = await import('../backend/hono');

  await runMigrations();

  const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
  const USER_ID = '00000000-0000-4000-8000-00000000c0de';
  await db.insert(campuses).values({ id: CAMPUS_ID, name: 'Demo U', slug: 'demo-u', emailDomains: ['demo.campus.test'], timezone: 'America/Phoenix', isDemo: true });
  await db.insert(users).values({ id: USER_ID, email: 'hardening@demo.campus.test', displayName: 'Hardening', campusId: CAMPUS_ID, campusEmailVerifiedAt: new Date(), isDemo: true });
  const token = crypto.randomBytes(32).toString('hex');
  await db.insert(sessions).values({ userId: USER_ID, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) });
  const bearer = `Bearer ${token}`;

  const ip = (last: number) => ({ 'cf-connecting-ip': `203.0.113.${last}` });
  const json = (body: unknown) => JSON.stringify({ json: body });
  const post = async (url: string, headers: Record<string, string>, body: string): Promise<Response> =>
    app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  const codeRows = async () => (await db.select({ n: count() }).from(emailCodes))[0]!.n;

  /* -------------------------------------------------------- 1. batching */

  const before = await codeRows();
  const batched = await post(
    '/api/trpc/auth.requestCode,auth.requestCode?batch=1',
    ip(1),
    JSON.stringify({ 0: { json: { email: 'a1@demo.campus.test' } }, 1: { json: { email: 'a2@demo.campus.test' } } }),
  );
  check('a batched POST is refused with 400', batched.status === 400, `got ${batched.status}`);
  check('the batched calls did not run (no sign-in codes created)', (await codeRows()) === before);
  const batchedGet = await app.request('/api/trpc/auth.methods?batch=1&input=%7B%7D', { headers: ip(1) });
  check('a batch of one (GET ?batch=1) is refused too', batchedGet.status === 400, `got ${batchedGet.status}`);
  const commaNoFlag = await post('/api/trpc/auth.requestCode%2Cauth.requestCode', ip(1), json({ email: 'a3@demo.campus.test' }));
  check('a comma-joined path without ?batch is refused', commaNoFlag.status === 400 && (await codeRows()) === before, `got ${commaNoFlag.status}`);
  const plain = await app.request('/api/trpc/auth.methods', { headers: ip(1) });
  check('an ordinary single call still works', plain.status === 200, `got ${plain.status}`);

  /* ------------------------------------------- 2. limiters vs path tricks */

  const variants = (proc: string) => [
    `/api/trpc/${proc}/`,
    `/api/trpc/${proc.replace(/e/, '%65')}`,
    `/api/trpc/${proc}?utm=1`,
    `/api/trpc/${proc.toUpperCase()}`,
    `/api/trpc//${proc}//`,
  ];
  const verifyBody = json({ email: 'v@demo.campus.test', code: '000000' });
  const reached = await post('/api/trpc/auth.verifyCode/', ip(20), verifyBody);
  check('a trailing-slash variant does reach the procedure (so it must be limited)', reached.status !== 404 && reached.status !== 429, `got ${reached.status}`);

  for (let i = 0; i < 3; i++) await post('/api/trpc/auth.verifyCode', ip(21), verifyBody);
  const verifyVariants = await Promise.all(variants('auth.verifyCode').map((u) => post(u, ip(21), verifyBody).then((r) => r.status)));
  check('verify-code limiter fires through every path variant', verifyVariants.every((s) => s === 429), verifyVariants.join(','));
  const twin = await post('/api/trpc/auth.confirmEmailLink', { ...ip(21), authorization: bearer }, verifyBody);
  check('confirmEmailLink shares the verify-code bucket', twin.status === 429, `got ${twin.status}`);

  const reqBody = json({ email: 'r@demo.campus.test' });
  for (let i = 0; i < 3; i++) await post('/api/trpc/auth.requestCode', ip(22), reqBody);
  const reqVariants = await Promise.all(variants('auth.requestCode').map((u) => post(u, ip(22), reqBody).then((r) => r.status)));
  check('request-code limiter fires through every path variant', reqVariants.every((s) => s === 429), reqVariants.join(','));

  for (let i = 0; i < 3; i++) await post('/api/trpc/auth.requestPhoneCode', ip(23), json({ phone: '+15205550100' }));
  const phoneTwin = await post('/api/trpc/auth.requestPhoneLinkCode/', { ...ip(23), authorization: bearer }, json({ phone: '+15205550100' }));
  check('phone code request limiter covers its twin and variants', phoneTwin.status === 429, `got ${phoneTwin.status}`);

  /* --------------------------------------------- 3. random bearer tokens */

  const randomRun: number[] = [];
  for (let i = 0; i < 45; i++) {
    const r = await app.request('/api/trpc/auth.methods', { headers: { ...ip(30), authorization: `Bearer ${crypto.randomUUID()}` } });
    randomRun.push(r.status);
  }
  const blocked = randomRun.filter((s) => s === 429).length;
  check('random bearer tokens share the IP bucket (40/min here)', blocked === 5, `${blocked} of 45 refused`);
  const real = await app.request('/api/trpc/auth.methods', { headers: { ...ip(30), authorization: bearer } });
  check('a real session on that exhausted IP still gets its own bucket', real.status === 200, `got ${real.status}`);

  /* ------------------------------------------------------------ 4. webhook */

  const event = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, type: 'hardening.unknown', data: { object: {} } });
  const hook = (headers: Record<string, string> = {}) =>
    app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': FAKE_WEBHOOK_SIGNATURE, ...headers }, body: event });
  const testHook = () =>
    app.request('/api/stripe/simulated-test-event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

  process.env.NODE_ENV = 'production';
  const prodHook = await hook();
  const prodTestHook = await testHook();
  process.env.NODE_ENV = 'test';
  check('production + simulated: webhook answers 404', prodHook.status === 404, `got ${prodHook.status}`);
  check('production + simulated: test hook answers 404', prodTestHook.status === 404, `got ${prodTestHook.status}`);
  const devHook = await hook();
  check('outside production the webhook still verifies and answers', devHook.status !== 404 && devHook.status < 500, `got ${devHook.status}`);
  const badSig = await hook({ 'stripe-signature': 'nope' });
  check('outside production a wrong signature is still refused', badSig.status === 400, `got ${badSig.status}`);
  const devTestHook = await testHook();
  check('outside production the test hook is still there', devTestHook.status === 400, `got ${devTestHook.status} (400 = route asks for a type)`);

  /* ------------------------------------------------------ 5. body limits */

  const auth = { ...ip(40), authorization: bearer };
  const big = Buffer.alloc(10 * 1024 * 1024);
  const declared = await app.request('/api/uploads', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(big.length) },
    body: big,
  });
  const declaredBody = (await declared.json().catch(() => null)) as { error?: string } | null;
  check('an oversized upload gets 413 JSON', declared.status === 413 && !!declaredBody?.error, `got ${declared.status}`);

  const chunkedUpload = await app.request('/api/uploads', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'multipart/form-data; boundary=x' },
    body: streamOf(10 * 1024 * 1024),
    duplex: 'half',
  } as RequestInit);
  check('a chunked upload with no Content-Length is cut off with 413', chunkedUpload.status === 413, `got ${chunkedUpload.status}`);

  const chunkedPrivate = await app.request('/api/private-media', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'multipart/form-data; boundary=x' },
    body: streamOf(52 * 1024 * 1024),
    duplex: 'half',
  } as RequestInit);
  check('a chunked private-media body over 51 MB gets 413', chunkedPrivate.status === 413, `got ${chunkedPrivate.status}`);

  const chunkedTrpc = await app.request('/api/trpc/auth.methods', {
    method: 'POST',
    headers: { ...ip(41), 'content-type': 'application/json' },
    body: streamOf(2 * 1024 * 1024, 64 * 1024),
    duplex: 'half',
  } as RequestInit);
  check('a chunked tRPC body over 1 MB gets 413', chunkedTrpc.status === 413, `got ${chunkedTrpc.status}`);

  /* ----------------------------------------- 6–8. upload names and types */

  const upload = (name: string, bytes: Buffer, type: string, headers: Record<string, string> = auth) => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(bytes)], name, { type }));
    return app.request('/api/uploads', { method: 'POST', headers, body: form });
  };

  const seeded = png();
  await storage.put('demo-art.png', seeded, 'image/png', { keepName: true });
  const overwrite = await upload('demo-art.png', png(), 'image/png');
  const { url: overwriteUrl } = (await overwrite.json()) as { url?: string };
  check('a demo- named user upload gets a generated name', overwrite.status === 200 && !!overwriteUrl && !overwriteUrl.includes('demo-'), `${overwrite.status} ${overwriteUrl}`);
  const stillSeeded = await app.request('/api/uploads/demo-art.png', { headers: ip(42) });
  check('the seeded demo- file was not overwritten', Buffer.from(await stillSeeded.arrayBuffer()).equals(seeded));
  const unauthed = await upload('demo-art.png', png(), 'image/png', ip(42));
  check('uploading still needs a sign-in', unauthed.status === 401, `got ${unauthed.status}`);

  const fake = await upload('evil.png', Buffer.from('<html><script>alert(1)</script></html>'), 'image/png');
  check('HTML sent as image/png is refused', fake.status === 415, `got ${fake.status}`);
  const svg = await upload('art.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml');
  check('SVG from a user is still refused', svg.status === 415, `got ${svg.status}`);

  const served = overwriteUrl ? await app.request(overwriteUrl, { headers: ip(42) }) : null;
  check(
    'served uploads carry nosniff and the declared type',
    served?.status === 200 && served.headers.get('x-content-type-options') === 'nosniff' && served.headers.get('content-type') === 'image/png',
    `${served?.status} ${served?.headers.get('x-content-type-options')}`,
  );

  /* ------------------------------------------------------------ 9. health */

  const health = (await (await app.request('/api/health')).json()) as { storage?: Record<string, unknown> };
  check(
    'health reports storage mode and nothing else about it',
    health.storage?.mode === 'disk' && Object.keys(health.storage ?? {}).join() === 'mode',
    JSON.stringify(health.storage),
  );

  console.log(`\n${passes} passed, ${failures} failed`);
  await pglite?.close();
  for (const dir of [process.env.PGLITE_DIR!, process.env.UPLOADS_DIR!, process.env.PRIVATE_UPLOADS_DIR!]) {
    fs.rmSync(path.resolve(dir), { recursive: true, force: true });
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
