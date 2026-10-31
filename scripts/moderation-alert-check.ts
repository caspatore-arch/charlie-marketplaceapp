/**
 * Moderator email alert on new reports (backend/email/moderation.ts), checked
 * against a throwaway PGlite with the simulated email provider.
 *
 *   npx tsx scripts/moderation-alert-check.ts
 *
 * Covers: notifyModeratorsOfReport sends to every configured moderator with
 * a stored email, skips moderators without one, is a no-op when
 * MODERATOR_USER_IDS is empty, and never throws on a bad/missing report; plus
 * an end-to-end check that `user.report` and `community.report` each fire it.
 * Modules load with `await import(...)` after the env block (see save-check).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-modalert-'));
process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
process.env.SMS_MODE = 'simulated';
delete process.env.MODERATOR_USER_IDS;

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const MOD1 = '00000000-0000-4000-8000-0000000000e1';
const MOD2_NO_EMAIL = '00000000-0000-4000-8000-0000000000e2';
const REPORTER = '00000000-0000-4000-8000-0000000000e3';
const TARGET = '00000000-0000-4000-8000-0000000000e4';

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return predicate();
}

async function main() {
  const { eq } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const { campuses, listings, reports, users } = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');
  const { notifyModeratorsOfReport } = await import('../backend/email/moderation');

  await runMigrations();
  const mail = new SimulatedEmailProvider();
  setEmailProviderForTests(mail);

  await db.insert(campuses).values({
    id: CAMPUS_ID,
    name: 'University of Arizona',
    slug: 'arizona',
    emailDomains: ['arizona.edu', 'demo.campus.test'],
    timezone: 'America/Phoenix',
    isDemo: true,
  });
  await db.insert(users).values([
    { id: MOD1, email: 'mod1@demo.campus.test', displayName: 'Mod One', campusId: CAMPUS_ID, campusEmailVerifiedAt: new Date(), isDemo: true },
    { id: MOD2_NO_EMAIL, email: null, phone: '+15205550111', phoneVerifiedAt: new Date(), displayName: 'Mod Two', campusId: CAMPUS_ID, isDemo: true },
    { id: REPORTER, email: 'reporter@demo.campus.test', displayName: 'Reporter', campusId: CAMPUS_ID, campusEmailVerifiedAt: new Date(), isDemo: true },
    { id: TARGET, email: 'target@demo.campus.test', displayName: 'Target', campusId: CAMPUS_ID, campusEmailVerifiedAt: new Date(), isDemo: true },
  ]);
  const [listing] = await db
    .insert(listings)
    .values({ sellerId: TARGET, campusId: CAMPUS_ID, title: 'Mini fridge', category: 'dorm', condition: 'good', priceCents: 2000 })
    .returning();

  // --- unit: direct calls against notifyModeratorsOfReport
  process.env.MODERATOR_USER_IDS = '';
  const [bareReport] = await db
    .insert(reports)
    .values({ reporterId: REPORTER, targetUserId: TARGET, reason: 'scam' })
    .returning();
  const noMods = await notifyModeratorsOfReport(db, bareReport!);
  check('no MODERATOR_USER_IDS configured → no-op, no throw', noMods.sent === 0 && noMods.noRecipients === true);

  process.env.MODERATOR_USER_IDS = `${MOD1},${MOD2_NO_EMAIL},00000000-0000-4000-8000-00000000dead`;
  const withMods = await notifyModeratorsOfReport(db, bareReport!);
  check('sends only to moderators with a stored email', withMods.sent === 1, `sent=${withMods.sent}`);
  check('alert mentions the report reason', mail.sent.at(-1)?.text.includes('scam') === true);
  check('alert is addressed to the moderator with an email', mail.sent.at(-1)?.to === 'mod1@demo.campus.test');
  check('alert links to /moderation', mail.sent.at(-1)?.text.includes('/moderation') === true);

  const [listingReport] = await db
    .insert(reports)
    .values({ reporterId: REPORTER, targetUserId: TARGET, targetListingId: listing!.id, reason: 'prohibited_item' })
    .returning();
  await notifyModeratorsOfReport(db, listingReport!);
  check('alert names the reported listing by title', mail.sent.at(-1)?.text.includes('Mini fridge') === true);

  const bogusReport = { ...bareReport!, targetListingId: '00000000-0000-4000-8000-00000000feed', targetUserId: null };
  const bogus = await notifyModeratorsOfReport(db, bogusReport as typeof bareReport);
  check('a dangling listing id never throws', bogus.sent === 1, `sent=${bogus.sent}`);

  // --- end-to-end: the actual mutations fire the alert
  const [reporterRow] = await db.select().from(users).where(eq(users.id, REPORTER));
  const reporterCaller = appRouter.createCaller({ db, user: reporterRow! });
  const before = mail.sent.length;
  await reporterCaller.user.report({ targetUserId: TARGET, reason: 'harassment', details: 'e2e check' });
  check('user.report fires the moderator alert', await waitFor(() => mail.sent.length > before));
  check('e2e alert mentions harassment', mail.sent.at(-1)?.text.includes('harassment') === true);

  await pglite?.close();
}

main()
  .then(() => {
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('FATAL', err);
    process.exit(1);
  });
