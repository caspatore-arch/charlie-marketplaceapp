/**
 * Security checks for sign-in codes, the dev sign-in switch, handoff codes
 * and listing photo URLs.
 *
 *   npm run test:auth-security
 *
 * In-process: tRPC callers against a throwaway PGlite directory with the
 * simulated email and SMS providers, so nothing touches dev data and nothing
 * is sent. The per-IP daily cap is filled by a CHILD process that then exits,
 * and the parent (a fresh process on the same database) checks the cap still
 * holds: that is the simulated restart.
 *
 * Env is set FIRST; backend modules are only ever loaded with `await import()`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isChild = process.env.AUTH_SEC_PHASE === 'fill';
const tempRoot = isChild ? process.env.AUTH_SEC_ROOT! : fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-authsec-'));
process.env.AUTH_SEC_ROOT = tempRoot;
process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.DATABASE_URL = '';
process.env.DEV_LOGIN = '1';
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
process.env.SMS_MODE = 'simulated';
process.env.SMS_DISPATCH_INTERVAL_MS = '0';
process.env.EMAIL_CODES_PER_IP_PER_DAY = '3';
process.env.EMAIL_CODES_GLOBAL_PER_DAY = '0';
delete process.env.S3_PUBLIC_BASE_URL;
delete process.env.S3_BUCKET;

const FILL_IP = '203.0.113.50';
const MAYA = '00000000-0000-4000-8000-000000000001';
const JORDAN = '00000000-0000-4000-8000-000000000002';
const CAMPUS = '00000000-0000-4000-8000-0000000000aa';
const SLOT = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let n = 0;
let failures = 0;
async function check(name: string, body: () => Promise<void>) {
  n += 1;
  try {
    await body();
    console.log(`PASS ${n}. ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${n}. ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg} (got ${String(actual)}, want ${String(expected)})`);
}
async function expectCode(code: string, fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const c = (err as { code?: string }).code;
    if (c !== code) throw new Error(`expected ${code}, got ${c}: ${(err as Error).message}`);
    return (err as Error).message;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

/** Child: fill the per-IP cap, then exit (the "restart"). */
async function fill(): Promise<number> {
  const { runMigrations } = await import('../backend/db/migrate');
  await runMigrations();
  const { db, pglite } = await import('../backend/db/client');
  const { appRouter } = await import('../backend/trpc/app-router');
  const fromIp = appRouter.createCaller({ db, user: null, ip: FILL_IP } as never);
  for (let i = 0; i < 3; i++) await fromIp.auth.requestCode({ email: `fill${i}@example.com` });
  await pglite?.close();
  return 0;
}

