/**
 * Any email can sign in; a campus email is recommended and is what verifies
 * the campus. Checked against a throwaway PGlite seeded with the demo data.
 *
 *   npx tsx scripts/any-email-check.ts
 *
 * Covers: a gmail address requests a code, signs in, lands on the default
 * campus with campusEmailVerifiedAt null, can browse/save, and is refused
 * listing.create with the campus-email FORBIDDEN error; it can then verify a
 * campus email and sell. An arizona.edu address signs in verified and can
 * create a listing. Code cooldown applies to non-campus emails too, and a
 * non-campus address can't be used to verify a campus.
 * Modules load with `await import(...)` after the env block (see save-check).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-anyemail-'));
process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
process.env.SMS_MODE = 'simulated';

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
async function rejects(label: string, fn: () => Promise<unknown>, code: string, msg?: RegExp) {
  try {
    await fn();
    check(label, false, 'did not throw');
  } catch (e) {
    const err = e as { code?: string; message?: string };
    check(label, err.code === code && (!msg || msg.test(err.message ?? '')), `got ${err.code}: ${err.message}`);
  }
}

async function main() {
  const { seed } = await import('../backend/db/seed');
  await seed();
  const { and, asc, desc, eq, isNull } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const schema = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { userFromAuthHeader } = await import('../backend/trpc/create-context');
  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');

  const mail = new SimulatedEmailProvider();
  setEmailProviderForTests(mail);

  const anon = appRouter.createCaller({ db, user: null });
  const callerFor = async (token: string) =>
    appRouter.createCaller({ db, user: await userFromAuthHeader(`Bearer ${token}`) });
  const latestCode = async (email: string) => {
    const [row] = await db
      .select()
      .from(schema.emailCodes)
      .where(and(eq(schema.emailCodes.email, email), isNull(schema.emailCodes.consumedAt)))
      .orderBy(desc(schema.emailCodes.expiresAt))
      .limit(1);
    return row?.code ?? '';
  };

  const [defaultCampus] = await db.select().from(schema.campuses).orderBy(asc(schema.campuses.name)).limit(1);
  const spots = await db
    .select()
    .from(schema.meetupSpots)
    .where(eq(schema.meetupSpots.campusId, defaultCampus!.id));
  const HOUR = 3_600_000;
  const slot = (ms: number) => new Date(Math.ceil((Date.now() + ms) / 900_000) * 900_000);
  const listingInput = () => ({
    title: `Any-email lamp ${Math.random().toString(36).slice(2, 7)}`,
    category: 'other' as const,
    condition: 'good' as const,
    priceCents: 2500,
    isSellToday: true,
    photoUrls: ['/api/uploads/demo-dorm.svg'],
    spotIds: [spots[0]!.id],
    windows: [{ startsAt: slot(HOUR), endsAt: slot(5 * HOUR) }],
  });

  // --- a gmail address
  const gmail = 'any.email.tester@gmail.com';
  const sent = await anon.auth.requestCode({ email: gmail });
  check('gmail can request a sign-in code', sent.ok === true && sent.simulated === true);
  check('the code email goes to the gmail address', mail.sent.some((m) => m.to === gmail));
  await rejects('the 30s cooldown applies to non-campus emails', () => anon.auth.requestCode({ email: gmail }), 'TOO_MANY_REQUESTS');

  const signedIn = await anon.auth.verifyCode({ email: gmail, code: await latestCode(gmail), displayName: 'Gee Mail' });
  check('gmail signs in and creates an account', !!signedIn.token && signedIn.isNewAccount === true);
  check('gmail account is NOT campus-verified', signedIn.user.campusEmailVerifiedAt == null);
  check('gmail account lands on the default campus', signedIn.user.campusId === defaultCampus!.id && signedIn.user.campus?.id === defaultCampus!.id);

  const g = await callerFor(signedIn.token);
  const me = await g.auth.me();
  check('auth.me agrees: signed in, no campus email verified', me.email === gmail && me.campusEmailVerifiedAt == null);
  const feed = await g.listing.feed({ campusId: defaultCampus!.id, limit: 5 });
  check('gmail account can browse the feed', feed.items.length > 0);
  await rejects(
    'gmail account is refused listing.create with the campus-email error',
    () => g.listing.create(listingInput()),
    'FORBIDDEN',
    /campus email/i,
  );

  // Signing in again keeps it unverified (a non-campus email never verifies).
  await db.update(schema.emailCodes).set({ expiresAt: new Date(Date.now() + 10 * 60_000 - 31_000) }).where(eq(schema.emailCodes.email, gmail));
  await anon.auth.requestCode({ email: gmail });
  const again = await anon.auth.verifyCode({ email: gmail, code: await latestCode(gmail) });
  check('signing in again with gmail is the same account, still unverified', again.isNewAccount === false && again.user.id === signedIn.user.id && again.user.campusEmailVerifiedAt == null);

  // A non-campus address can't verify a campus.
  await rejects('a gmail address cannot be used to verify a campus', () => g.auth.requestEmailLinkCode({ email: 'other@gmail.com' }), 'BAD_REQUEST');

  // The gated path: verify a campus email, then selling works.
  const campusAddr = 'any.email.tester@arizona.edu';
  await g.auth.requestEmailLinkCode({ email: campusAddr });
  const linked = await g.auth.confirmEmailLink({ email: campusAddr, code: await latestCode(campusAddr) });
  check('gmail account verifies a campus email in place', linked.switchedAccount === false && linked.user.campusEmailVerifiedAt != null);
  const gVerified = await callerFor(again.token);
  const sold = await gVerified.listing.create(listingInput());
  check('after verifying, the same account can create a listing', !!sold.id);

  // --- an arizona.edu address
  const az = 'wildcat.tester@arizona.edu';
  await anon.auth.requestCode({ email: az });
  const azIn = await anon.auth.verifyCode({ email: az, code: await latestCode(az), displayName: 'Wilbur' });
  check('arizona.edu signs in campus-verified', azIn.isNewAccount === true && azIn.user.campusEmailVerifiedAt != null);
  check('arizona.edu lands on its campus', azIn.user.campusId === defaultCampus!.id);
  const a = await callerFor(azIn.token);
  const listing = await a.listing.create(listingInput());
  check('arizona.edu account can create a listing', !!listing.id);

  // ALLOWED_EMAIL_DOMAINS (demo.campus.test) still verifies.
  const demo = 'demo.tester@demo.campus.test';
  await anon.auth.requestCode({ email: demo });
  const demoIn = await anon.auth.verifyCode({ email: demo, code: await latestCode(demo), displayName: 'Demo' });
  check('an allowed campus domain still signs in verified', demoIn.user.campusEmailVerifiedAt != null);

  console.log(`\n${passes} passed, ${failures} failed`);
  await pglite?.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
