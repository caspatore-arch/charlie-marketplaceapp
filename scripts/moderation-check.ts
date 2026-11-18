/**
 * Moderator report alerts, checked against a throwaway PGlite.
 *
 *   npm run test:moderation
 *
 * Covers: filing a report (on a user, a listing, or a community post) emails
 * every configured moderator plus MODERATION_ALERT_EMAIL if set, dedupes a
 * repeated address, never sends when nothing is configured, never fails the
 * report mutation when the email provider errors, and the existing
 * moderator-only access to the queue is unchanged.
 * Modules load with `await import(...)` after the env block (see archive-check).
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR ??= 'backend/data/moderation-check-pg';
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const MOD_A = '00000000-0000-4000-8000-0000000000d1';
const MOD_B = '00000000-0000-4000-8000-0000000000d2';
const REPORTER = '00000000-0000-4000-8000-0000000000d3';
const TARGET = '00000000-0000-4000-8000-0000000000d4';

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
async function rejects(label: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    check(label, false, 'did not throw');
  } catch (e) {
    const got = (e as { code?: string }).code;
    check(label, got === code, `got ${got}`);
  }
}

async function main() {
  const { eq } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const { campuses, listings, reports, users } = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');

  await runMigrations();

  await db.insert(campuses).values({
    id: CAMPUS_ID,
    name: 'University of Arizona',
    slug: 'arizona',
    emailDomains: ['arizona.edu', 'demo.campus.test'],
    timezone: 'America/Phoenix',
    isDemo: true,
  });
  const emailOf = (id: string) => `mod-${id.slice(-4)}@demo.campus.test`;
  for (const [id, name] of [
    [MOD_A, 'Mod A'],
    [MOD_B, 'Mod B'],
    [REPORTER, 'Reporter'],
    [TARGET, 'Target'],
  ] as const) {
    await db.insert(users).values({
      id,
      email: emailOf(id),
      displayName: name,
      campusId: CAMPUS_ID,
      campusEmailVerifiedAt: new Date(),
      isDemo: true,
    });
  }
  const [listing] = await db
    .insert(listings)
    .values({
      sellerId: TARGET,
      campusId: CAMPUS_ID,
      title: 'Reported mini fridge',
      category: 'dorm',
      condition: 'good',
      priceCents: 5000,
      status: 'active',
    })
    .returning();

  const as = async (id: string) => {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    return appRouter.createCaller({ db, user: u! });
  };
  const reporter = await as(REPORTER);
  const modA = await as(MOD_A);
  const modB = await as(MOD_B);
  const target = await as(TARGET);

  const provider = new SimulatedEmailProvider();
  setEmailProviderForTests(provider);
  const sentTo = (to: string) => provider.sent.filter((m) => m.to === to);

  /* --------------------------------------------------------- no moderator */

  delete process.env.MODERATOR_USER_IDS;
  delete process.env.MODERATION_ALERT_EMAIL;
  provider.sent.length = 0;

  const unalerted = await reporter.user.report({
    targetUserId: TARGET,
    reason: 'harassment',
    details: 'no moderator configured yet',
  });
  check('report is still saved with no moderator configured', unalerted.ok === true);
  // Fire-and-forget: give the microtask queue a turn before asserting nothing was sent.
  await new Promise((r) => setTimeout(r, 10));
  check('no email is sent when nothing is configured', provider.sent.length === 0);
  const savedCount = await db.select().from(reports).where(eq(reports.reporterId, REPORTER));
  check('the report row exists regardless of alerting', savedCount.length === 1);

  /* ------------------------------------------------------- single moderator, user target */

  process.env.MODERATOR_USER_IDS = MOD_A;
  provider.sent.length = 0;

  await reporter.user.report({ targetUserId: TARGET, reason: 'scam' });
  await new Promise((r) => setTimeout(r, 10));
  const toModA = sentTo(emailOf(MOD_A));
  check('the configured moderator is alerted exactly once', toModA.length === 1, `got ${toModA.length}`);
  check('the alert names the report reason', toModA[0]?.text.includes('scam') ?? false);
  check('a user-only report is described as "a user"', toModA[0]?.text.includes('a user') ?? false);
  check('nobody else is alerted', provider.sent.length === 1);

  /* ------------------------------------------------------------ listing target */

  provider.sent.length = 0;
  await reporter.user.report({ targetListingId: listing!.id, targetUserId: TARGET, reason: 'prohibited_item' });
  await new Promise((r) => setTimeout(r, 10));
  check(
    'a listing report is described as "a listing", not "a user"',
    (sentTo(emailOf(MOD_A))[0]?.text.includes('a listing') ?? false) &&
      !(sentTo(emailOf(MOD_A))[0]?.text.includes('a user') ?? true),
  );

  /* -------------------------------------------------------- community post target */

  const post = await target.community.create({ kind: 'selling', body: 'Selling a desk lamp' });
  provider.sent.length = 0;
  await reporter.community.report({ id: post.id, reason: 'other', details: 'spam' });
  await new Promise((r) => setTimeout(r, 10));
  check(
    'a text-only community post report is described as "a community post"',
    sentTo(emailOf(MOD_A))[0]?.text.includes('a community post') ?? false,
  );

  /* -------------------------------------------------------------- two moderators */

  process.env.MODERATOR_USER_IDS = `${MOD_A},${MOD_B}`;
  provider.sent.length = 0;
  await reporter.user.report({ targetUserId: TARGET, reason: 'no_show' });
  await new Promise((r) => setTimeout(r, 10));
  check('every configured moderator is alerted', sentTo(emailOf(MOD_A)).length === 1 && sentTo(emailOf(MOD_B)).length === 1);
  check('exactly two alerts go out, no extras', provider.sent.length === 2);

  /* ---------------------------------------------------- extra alert address, deduped */

  process.env.MODERATOR_USER_IDS = MOD_A;
  process.env.MODERATION_ALERT_EMAIL = emailOf(MOD_A); // duplicate of the moderator's own address
  provider.sent.length = 0;
  await reporter.user.report({ targetUserId: TARGET, reason: 'other' });
  await new Promise((r) => setTimeout(r, 10));
  check('a duplicate alert address does not double-send', provider.sent.length === 1);

  process.env.MODERATION_ALERT_EMAIL = 'team@example.test';
  provider.sent.length = 0;
  await reporter.user.report({ targetUserId: TARGET, reason: 'other' });
  await new Promise((r) => setTimeout(r, 10));
  check(
    'a distinct MODERATION_ALERT_EMAIL is alerted alongside the moderator',
    sentTo(emailOf(MOD_A)).length === 1 && sentTo('team@example.test').length === 1,
  );

  /* ---------------------------------------------------- email provider failure */

  process.env.MODERATOR_USER_IDS = MOD_A;
  delete process.env.MODERATION_ALERT_EMAIL;
  provider.sent.length = 0;
  provider.failNext = 1;
  const underFailure = await reporter.user.report({ targetUserId: TARGET, reason: 'scam' });
  await new Promise((r) => setTimeout(r, 10));
  check('the report mutation still succeeds when the email provider throws', underFailure.ok === true);

  /* -------------------------------------------------------- queue access unchanged */

  await rejects('a non-moderator still cannot read the report queue', () => target.moderation.reports({}), 'FORBIDDEN');
  const openReports = await modA.moderation.reports({ status: 'open' });
  check('the configured moderator can still read the report queue', openReports.length > 0);
  const isModA = await modA.moderation.isModerator();
  const isModB = await modB.moderation.isModerator();
  check('isModerator still reflects MODERATOR_USER_IDS', isModA === true && isModB === false);

  await pglite?.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