async function main(): Promise<number> {
  // Phase 1 in a separate process that exits before this one opens the DB.
  const tsx = path.resolve('node_modules/.bin/tsx');
  const child = spawnSync(tsx, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, AUTH_SEC_PHASE: 'fill' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    console.error('child fill process failed:', child.stderr || child.stdout);
    return 1;
  }

  const { seed } = await import('../backend/db/seed');
  await seed();
  const { db } = await import('../backend/db/client');
  const schema = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { env, validateDevLoginEnv } = await import('../backend/env');
  const { hashEmailCode } = await import('../backend/trpc/routes/auth');
  const { isOwnUploadUrl } = await import('../backend/trpc/routes/listing');
  const { simulateHookAllowed } = await import('../backend/stripe/webhook');
  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');
  const { SimulatedSmsProvider, setSmsProviderForTests } = await import('../backend/sms/provider');
  const d = await import('drizzle-orm');

  const mail = new SimulatedEmailProvider();
  setEmailProviderForTests(mail);
  const sms = new SimulatedSmsProvider();
  setSmsProviderForTests(sms);

  const userRow = async (id: string) => (await db.select().from(schema.users).where(d.eq(schema.users.id, id)))[0]!;
  const as = async (id: string) => appRouter.createCaller({ db, user: await userRow(id) });
  const anon = appRouter.createCaller({ db, user: null });
  const anonFrom = (ip: string) => appRouter.createCaller({ db, user: null, ip } as never);

  const mailedCode = (to: string) => {
    const m = [...mail.sent].reverse().find((x) => x.to === to);
    return /(\d{6})/.exec(m?.subject ?? '')?.[1] ?? '';
  };
  const wrong = (good: string) => (good === '000000' ? '111111' : '000000');
  /** Skip the 30s resend cooldown by ageing this address's codes. */
  const ageCodes = (email: string) =>
    db
      .update(schema.emailCodes)
      .set({ expiresAt: d.sql`${schema.emailCodes.expiresAt} - interval '31 seconds'` })
      .where(d.eq(schema.emailCodes.email, email));
  let phoneSeq = 0;
  /** A brand-new, empty phone-only account. */
  const newPhoneAccount = async () => {
    const phone = `+1520555${String(3000 + ++phoneSeq).padStart(4, '0')}`;
    await anon.auth.requestPhoneCode({ phone });
    const m = [...sms.sent].reverse().find((x) => x.to === phone && x.sensitive);
    const code = /(\d{6})/.exec(m?.body ?? '')![1]!;
    const out = await anon.auth.verifyPhoneCode({ phone, code, displayName: 'Fresh', campusId: CAMPUS });
    assert(out.status === 'signed_in', 'phone account created');
    return { id: out.user.id, caller: await as(out.user.id) };
  };

  /* ===================================================== email codes */

  await check('6th email-code try fails even with the right code; a fresh code then works', async () => {
    const email = 'guess1@demo.campus.test';
    await anon.auth.requestCode({ email });
    const good = mailedCode(email);
    for (let i = 1; i <= 4; i++) {
      const msg = await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: wrong(good) }));
      assert(msg.includes(`${5 - i} tr`), `try ${i} says how many are left: ${msg}`);
    }
    const fifth = await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: wrong(good) }));
    assert(/Too many wrong tries/.test(fifth), fifth);
    await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: good }));
    const live = await db
      .select()
      .from(schema.emailCodes)
      .where(d.and(d.eq(schema.emailCodes.email, email), d.isNull(schema.emailCodes.consumedAt)));
    eq(live.length, 0, 'every live code for the address is burned');
    await ageCodes(email);
    await anon.auth.requestCode({ email });
    const fresh = mailedCode(email);
    const done = await anon.auth.verifyCode({ email, code: fresh, displayName: 'Guess' });
    assert(done.token, 'fresh code signs in');
    await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: fresh }));
  });

  await check('wrong guesses count per address: a new code does not reset the count', async () => {
    const email = 'guess2@demo.campus.test';
    await anon.auth.requestCode({ email });
    const first = mailedCode(email);
    for (let i = 0; i < 3; i++) await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: wrong(first) }));
    await ageCodes(email);
    await anon.auth.requestCode({ email });
    const second = mailedCode(email);
    await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: wrong(second) }));
    const fifth = await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: wrong(second) }));
    assert(/Too many wrong tries/.test(fifth), `5th wrong guess across two codes locks: ${fifth}`);
    await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email, code: second }));
  });

  await check('email codes are stored only as hashes, with their purpose', async () => {
    const email = 'hashed@demo.campus.test';
    await anon.auth.requestCode({ email });
    const code = mailedCode(email);
    const [row] = await db.select().from(schema.emailCodes).where(d.eq(schema.emailCodes.email, email));
    assert(row, 'row written');
    eq(row.code, null, 'plaintext column is empty');
    assert(row.codeHash !== code && !row.codeHash.includes(code), 'hash is not the code');
    eq(row.codeHash, hashEmailCode(email, 'sign_in', code), 'hash of email + purpose + code');
    eq(row.purpose, 'sign_in', 'purpose recorded');
  });

  await check('a sign-in code is refused for campus confirmation, and the reverse', async () => {
    const { caller } = await newPhoneAccount();
    const a = 'purpose-a@demo.campus.test';
    await anon.auth.requestCode({ email: a });
    await expectCode('BAD_REQUEST', () => caller.auth.confirmEmailLink({ email: a, code: mailedCode(a) }));

    const b = 'purpose-b@demo.campus.test';
    await caller.auth.requestEmailLinkCode({ email: b });
    const linkCode = mailedCode(b);
    await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email: b, code: linkCode }));
    const ok = await caller.auth.confirmEmailLink({ email: b, code: linkCode });
    eq(ok.user.email, b, 'the code still works for its own purpose');
    assert(ok.user.campusEmailVerifiedAt, 'campus verified');
  });

  await check('a new empty account cannot take over an existing account by guessing on confirmEmailLink', async () => {
    const victim = 'maya@demo.campus.test';
    const attacker = await newPhoneAccount();
    await attacker.caller.auth.requestEmailLinkCode({ email: victim });
    const real = mailedCode(victim); // only the victim's inbox has this
    for (let i = 0; i < 5; i++) {
      await expectCode('BAD_REQUEST', () => attacker.caller.auth.confirmEmailLink({ email: victim, code: wrong(real) }));
    }
    await expectCode('BAD_REQUEST', () => attacker.caller.auth.confirmEmailLink({ email: victim, code: real }));
    // A code issued to someone else (or for sign-in) can't be redeemed either.
    await ageCodes(victim);
    const other = await newPhoneAccount();
    await other.caller.auth.requestEmailLinkCode({ email: victim });
    await expectCode('BAD_REQUEST', () =>
      attacker.caller.auth.confirmEmailLink({ email: victim, code: mailedCode(victim) }),
    );
    await ageCodes(victim);
    await anon.auth.requestCode({ email: victim });
    await expectCode('BAD_REQUEST', () =>
      attacker.caller.auth.confirmEmailLink({ email: victim, code: mailedCode(victim) }),
    );
    const maya = await userRow(MAYA);
    eq(maya.deletedAt, null, 'victim account untouched');
    eq(maya.email, victim, 'victim keeps the email');
    const attackerRow = await userRow(attacker.id);
    eq(attackerRow.deletedAt, null, 'attacker account was not folded in');
    const victimSessions = await db.select().from(schema.sessions).where(d.eq(schema.sessions.userId, MAYA));
    eq(victimSessions.length, 0, 'no session issued for the victim');
  });

  await check('verify messages do not reveal whether an address has an account', async () => {
    const existing = 'jordan@demo.campus.test';
    const fresh = 'nobody-here@demo.campus.test';
    await anon.auth.requestCode({ email: existing });
    await anon.auth.requestCode({ email: fresh });
    const m1 = await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email: existing, code: wrong(mailedCode(existing)) }));
    const m2 = await expectCode('BAD_REQUEST', () => anon.auth.verifyCode({ email: fresh, code: wrong(mailedCode(fresh)) }));
    eq(m1, m2, 'same message');
  });

  /* ================================================== daily send caps */

  await check('per-IP daily cap fires and survives a restart (state is in the DB)', async () => {
    const counts = await db.select().from(schema.authSendCounts);
    const ipRow = counts.find((r) => r.bucket.startsWith('ip:'));
    assert(ipRow && ipRow.count === 3, `child process stored the count (rows: ${JSON.stringify(counts)})`);
    assert(!counts.some((r) => r.bucket.includes(FILL_IP)), 'IP is stored hashed, not raw');
    const msg = await expectCode('TOO_MANY_REQUESTS', () => anonFrom(FILL_IP).auth.requestCode({ email: 'fill-next@example.com' }));
    assert(/network today/.test(msg), msg);
    await anonFrom('198.51.100.9').auth.requestCode({ email: 'other-network@example.com' });
  });

  await check('optional global daily cap (off by default) refuses once set', async () => {
    eq(env.emailCodesGlobalPerDay, 0, 'off by default');
    process.env.EMAIL_CODES_GLOBAL_PER_DAY = '1';
    try {
      await anon.auth.requestCode({ email: 'global1@example.com' });
      await expectCode('TOO_MANY_REQUESTS', () => anon.auth.requestCode({ email: 'global2@example.com' }));
    } finally {
      process.env.EMAIL_CODES_GLOBAL_PER_DAY = '0';
    }
    await anon.auth.requestCode({ email: 'global3@example.com' });
  });

  /* ======================================================= dev login */

  await check('DEV_LOGIN with NODE_ENV=production refuses to start; dev sign-in and the payment hook stay shut', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DEV_LOGIN = '1';
      let threw = '';
      try {
        validateDevLoginEnv();
      } catch (err) {
        threw = (err as Error).message;
      }
      assert(/DEV_LOGIN=1 is set while NODE_ENV=production/.test(threw), `startup check throws: ${threw || 'nothing'}`);
      eq(env.devLogin, false, 'env.devLogin is false in production');
      eq(simulateHookAllowed(), false, 'simulated payment hook closed in production');
      await expectCode('FORBIDDEN', () => anon.auth.devSignIn({ userId: MAYA }));
      process.env.DEV_LOGIN = '0';
      validateDevLoginEnv(); // production without DEV_LOGIN is fine
    } finally {
      process.env.NODE_ENV = saved;
      process.env.DEV_LOGIN = '1';
    }
    validateDevLoginEnv();
    const dev = await anon.auth.devSignIn({ userId: MAYA });
    assert(dev.token, 'still works in development');
    await db.delete(schema.sessions).where(d.eq(schema.sessions.userId, MAYA));
  });

  /* ==================================================== handoff code */

  const spots = await db.select().from(schema.meetupSpots).where(d.eq(schema.meetupSpots.campusId, CAMPUS));
  const nextSlot = (fromMs = Date.now()) => Math.ceil(fromMs / SLOT) * SLOT;
  async function makeListing() {
    const maya = await as(MAYA);
    return maya.listing.create({
      title: `Handoff item ${Math.random().toString(36).slice(2, 7)}`,
      category: 'other',
      condition: 'good',
      priceCents: 2000,
      isSellToday: true,
      photoUrls: ['/api/uploads/demo-dorm.svg'],
      spotIds: [spots[0]!.id],
      windows: [{ startsAt: new Date(nextSlot(Date.now() + HOUR)), endsAt: new Date(nextSlot(Date.now() + 5 * HOUR)) }],
    });
  }
  async function bookOne() {
    const listing = await makeListing();
    const jordan = await as(JORDAN);
    const slot = (await jordan.reservation.slots({ listingId: listing.id })).slots.find((s) => s.available)!;
    return jordan.reservation.book({ listingId: listing.id, spotId: spots[0]!.id, startsAt: slot.startsAt });
  }

  await check('seller-facing reservation responses never contain the handoff code', async () => {
    const booked = await bookOne();
    const jordan = await as(JORDAN);
    const maya = await as(MAYA);
    const code = (await jordan.reservation.byId({ id: booked.id })).handoffCode;
    assert(code && /^\d{4}$/.test(code), 'buyer sees the code');
    eq((await maya.reservation.byId({ id: booked.id })).handoffCode, null, 'seller byId');
    const mine = (await maya.reservation.mine({ role: 'seller' })).find((r) => r.id === booked.id);
    eq(mine?.handoffCode, null, 'seller mine');
    const forListing = (await maya.reservation.forListing({ listingId: booked.listingId })).find((r) => r.id === booked.id);
    assert(forListing, 'listed');
    eq(forListing.handoffCode, null, 'seller forListing');
    assert(!JSON.stringify(await maya.reservation.forListing({ listingId: booked.listingId })).includes(`"${code}"`), 'code nowhere in forListing');

    // Buyer requests, seller accepts: accept returns a raw row to the seller.
    const listing = await makeListing();
    const slot = (await jordan.reservation.slots({ listingId: listing.id })).slots.find((s) => s.available)!;
    const req = await jordan.reservation.request({ listingId: listing.id, spotId: spots[0]!.id, startsAt: slot.startsAt });
    const accepted = await maya.reservation.accept({ id: req.id });
    eq(accepted.status, 'accepted', 'accepted');
    eq(accepted.handoffCode, null, 'seller accept response has no code');
    assert((await jordan.reservation.byId({ id: req.id })).handoffCode, 'buyer still gets it');
    const cancelled = await maya.reservation.cancel({ id: req.id });
    eq(cancelled.handoffCode, null, 'cancel response has no code');
  });

  await check('handoff code guesses lock after 5 wrong tries; the right code works before that', async () => {
    const jordan = await as(JORDAN);
    const maya = await as(MAYA);
    const a = await bookOne();
    const codeA = (await jordan.reservation.byId({ id: a.id })).handoffCode!;
    const bad = codeA === '0000' ? '1111' : '0000';
    for (let i = 1; i <= 4; i++) {
      const msg = await expectCode('BAD_REQUEST', () => maya.reservation.confirmHandoff({ id: a.id, code: bad }));
      assert(msg.includes(`${5 - i} tr`), msg);
    }
    const fifth = await expectCode('TOO_MANY_REQUESTS', () => maya.reservation.confirmHandoff({ id: a.id, code: bad }));
    assert(/locked/.test(fifth), fifth);
    await expectCode('TOO_MANY_REQUESTS', () => maya.reservation.confirmHandoff({ id: a.id, code: codeA }));
    const [rowA] = await db.select().from(schema.reservations).where(d.eq(schema.reservations.id, a.id));
    eq(rowA!.sellerConfirmedAt, null, 'seller not confirmed');
    eq(rowA!.handoffAttempts, 5, 'attempts stored on the reservation');

    const b = await bookOne();
    const codeB = (await jordan.reservation.byId({ id: b.id })).handoffCode!;
    await expectCode('BAD_REQUEST', () => maya.reservation.confirmHandoff({ id: b.id, code: codeB === '0000' ? '1111' : '0000' }));
    await jordan.reservation.confirmHandoff({ id: b.id });
    const done = await maya.reservation.confirmHandoff({ id: b.id, code: codeB });
    eq(done.status, 'completed', 'right code completes the handoff');
  });

  /* ==================================================== listing photos */

  await check('listing photos must be this server’s uploads', async () => {
    const maya = await as(MAYA);
    const base = {
      title: 'Photo rule',
      category: 'other' as const,
      condition: 'good' as const,
      priceCents: 1500,
      isSellToday: true,
      spotIds: [spots[0]!.id],
      windows: [{ startsAt: new Date(nextSlot(Date.now() + HOUR)), endsAt: new Date(nextSlot(Date.now() + 3 * HOUR)) }],
    };
    for (const bad of [
      'https://tracker.example.com/pixel.gif',
      'http://localhost:3000/api/uploads/a.jpg',
      '/api/uploads/../secrets.txt',
      '/api/uploads/a.jpg?x=https://evil.example',
      '/uploads/demo.jpg',
      '//evil.example/api/uploads/a.jpg',
    ]) {
      await expectCode('BAD_REQUEST', () => maya.listing.create({ ...base, photoUrls: [bad] }));
    }
    const ok = await maya.listing.create({ ...base, photoUrls: ['/api/uploads/demo-dorm.svg', '/api/uploads/3f9c.jpg'] });
    assert(ok.id, 'uploaded paths accepted');
    await expectCode('BAD_REQUEST', () => maya.listing.update({ id: ok.id, photoUrls: ['https://evil.example/x.png'] } as never));

    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com/media';
    try {
      eq(isOwnUploadUrl('https://cdn.example.com/media/abc-123.jpg'), true, 'configured storage base accepted');
      eq(isOwnUploadUrl('https://cdn.example.com/mediaevil/abc.jpg'), false, 'prefix trick refused');
      eq(isOwnUploadUrl('https://cdn.example.com.evil.net/media/abc.jpg'), false, 'host trick refused');
    } finally {
      delete process.env.S3_PUBLIC_BASE_URL;
    }
    eq(isOwnUploadUrl('https://cdn.example.com/media/abc-123.jpg'), false, 'refused without the base');
  });

  console.log(`\n${n - failures}/${n} passed`);
  return failures === 0 ? 0 : 1;
}

(isChild ? fill() : main())
  .then((code) => {
    if (!isChild) fs.rmSync(tempRoot, { recursive: true, force: true });
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
