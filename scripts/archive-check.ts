/**
 * The Archive and permanent posts, checked against a throwaway PGlite.
 *
 *   npm run test:archive
 *
 * Covers: a listing leaves the live Browse feed after its 24 hours and lands in
 * the Archive feed; an archived listing stays likeable and commentable; a buyer
 * proposes the time and place (any campus spot, up to 7 days ahead) and the
 * seller accepts or declines; a confirmed meetup holds the listing and
 * releases it back to the Archive; live listings keep their old rules; Community
 * text posts never expire; the posting brake is 5 per rolling day.
 * Modules load with `await import(...)` after the env block (see save-check).
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR ??= 'backend/data/archive-check-pg';
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SPOT_LISTED = '00000000-0000-4000-8000-0000000000b1';
const SPOT_OTHER = '00000000-0000-4000-8000-0000000000b2';
const SELLER = '00000000-0000-4000-8000-0000000000d1';
const BUYER = '00000000-0000-4000-8000-0000000000d2';
const OTHER = '00000000-0000-4000-8000-0000000000d3';
const BLOCKED = '00000000-0000-4000-8000-0000000000d4';

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
  const { blocks, campuses, communityPosts, listingSpots, listings, meetupSpots, reservations, users } = await import(
    '../backend/db/schema'
  );
  const { appRouter } = await import('../backend/trpc/app-router');
  const { upsertListingPost } = await import('../backend/trpc/listing-post');

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
    [SPOT_LISTED, 'Union'],
    [SPOT_OTHER, 'Library'],
  ] as const) {
    await db.insert(meetupSpots).values({ id, campusId: CAMPUS_ID, name, description: name, lat: 32.2, lng: -110.9, isDemo: true });
  }
  for (const [id, name] of [
    [SELLER, 'Seller'],
    [BUYER, 'Buyer'],
    [OTHER, 'Other'],
    [BLOCKED, 'Blocked'],
  ] as const) {
    await db.insert(users).values({
      id,
      email: `arc-${name.toLowerCase()}@demo.campus.test`,
      displayName: `${name} Test`,
      campusId: CAMPUS_ID,
      campusEmailVerifiedAt: new Date(),
      isDemo: true,
    });
  }
  const as = async (id: string) => {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    return appRouter.createCaller({ db, user: u! });
  };
  const anon = appRouter.createCaller({ db, user: null });
  const seller = await as(SELLER);
  const buyer = await as(BUYER);
  const other = await as(OTHER);
  const blocked = await as(BLOCKED);

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  /** A quarter-hour-aligned instant `ms` from now. */
  const slotAt = (ms: number) => new Date(Math.ceil((Date.now() + ms) / 900_000) * 900_000);

  const mk = async (title: string, patch: Partial<typeof listings.$inferInsert> = {}) => {
    const [l] = await db
      .insert(listings)
      .values({
        sellerId: SELLER,
        campusId: CAMPUS_ID,
        title,
        category: 'dorm',
        condition: 'good',
        priceCents: 2000,
        expiresAt: new Date(Date.now() + 12 * HOUR),
        ...patch,
      })
      .returning();
    await db.insert(listingSpots).values({ listingId: l!.id, spotId: SPOT_LISTED });
    // listing.create does this for real listings; these rows are inserted directly.
    await upsertListingPost(db, l!);
    return l!;
  };
  const statusOf = async (id: string) => (await db.select().from(listings).where(eq(listings.id, id)))[0]!.status;
  const live = async (viewer = buyer) => (await viewer.listing.feed({ campusId: CAMPUS_ID, limit: 50 })).items;
  const archive = async (viewer: typeof buyer | typeof anon = buyer, extra: Record<string, unknown> = {}) =>
    (await viewer.listing.feed({ campusId: CAMPUS_ID, archived: true, limit: 50, ...extra })).items;
  const past = () => new Date(Date.now() - 2 * HOUR);

  // --- who is in the live feed vs the Archive
  const fresh = await mk('Fresh lamp');
  const lapsed = await mk('Lapsed desk', { status: 'expired', expiresAt: past(), createdAt: new Date(Date.now() - 26 * HOUR) });
  const pending = await mk('Past deadline, not yet swept', { expiresAt: past(), createdAt: new Date(Date.now() - 25 * HOUR) });
  const sold = await mk('Sold chair', { status: 'sold', expiresAt: past() });
  await mk('Removed fan', { status: 'removed', expiresAt: past() });
  await mk('Held mirror', { status: 'reserved', expiresAt: past() });

  const liveTitles = (await live()).map((i) => i.title);
  check('the live feed holds only first-24-hour listings', liveTitles.join('|') === 'Fresh lamp', liveTitles.join('|'));
  const arc = await archive();
  const arcTitles = arc.map((i) => i.title);
  check('the Archive holds unsold listings past their 24 hours', arcTitles.includes('Lapsed desk') && arcTitles.includes('Past deadline, not yet swept'), arcTitles.join('|'));
  check('sold, removed and held listings are not in the Archive', !arcTitles.some((t) => ['Sold chair', 'Removed fan', 'Held mirror', 'Fresh lamp'].includes(t)));
  check('the Archive is newest first', arc[0]?.title === 'Past deadline, not yet swept' && arc[1]?.title === 'Lapsed desk', arcTitles.join('|'));
  check('signed-out visitors can browse the Archive', (await archive(anon)).length === 2);
  check('the Archive honours category filters', (await archive(buyer, { category: 'books' })).length === 0 && (await archive(buyer, { category: 'dorm' })).length === 2);
  check('Archive items carry likes, shares and preview comments', arc.every((i) => i.engagement.likeCount === 0 && Array.isArray(i.engagement.topComments)));
  const archHot = await archive(buyer, { sort: 'hot' });
  check('the Archive supports Hottest too', archHot.length === 2);

  // --- an archived listing stays interactive
  await buyer.listing.setLike({ id: lapsed.id, liked: true });
  await buyer.listingComment.add({ listingId: lapsed.id, body: 'Is this still around?' });
  const lapsedItem = (await archive()).find((i) => i.id === lapsed.id)!;
  check('an archived listing can be liked and commented on', lapsedItem.engagement.likeCount === 1 && lapsedItem.engagement.commentCount === 1);
  await rejects('offers stay closed on an archived listing', () => buyer.offer.create({ listingId: lapsed.id, amountCents: 1500 }), 'CONFLICT');
  await rejects('instant booking stays closed on an archived listing', () => buyer.reservation.book({ listingId: lapsed.id, spotId: SPOT_LISTED, startsAt: slotAt(2 * HOUR) }), 'CONFLICT');
  await rejects('a sold listing takes no comments', () => buyer.listingComment.add({ listingId: sold.id, body: 'hi' }), 'BAD_REQUEST');

  // --- buyer proposes the time and place; the seller accepts or declines
  const when = slotAt(3 * DAY);
  await rejects('a stranger-to-the-listing time beyond 7 days is refused', () => buyer.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: slotAt(8 * DAY) }), 'BAD_REQUEST');
  await rejects('a time in the past is refused', () => buyer.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: new Date(Date.now() - HOUR) }), 'BAD_REQUEST');
  await rejects('a time off the quarter hour is refused', () => buyer.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: new Date(when.getTime() + 60_000) }), 'BAD_REQUEST');
  await rejects('you cannot request your own listing', () => seller.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: when }), 'BAD_REQUEST');
  await rejects('a sold listing cannot be requested', () => buyer.reservation.request({ listingId: sold.id, spotId: SPOT_OTHER, startsAt: when }), 'CONFLICT');
  await rejects('an unknown spot is refused', () => buyer.reservation.request({ listingId: lapsed.id, spotId: '00000000-0000-4000-8000-0000000000ff', startsAt: when }), 'BAD_REQUEST');
  await db.insert(blocks).values({ blockerId: SELLER, blockedId: BLOCKED });
  await rejects('a blocked buyer cannot request', () => blocked.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: when }), 'FORBIDDEN');

  const req = await buyer.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: when });
  check('the buyer proposes a time and a place the seller never listed', req.status === 'requested' && req.proposedById === BUYER && req.spotId === SPOT_OTHER);
  check('an archived listing is not held by a mere request', (await statusOf(lapsed.id)) === 'expired');
  await rejects('a second open request by the same buyer is refused', () => buyer.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: slotAt(4 * DAY) }), 'CONFLICT');
  await rejects('the buyer cannot accept their own proposal', () => buyer.reservation.accept({ id: req.id }), 'FORBIDDEN');
  await rejects('only the seller can decline', () => buyer.reservation.decline({ id: req.id }), 'FORBIDDEN');
  await rejects('a stranger cannot accept', () => other.reservation.accept({ id: req.id }), 'FORBIDDEN');

  const accepted = await seller.reservation.accept({ id: req.id });
  check('the seller accepts: the meetup is confirmed', accepted.status === 'accepted' && !!accepted.handoffCode);
  check('a confirmed meetup holds the listing', (await statusOf(lapsed.id)) === 'reserved');
  check('a held listing leaves the Archive', !(await archive()).some((i) => i.id === lapsed.id));
  await rejects('nobody else can request a held listing', () => other.reservation.request({ listingId: lapsed.id, spotId: SPOT_OTHER, startsAt: slotAt(2 * DAY) }), 'CONFLICT');
  await seller.reservation.cancel({ id: req.id });
  check('cancelling releases it back to the Archive, not the live feed', (await statusOf(lapsed.id)) === 'expired' && (await archive()).some((i) => i.id === lapsed.id) && !(await live()).some((i) => i.id === lapsed.id));

  // decline path
  const req2 = await other.reservation.request({ listingId: lapsed.id, spotId: SPOT_LISTED, startsAt: slotAt(2 * DAY) });
  const declined = await seller.reservation.decline({ id: req2.id });
  check('the seller can decline a buyer-proposed meetup', declined.status === 'declined' && (await statusOf(lapsed.id)) === 'expired');
  const openAfter = await db.select().from(reservations).where(eq(reservations.listingId, lapsed.id));
  check('the history keeps every request', openAfter.length === 2);

  // a request that is still pending when the seller relists is not lost
  const req3 = await buyer.reservation.request({ listingId: pending.id, spotId: SPOT_OTHER, startsAt: slotAt(2 * DAY) });
  check('an unswept past-deadline listing is archived and requestable', req3.status === 'requested');

  // --- live listings keep the old rules
  await rejects('a live listing still needs a time the seller offered', () => buyer.reservation.request({ listingId: fresh.id, spotId: SPOT_LISTED, startsAt: slotAt(4 * HOUR) }), 'BAD_REQUEST');
  await rejects('a live listing still needs one of the seller’s spots', () => buyer.reservation.request({ listingId: fresh.id, spotId: SPOT_OTHER, startsAt: slotAt(4 * HOUR) }), 'BAD_REQUEST');

  // --- posts stay up indefinitely, with a per-day brake
  const oldPost = await buyer.community.create({ kind: 'buying', body: 'Looking for a mini fridge' });
  await db
    .update(communityPosts)
    .set({ createdAt: new Date(Date.now() - 10 * DAY) })
    .where(eq(communityPosts.id, oldPost.id));
  const feed = await other.community.feed({ kind: 'buying', sort: 'new', limit: 50 });
  check('a text post is still up 10 days later', feed.items.some((p) => p.id === oldPost.id));
  check('posts carry no expiry', feed.items.every((p) => !('expiresAt' in p)));
  const listingPost = (await other.community.feed({ kind: 'selling', sort: 'new', limit: 50 })).items.find((p) => p.listing?.id === pending.id);
  check('an archived listing keeps its Community post', !!listingPost);
  check('a sold listing has no Community post in the feed', !(await other.community.feed({ kind: 'selling', sort: 'new', limit: 50 })).items.some((p) => p.listing?.id === sold.id));

  // oldPost is 10 days old and no longer counts: five fresh posts fill the day.
  for (let i = 0; i < 5; i += 1) await buyer.community.create({ kind: 'buying', body: `Post number ${i + 1} today` });
  await rejects('the 6th post in a day hits the brake', () => buyer.community.create({ kind: 'buying', body: 'Too many' }), 'TOO_MANY_REQUESTS');
  const today = await db.select().from(communityPosts).where(eq(communityPosts.authorId, BUYER));
  const newest = today.filter((p) => Date.now() - p.createdAt.getTime() < DAY);
  await buyer.community.remove({ id: newest[0]!.id });
  await rejects('deleting a post does not dodge the brake', () => buyer.community.create({ kind: 'buying', body: 'Delete and repost' }), 'TOO_MANY_REQUESTS');
  check('listing posts do not count toward the brake', (await seller.community.create({ kind: 'selling', body: 'Seller text post' })).kind === 'selling');
  // Yesterday's posts no longer count: age them all past 24h.
  await db.update(communityPosts).set({ createdAt: new Date(Date.now() - 30 * HOUR) }).where(eq(communityPosts.authorId, BUYER));
  check('the brake is a rolling 24 hours', (await buyer.community.create({ kind: 'buying', body: 'A new day' })).kind === 'buying');

  await pglite?.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
