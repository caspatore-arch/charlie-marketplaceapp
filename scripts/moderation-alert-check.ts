/**
 * Moderators get an email when a report is filed (docs/HANDOFF.md §3: "No
 * email alerts to the moderator; they have to look.") — backend/email/moderationAlerts.ts,
 * wired into user.report and community.report.
 *
 *   npx tsx scripts/moderation-alert-check.ts
 *
 * Checked against a throwaway PGlite seeded with the demo data, same
 * createCaller + SimulatedEmailProvider pattern as scripts/any-email-check.ts
 * (no HTTP server needed). Modules load with `await import(...)` after the
 * env block.
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

const MAYA_ID = '00000000-0000-4000-8000-000000000001'; // the seeded moderator
const JORDAN_ID = '00000000-0000-4000-8000-000000000002';
const SAM_ID = '00000000-0000-4000-8000-000000000003';
const MAYA_TEXT_POST_ID = '00000000-0000-4000-8000-000000000302'; // P(2): Maya's plain-text post

process.env.MODERATOR_USER_IDS = MAYA_ID;

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const { seed } = await import('../backend/db/seed');
  await seed();
  const { eq } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const schema = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');

  const mail = new SimulatedEmailProvider();
  setEmailProviderForTests(mail);

  const userRow = async (id: string) => {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return row!;
  };
  const jordan = appRouter.createCaller({ db, user: await userRow(JORDAN_ID) });
  const sam = appRouter.createCaller({ db, user: await userRow(SAM_ID) });

  // --- 1. Reporting a user alerts the moderator by email.
  await jordan.user.report({ targetUserId: SAM_ID, reason: 'harassment', details: 'Showed up and was rude.' });
  const userAlert = mail.sent.find((m) => m.to === 'maya@demo.campus.test');
  check('reporting a user sends an email to the moderator', !!userAlert);
  check('the alert names the reason', !!userAlert && /harassment/i.test(userAlert.subject));
  check('the alert says what was reported and links the queue', !!userAlert && /a user/.test(userAlert.text) && userAlert.text.includes('/moderation'));

  // --- 2. Reporting a community post alerts the moderator too.
  const before = mail.sent.length;
  await jordan.community.report({ id: MAYA_TEXT_POST_ID, reason: 'prohibited_item' });
  const postAlert = mail.sent.slice(before).find((m) => m.to === 'maya@demo.campus.test');
  check('reporting a community post sends an email to the moderator', !!postAlert);
  check('the post alert calls out a community post', !!postAlert && /a community post/.test(postAlert.text));

  // --- 3. A moderator email failure never fails the report itself.
  mail.failNext = 1;
  const before2 = mail.sent.length;
  const result = await sam.user.report({ targetUserId: JORDAN_ID, reason: 'scam' });
  check('the report still succeeds when the alert email fails to send', result.ok === true);
  check('the failed send is not silently counted as sent', mail.sent.length === before2);

  // --- 4. No moderators configured: report still succeeds, nothing is sent (and nothing throws).
  process.env.MODERATOR_USER_IDS = '';
  const before3 = mail.sent.length;
  const result2 = await sam.user.report({ targetUserId: JORDAN_ID, reason: 'other', details: 'no moderators configured' });
  check('reporting still succeeds with no moderators configured', result2.ok === true);
  check('no email is sent when there are no moderators', mail.sent.length === before3);

  console.log(`\n${passes} passed, ${failures} failed`);
  await pglite?.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
