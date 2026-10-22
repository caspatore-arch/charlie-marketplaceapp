/**
 * `listing.toggleSave` semantics, checked against a throwaway PGlite so it
 * never fights a running backend for the single-writer lock.
 *
 *   npx tsx scripts/save-check.ts
 *
 * Without `saved` the call flips (the heart button). With `saved` it sets —
 * the swipe deck relies on that, because a right-swipe on an item that was
 * already saved must not quietly unsave it.
 *
 * Modules are loaded with `await import(...)` after the env block, for the
 * same reason as scripts/payments-check.ts: the db client reads PGLITE_DIR
 * when it is first imported.
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR ??= 'backend/data/save-check-pg';
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SELLER_ID = '00000000-0000-4000-8000-0000000000c1';
const SAVER_ID = '00000000-0000-4000-8000-0000000000c2';

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const { eq } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const { campuses, listings, users } = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');

  await runMigrations();
  await db.insert(campuses).values({
    id: CAMPUS_ID,
    name: 'University of Arizona',
    slug: 'arizona',
    emailDomains: ['arizona.edu', 'demo.campus.test'],
    timezone: 'America/Phoenix',
    isDemo: true,
  });
  for (const [id, name] of [
    [SELLER_ID, 'Seller'],
    [SAVER_ID, 'Saver'],
  ] as const) {
    await db.insert(users).values({
      id,
      email: `save-${name.toLowerCase()}@demo.campus.test`,
      displayName: `${name} Test`,
      campusId: CAMPUS_ID,
      isDemo: true,
    });
  }
  const [listing] = await db
    .insert(listings)
    .values({
      sellerId: SELLER_ID,
      campusId: CAMPUS_ID,
      title: 'Desk lamp',
      category: 'dorm',
      condition: 'good',
      priceCents: 1200,
    })
    .returning();
  const [saver] = await db.select().from(users).where(eq(users.id, SAVER_ID));
  const api = appRouter.createCaller({ db, user: saver! });
  const savedIds = async () => (await api.listing.saved()).map((l) => l.id);
  const id = listing!.id;

  check('set saved:true saves', (await api.listing.toggleSave({ id, saved: true })).saved === true);
  check('set saved:true again stays saved', (await api.listing.toggleSave({ id, saved: true })).saved === true);
  check('saved list has it exactly once', JSON.stringify(await savedIds()) === JSON.stringify([id]));
  check('flip (no saved) unsaves', (await api.listing.toggleSave({ id })).saved === false);
  check('set saved:false on unsaved stays unsaved', (await api.listing.toggleSave({ id, saved: false })).saved === false);
  check('flip (no saved) saves', (await api.listing.toggleSave({ id })).saved === true);
  await api.listing.toggleSave({ id, saved: true });
  const [row] = await api.listing.saved();
  check('saved rows carry status and expiresAt', row?.status === 'active' && row !== undefined && 'expiresAt' in row);
  check('set saved:false unsaves', (await api.listing.toggleSave({ id, saved: false })).saved === false);
  check('saved list is empty', (await savedIds()).length === 0);

  await pglite?.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
