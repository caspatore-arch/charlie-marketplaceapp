/**
 * Closed-account cleanup (backend/retention.ts), checked against a throwaway PGlite.
 *
 *   npm run test:retention
 *
 * Accounts are closed through the real user.deleteAccount, then aged. After 30
 * days the closed person's messages, offers, meetup/sale records, listings and
 * Community posts go; payment-linked records, the other person's own listing,
 * and accounts closed less than 30 days ago stay. A second run deletes nothing.
 * Modules load with `await import(...)` after the env block (see save-check).
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR ??= 'backend/data/retention-check-pg';
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}

const CAMPUS = '00000000-0000-4000-8000-0000000000aa';
const SPOT = '00000000-0000-4000-8000-0000000000b1';
const OLD = '00000000-0000-4000-8000-0000000000d1';
const RECENT = '00000000-0000-4000-8000-0000000000d2';
const BUYER = '00000000-0000-4000-8000-0000000000d3';

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
  const s = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { purgeClosedAccounts } = await import('../backend/retention');

  await runMigrations();
  await db.insert(s.campuses).values({
    id: CAMPUS, name: 'University of Arizona', slug: 'arizona',
    emailDomains: ['demo.campus.test'], timezone: 'America/Phoenix', isDemo: true,
  });
  await db.insert(s.meetupSpots).values({ id: SPOT, campusId: CAMPUS, name: 'Union', description: 'Union', lat: 32.2, lng: -110.9, isDemo: true });
  for (const [id, name] of [[OLD, 'Old'], [RECENT, 'Recent'], [BUYER, 'Buyer']] as const) {
    await db.insert(s.users).values({
      id, email: `ret-${name.toLowerCase()}@demo.campus.test`, displayName: `${name} Test`,
      campusId: CAMPUS, campusEmailVerifiedAt: new Date(), isDemo: true,
    });
  }

  const DAY = 24 * 3_600_000;
  const listing = async (sellerId: string, title: string, status: 'active' | 'sold' = 'active') => {
    const [row] = await db.insert(s.listings).values({
      sellerId, campusId: CAMPUS, title, category: 'clothing', condition: 'good', priceCents: 2000, status,
    }).returning();
    return row!.id;
  };
  const thread = async (listingId: string, buyerId: string, sellerId: string, lines: [string, string][]) => {
    const [c] = await db.insert(s.conversations).values({ listingId, buyerId, sellerId }).returning();
    for (const [senderId, body] of lines) await db.insert(s.messages).values({ conversationId: c!.id, senderId, body });
    return c!.id;
  };
  const booking = async (listingId: string, buyerId: string, sellerId: string, status: 'completed' | 'cancelled') => {
    const [r] = await db.insert(s.reservations).values({
      listingId, buyerId, sellerId, status, spotId: SPOT, startsAt: new Date(Date.now() - 2 * DAY),
      proposedById: buyerId, priceCents: 2000,
    }).returning();
    return r!.id;
  };

  // OLD sold a jacket to BUYER: photo, thread, accepted offer tied to a completed booking.
  const jacket = await listing(OLD, 'Jacket', 'sold');
  await db.insert(s.listingPhotos).values({ listingId: jacket, url: '/api/uploads/jacket.png' });
  await thread(jacket, BUYER, OLD, [[BUYER, 'still have it?'], [OLD, 'yes']]);
  const jacketBooking = await booking(jacket, BUYER, OLD, 'completed');
  const [offer] = await db.insert(s.offers).values({
    listingId: jacket, buyerId: BUYER, sellerId: OLD, amountCents: 1800, askingPriceCents: 2000,
    status: 'declined', expiresAt: new Date(), reservationId: jacketBooking,
  }).returning();

  // OLD tried to buy BUYER's lamp.
  const lamp = await listing(BUYER, 'Lamp');
  const lampThread = await thread(lamp, OLD, BUYER, [[OLD, 'can I get the lamp?'], [BUYER, 'sure, Friday?']]);
  const lampBooking = await booking(lamp, OLD, BUYER, 'cancelled');

  // OLD sold boots with a payment record: must survive.
  const boots = await listing(OLD, 'Boots', 'sold');
  const bootsBooking = await booking(boots, BUYER, OLD, 'completed');
  await db.insert(s.payments).values({
    reservationId: bootsBooking, buyerId: BUYER, sellerId: OLD, amountCents: 2000, feeCents: 0,
    stripePaymentIntentId: 'pi_retention_check', status: 'paid', mode: 'simulated',
  });

  await db.insert(s.communityPosts).values({ campusId: CAMPUS, authorId: OLD, kind: 'selling', body: 'selling stuff' });

  // A reported listing and post: reports cascade on delete, so both must stay.
  const sketchy = await listing(OLD, 'Sketchy');
  const [reportedPost] = await db.insert(s.communityPosts).values({ campusId: CAMPUS, authorId: OLD, kind: 'buying', body: 'dm me' }).returning();
  await db.insert(s.reports).values([
    { reporterId: BUYER, targetListingId: sketchy, reason: 'scam' },
    { reporterId: BUYER, targetPostId: reportedPost!.id, reason: 'scam' },
  ]);

  // RECENT closed 10 days ago: nothing of theirs goes yet.
  const desk = await listing(RECENT, 'Desk');
  await thread(lamp, RECENT, BUYER, [[RECENT, 'is the lamp gone?']]);

  // Close both accounts the real way, then age the closures.
  for (const id of [OLD, RECENT]) {
    const [u] = await db.select().from(s.users).where(eq(s.users.id, id));
    await appRouter.createCaller({ db, user: u! }).user.deleteAccount({ confirmText: 'DELETE' });
  }
  await db.update(s.users).set({ deletedAt: new Date(Date.now() - 31 * DAY) }).where(eq(s.users.id, OLD));
  await db.update(s.users).set({ deletedAt: new Date(Date.now() - 10 * DAY) }).where(eq(s.users.id, RECENT));

  const result = await purgeClosedAccounts(db);
  check('one account is past 30 days', result.accounts === 1, `got ${result.accounts}`);

  const msgsBy = async (id: string) => (await db.select().from(s.messages).where(eq(s.messages.senderId, id))).length;
  const exists = async (table: typeof s.listings | typeof s.reservations, id: string) =>
    (await db.select({ id: table.id }).from(table).where(eq(table.id, id))).length === 1;

  check("old account's messages are deleted", (await msgsBy(OLD)) === 0);
  const lampMsgs = await db.select().from(s.messages).where(eq(s.messages.conversationId, lampThread));
  check("the other person's own messages stay", lampMsgs.length === 1 && lampMsgs[0]!.senderId === BUYER);
  check('sold listing is deleted', !(await exists(s.listings, jacket)));
  check('its photo row is deleted', (await db.select().from(s.listingPhotos).where(eq(s.listingPhotos.listingId, jacket))).length === 0);
  check('completed sale record is deleted', !(await exists(s.reservations, jacketBooking)));
  check('offer is deleted', (await db.select().from(s.offers).where(eq(s.offers.id, offer!.id))).length === 0);
  check('booking as buyer is deleted', !(await exists(s.reservations, lampBooking)));
  const oldPosts = await db.select().from(s.communityPosts).where(eq(s.communityPosts.authorId, OLD));
  check('unreported community post is deleted; reported one stays', oldPosts.length === 1 && oldPosts[0]!.id === reportedPost!.id);
  check('reported listing stays', await exists(s.listings, sketchy));
  check('both reports stay', (await db.select().from(s.reports)).length === 2);
  check("the other person's listing stays", await exists(s.listings, lamp));
  check('payment-linked listing stays', await exists(s.listings, boots));
  check('payment-linked sale record stays', await exists(s.reservations, bootsBooking));
  check('payment record stays', (await db.select().from(s.payments)).length === 1);
  check('anonymized user row stays', (await db.select().from(s.users).where(eq(s.users.id, OLD))).length === 1);
  check('account closed 10 days ago keeps its messages', (await msgsBy(RECENT)) === 1);
  check('account closed 10 days ago keeps its listing row', await exists(s.listings, desk));

  const again = await purgeClosedAccounts(db);
  check('second run is safe', again.accounts === 1 && (await exists(s.listings, boots)));

  console.log(`\n${passes} passed, ${failures} failed`);
  await pglite?.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
