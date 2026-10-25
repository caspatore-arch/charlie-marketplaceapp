/**
 * Verification for the Dibbs workstreams (docs/CLAUDE-WORKSTREAM-PROMPTS.md):
 * offers, rolling-24h booking, community posts, messaging access, phone
 * sign-in + account linking, and transactional SMS.
 *
 *   npm run test:workstreams
 *
 * In-process: tRPC callers against a throwaway PGlite directory, the
 * simulated SMS provider swapped in, so nothing touches dev data and no text
 * is ever sent. Time-dependent cases move rows' timestamps instead of waiting.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-ws-'));
process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.DEV_LOGIN = '1';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
process.env.SMS_MODE = 'simulated';
process.env.SMS_DISPATCH_INTERVAL_MS = '0';

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];

async function check(name: string, body: () => Promise<void>) {
  try {
    await body();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}` : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name}\n      ${detail}`);
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

const MAYA = '00000000-0000-4000-8000-000000000001';
const JORDAN = '00000000-0000-4000-8000-000000000002';
const SAM = '00000000-0000-4000-8000-000000000003';
const CAMPUS = '00000000-0000-4000-8000-0000000000aa';
const SLOT = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

async function main() {
  const { seed } = await import('../backend/db/seed');
  await seed();
  const { db } = await import('../backend/db/client');
  const schema = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { userFromAuthHeader } = await import('../backend/trpc/create-context');
  const { applyExpiry, expireOffers } = await import('../backend/trpc/lib');
  const { SimulatedSmsProvider, setSmsProviderForTests } = await import('../backend/sms/provider');
  const { dispatchDueSms, enqueueBookingSms } = await import('../backend/sms/outbox');
  const d = await import('drizzle-orm');

  const sms = new SimulatedSmsProvider();
  setSmsProviderForTests(sms);

  const userRow = async (id: string) => (await db.select().from(schema.users).where(d.eq(schema.users.id, id)))[0]!;
  const as = async (id: string) => appRouter.createCaller({ db, user: await userRow(id) });
  const anon = appRouter.createCaller({ db, user: null });

  const spots = await db.select().from(schema.meetupSpots).where(d.eq(schema.meetupSpots.campusId, CAMPUS));
  const SPOT_A = spots[0]!.id;
  const SPOT_B = spots[1]!.id;

  const nextSlot = (fromMs = Date.now()) => Math.ceil(fromMs / SLOT) * SLOT;
  /** A fresh listing for `seller` with one window [now+startH, now+endH]. */
  async function makeListing(seller: string, opts: { priceCents?: number; startH?: number; endH?: number } = {}) {
    const s = nextSlot(Date.now() + (opts.startH ?? 1) * HOUR);
    const e = nextSlot(Date.now() + (opts.endH ?? 5) * HOUR);
    const caller = await as(seller);
    return caller.listing.create({
      title: `Test item ${Math.random().toString(36).slice(2, 7)}`,
      category: 'other',
      condition: 'good',
      priceCents: opts.priceCents ?? 4000,
      isSellToday: true,
      photoUrls: ['/api/uploads/demo-dorm.svg'],
      spotIds: [SPOT_A, SPOT_B],
      windows: [{ startsAt: new Date(s), endsAt: new Date(e) }],
    });
  }
  const smsRows = (where: ReturnType<typeof d.and> | ReturnType<typeof d.eq>) => db.select().from(schema.smsMessages).where(where);

  /* ================================================== retired auctions */

  await check('auctions: stale bid.place and bid.buyout are refused', async () => {
    const jordan = await as(JORDAN);
    const listing = await makeListing(MAYA);
    await expectCode('PRECONDITION_FAILED', () => jordan.bid.place({ listingId: listing.id, amountCents: 5000 }));
    await expectCode('PRECONDITION_FAILED', () => jordan.bid.buyout({ listingId: listing.id }));
  });

  await check('auctions: creating an auction listing is refused with a clear message', async () => {
    const maya = await as(MAYA);
    const msg = await expectCode('BAD_REQUEST', () =>
      maya.listing.create({
        title: 'Old client auction',
        category: 'other',
        condition: 'good',
        priceCents: 0,
        saleType: 'auction',
        startPriceCents: 1000,
        isSellToday: false,
        photoUrls: ['/api/uploads/demo-dorm.svg'],
        spotIds: [SPOT_A],
        windows: [{ startsAt: new Date(nextSlot(Date.now() + HOUR)), endsAt: new Date(nextSlot(Date.now() + 3 * HOUR)) }],
      }),
    );
    assert(/offers/i.test(msg), `message should mention offers: ${msg}`);
  });

  await check('auctions: a pre-existing auction listing settles at its end time (commitment honoured)', async () => {
    const listing = await makeListing(MAYA);
    // Simulate a legacy row: an auction with a bid, already past its end.
    await db
      .update(schema.listings)
      .set({ saleType: 'auction', startPriceCents: 1000, expiresAt: new Date(Date.now() - 1000) })
      .where(d.eq(schema.listings.id, listing.id));
    await db.insert(schema.bids).values({ listingId: listing.id, bidderId: JORDAN, amountCents: 1500 });
    await applyExpiry(db);
    const [l] = await db.select().from(schema.listings).where(d.eq(schema.listings.id, listing.id));
    eq(l!.status, 'reserved', 'legacy auction held for its winner');
    const res = await db.select().from(schema.reservations).where(d.eq(schema.reservations.listingId, listing.id));
    eq(res[0]?.priceCents, 1500, 'winner reservation at the winning bid');
    const bidsLeft = await db.select().from(schema.bids).where(d.eq(schema.bids.listingId, listing.id));
    eq(bidsLeft.length, 1, 'bid history kept');
  });

  /* ============================================================ offers */

  await check('offers: invalid prices and ownership are rejected', async () => {
    const listing = await makeListing(MAYA, { priceCents: 4000 });
    const jordan = await as(JORDAN);
    const maya = await as(MAYA);
    await expectCode('BAD_REQUEST', () => jordan.offer.create({ listingId: listing.id, amountCents: 4000 }));
    await expectCode('BAD_REQUEST', () => jordan.offer.create({ listingId: listing.id, amountCents: 99 }));
    await expectCode('BAD_REQUEST', () => jordan.offer.create({ listingId: listing.id, amountCents: 12.5 as number }));
    await expectCode('BAD_REQUEST', () => maya.offer.create({ listingId: listing.id, amountCents: 3000 }));
    const offer = await jordan.offer.create({ listingId: listing.id, amountCents: 3000 });
    await expectCode('CONFLICT', () => jordan.offer.create({ listingId: listing.id, amountCents: 3100 }));
    await expectCode('FORBIDDEN', () => jordan.offer.accept({ id: offer.id }));
    await expectCode('FORBIDDEN', () => (async () => (await as(SAM)).offer.decline({ id: offer.id }))());
    await expectCode('FORBIDDEN', () => maya.offer.withdraw({ id: offer.id }));
    const seen = await (await as(SAM)).offer.forListing({ listingId: listing.id });
    eq(seen.offers.length, 0, "another buyer can't see Jordan's offer");
  });

  await check('offers: simultaneous accepts on one item — exactly one wins', async () => {
    const listing = await makeListing(MAYA, { priceCents: 5000 });
    const o1 = await (await as(JORDAN)).offer.create({ listingId: listing.id, amountCents: 4000 });
    const o2 = await (await as(SAM)).offer.create({ listingId: listing.id, amountCents: 4200 });
    const maya = await as(MAYA);
    const settled = await Promise.allSettled([maya.offer.accept({ id: o1.id }), maya.offer.accept({ id: o2.id })]);
    eq(settled.filter((s) => s.status === 'fulfilled').length, 1, 'one accept succeeds');
    const rejected = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    eq((rejected.reason as { code: string }).code, 'CONFLICT', 'the other is CONFLICT');
  });

  await check('offers: accepted offer holds the item; buyer books at the offer price; others closed', async () => {
    const listing = await makeListing(MAYA, { priceCents: 5000 });
    const jordan = await as(JORDAN);
    const sam = await as(SAM);
    const offer = await jordan.offer.create({ listingId: listing.id, amountCents: 3500 });
    const samOffer = await sam.offer.create({ listingId: listing.id, amountCents: 3000 });
    await (await as(MAYA)).offer.accept({ id: offer.id });

    const slots = await jordan.reservation.slots({ listingId: listing.id });
    const slot = slots.slots.find((s) => s.available)!;
    await expectCode('CONFLICT', () => sam.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slot.startsAt }));

    const booked = await jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slot.startsAt });
    eq(booked.priceCents, 3500, 'booking carries the agreed price');
    eq(booked.status, 'accepted', 'booking is confirmed');
    const [o] = await db.select().from(schema.offers).where(d.eq(schema.offers.id, offer.id));
    eq(o!.status, 'booked', 'offer marked booked');
    const [so] = await db.select().from(schema.offers).where(d.eq(schema.offers.id, samOffer.id));
    eq(so!.status, 'declined', "Sam's pending offer closed");
    eq(so!.closeReason, 'item_reserved', 'with a reason');
    await expectCode('CONFLICT', () => (async () => (await as(MAYA)).offer.accept({ id: samOffer.id }))());
  });

  await check('offers: stale offers — expired hold, expired listing, already-closed offer', async () => {
    const listing = await makeListing(MAYA, { priceCents: 5000 });
    const jordan = await as(JORDAN);
    const maya = await as(MAYA);
    const offer = await jordan.offer.create({ listingId: listing.id, amountCents: 4000 });
    await maya.offer.accept({ id: offer.id });
    // Hold lapses → offer expires and the item opens up for others.
    await db.update(schema.offers).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(d.eq(schema.offers.id, offer.id));
    await expireOffers(db);
    const [o] = await db.select().from(schema.offers).where(d.eq(schema.offers.id, offer.id));
    eq(o!.status, 'expired', 'lapsed hold expires');
    eq(o!.closeReason, 'hold_lapsed', 'reason recorded');
    await expectCode('CONFLICT', () => maya.offer.accept({ id: offer.id }));
    await expectCode('CONFLICT', () => jordan.offer.withdraw({ id: offer.id }));

    // Pending offer lapses with its listing; the listing then refuses offers.
    const samOffer = await (await as(SAM)).offer.create({ listingId: listing.id, amountCents: 3000 });
    await db.update(schema.listings).set({ expiresAt: new Date(Date.now() - 1000) }).where(d.eq(schema.listings.id, listing.id));
    await applyExpiry(db);
    const [so] = await db.select().from(schema.offers).where(d.eq(schema.offers.id, samOffer.id));
    eq(so!.status, 'expired', 'pending offer expires with the listing');
    await expectCode('CONFLICT', () => jordan.offer.create({ listingId: listing.id, amountCents: 2000 }));
  });

  /* =========================================================== booking */

  await check('booking: slots are 15-min aligned, inside the window, within 24h', async () => {
    const listing = await makeListing(MAYA, { startH: 1, endH: 3 });
    const res = await anon.reservation.slots({ listingId: listing.id });
    assert(res.open, 'listing open');
    eq(res.slotMinutes, 15, 'explicit slot length');
    assert(res.slots.length >= 3, `expected several slots, got ${res.slots.length}`);
    for (const s of res.slots) {
      eq(s.startsAt.getTime() % SLOT, 0, 'aligned');
      assert(s.startsAt.getTime() > Date.now(), 'future');
      assert(s.startsAt.getTime() < Date.now() + 24 * HOUR, 'within 24h');
    }
    eq(res.spots.length, 2, 'campus spots offered');
  });

  await check('booking: a :15 start books, a :10 start is rejected, adjacent 15-min slots coexist', async () => {
    const listing = await makeListing(MAYA, { startH: 1, endH: 3 });
    const jordan = await as(JORDAN);
    const slots = (await jordan.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const quarter = slots.find((s) => s.startsAt.getUTCMinutes() % 30 === 15);
    assert(!!quarter, 'a :15 or :45 slot is offered');
    const next = slots.find((s) => s.startsAt.getTime() === quarter!.startsAt.getTime() + SLOT);
    assert(!!next, 'the adjacent slot is offered');
    await expectCode('BAD_REQUEST', () =>
      jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: new Date(quarter!.startsAt.getTime() - (quarter!.startsAt.getUTCMinutes() - 10) * 60_000) }),
    );
    const booked = await jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: quarter!.startsAt });
    eq(booked.status, 'accepted', 'a :15 start books');
    // Adjacent (back-to-back) slots are not an overlap for the seller.
    const listing2 = await makeListing(MAYA, { startH: 1, endH: 3 });
    const res2 = await jordan.reservation.slots({ listingId: listing2.id });
    const adj = res2.slots.find((s) => s.startsAt.getTime() === next!.startsAt.getTime());
    assert(!!adj && adj.available, 'adjacent slot on another listing stays bookable');
    const prev = res2.slots.find((s) => s.startsAt.getTime() === quarter!.startsAt.getTime());
    assert(!!prev && !prev.available, 'the booked slot is unavailable on the seller\'s other listing');
    // Free the slot (and its queued reminders) so later SMS checks start clean.
    await jordan.reservation.cancel({ id: booked.id });
  });

  await check('booking: invalid times, spots, and stale availability are rejected', async () => {
    const listing = await makeListing(MAYA, { startH: 1, endH: 3 });
    const jordan = await as(JORDAN);
    const slots = (await jordan.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const good = slots[0]!.startsAt;
    await expectCode('BAD_REQUEST', () =>
      jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: new Date(good.getTime() + 60_000) }),
    );
    await expectCode('BAD_REQUEST', () =>
      jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: new Date(nextSlot() - SLOT) }),
    );
    await expectCode('CONFLICT', () =>
      jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: new Date(good.getTime() + 6 * HOUR) }),
    );
    const otherSpot = spots.find((s) => s.id !== SPOT_A && s.id !== SPOT_B)!;
    await expectCode('BAD_REQUEST', () => jordan.reservation.book({ listingId: listing.id, spotId: otherSpot.id, startsAt: good }));
    // Seller moves availability after the buyer loaded the chart.
    await (await as(MAYA)).listing.update({
      id: listing.id,
      windows: [{ startsAt: new Date(nextSlot(Date.now() + 4 * HOUR)), endsAt: new Date(nextSlot(Date.now() + 6 * HOUR)) }],
    });
    const msg = await expectCode('CONFLICT', () => jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: good }));
    assert(/availability changed/i.test(msg), msg);
    await expectCode('CONFLICT', () =>
      jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: new Date(nextSlot(Date.now() + 4 * HOUR)), expectedPriceCents: 1 }),
    );
  });

  await check('booking: re-submitting the same booking is idempotent', async () => {
    const listing = await makeListing(MAYA);
    const jordan = await as(JORDAN);
    const slots = (await jordan.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const a = await jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[1]!.startsAt });
    const b = await jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[1]!.startsAt });
    eq(a.id, b.id, 'same reservation returned');
    const all = await db.select().from(schema.reservations).where(d.eq(schema.reservations.listingId, listing.id));
    eq(all.length, 1, 'no duplicate row');
  });

  await check('booking: two buyers racing for one item — exactly one booking', async () => {
    const listing = await makeListing(MAYA);
    const slots = (await anon.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const [j, s] = [await as(JORDAN), await as(SAM)];
    const settled = await Promise.allSettled([
      j.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[2]!.startsAt }),
      s.reservation.book({ listingId: listing.id, spotId: SPOT_B, startsAt: slots[3]!.startsAt }),
    ]);
    eq(settled.filter((x) => x.status === 'fulfilled').length, 1, 'one wins');
    const accepted = await db
      .select()
      .from(schema.reservations)
      .where(d.and(d.eq(schema.reservations.listingId, listing.id), d.eq(schema.reservations.status, 'accepted')));
    eq(accepted.length, 1, 'one accepted reservation in the DB');
  });

  let crossA = '';
  let crossB = '';
  let crossSlot = new Date();
  await check('booking: a seller cannot be double-booked across listings (incl. concurrently)', async () => {
    const a = await makeListing(JORDAN, { startH: 7, endH: 9 });
    const b = await makeListing(JORDAN, { startH: 7, endH: 9 });
    crossA = a.id;
    crossB = b.id;
    const slots = (await anon.reservation.slots({ listingId: a.id })).slots.filter((x) => x.available);
    crossSlot = slots[0]!.startsAt;
    const settled = await Promise.allSettled([
      (await as(MAYA)).reservation.book({ listingId: a.id, spotId: SPOT_A, startsAt: crossSlot }),
      (await as(SAM)).reservation.book({ listingId: b.id, spotId: SPOT_A, startsAt: crossSlot }),
    ]);
    eq(settled.filter((x) => x.status === 'fulfilled').length, 1, 'only one booking for that seller slot');
    const after = await anon.reservation.slots({ listingId: b.id });
    const same = after.slots.find((s) => s.startsAt.getTime() === crossSlot.getTime());
    eq(same?.available, false, 'the slot shows as taken on the other listing');
    eq(same?.reason, 'seller_busy', 'with a reason');
  });

  await check('booking: cancelling frees the slot and returns the item to the feed', async () => {
    const res = await db
      .select()
      .from(schema.reservations)
      .where(d.and(d.inArray(schema.reservations.listingId, [crossA, crossB]), d.eq(schema.reservations.status, 'accepted')));
    const r = res[0]!;
    await (await as(r.buyerId)).reservation.cancel({ id: r.id, reason: 'test' });
    const [l] = await db.select().from(schema.listings).where(d.eq(schema.listings.id, r.listingId));
    eq(l!.status, 'active', 'listing released');
    const other = r.listingId === crossA ? crossB : crossA;
    const slots = await anon.reservation.slots({ listingId: other });
    eq(slots.slots.find((s) => s.startsAt.getTime() === crossSlot.getTime())?.available, true, 'slot free again');
    const history = await (await as(r.buyerId)).reservation.history({ id: r.id });
    assert(history.map((h) => h.kind).join(',') === 'booked,cancelled', `history: ${history.map((h) => h.kind)}`);
  });

  await check('booking: expired listing takes no bookings; a confirmed meetup survives expiry', async () => {
    const listing = await makeListing(MAYA);
    const jordan = await as(JORDAN);
    const slots = (await jordan.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const booked = await jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[0]!.startsAt });
    // The listing's own 24h passes while the meetup is confirmed.
    await db.update(schema.listings).set({ expiresAt: new Date(Date.now() - 1000) }).where(d.eq(schema.listings.id, listing.id));
    await applyExpiry(db);
    const still = await jordan.reservation.byId({ id: booked.id });
    eq(still.status, 'accepted', 'confirmed meetup still accepted');
    eq(still.spot?.id, SPOT_A, 'exact place kept');
    eq(still.startsAt.getTime(), slots[0]!.startsAt.getTime(), 'exact time kept');
    const sellerView = await (await as(MAYA)).reservation.byId({ id: booked.id });
    eq(sellerView.priceCents, 4000, 'seller sees the agreed price');
    // Cancel → listing lands on expired (its 24h is over), not back in the feed.
    await jordan.reservation.cancel({ id: booked.id });
    const [l] = await db.select().from(schema.listings).where(d.eq(schema.listings.id, listing.id));
    eq(l!.status, 'expired', 'released into expired, not active');
    await expectCode('CONFLICT', () => (async () => (await as(SAM)).reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[1]!.startsAt }))());
    const after = await jordan.reservation.byId({ id: booked.id });
    eq(after.status, 'cancelled', 'record retained after cancellation');
  });

  await check('archive: expired listing leaves the feed, shows as archived for its owner, relists lower with a fresh 24h', async () => {
    const listing = await makeListing(MAYA, { priceCents: 5000 });
    await db.update(schema.listings).set({ expiresAt: new Date(Date.now() - 1000) }).where(d.eq(schema.listings.id, listing.id));
    const maya = await as(MAYA);
    const feed = await anon.listing.feed({ campusId: CAMPUS, limit: 50 });
    assert(!feed.items.some((i) => i.id === listing.id), 'expired listing is not in the feed');
    // The query the Archive tab uses: listing.mine, filtered to expired or
    // past-deadline (the stored status can lag the sweep) and unsold.
    const isArchived = (l: { status: string; expiresAt: Date | string | null }) =>
      l.status === 'expired' || (l.status === 'active' && l.expiresAt != null && new Date(l.expiresAt).getTime() <= Date.now());
    const archived = (await maya.listing.mine()).filter(isArchived);
    assert(archived.some((l) => l.id === listing.id), 'owner sees it as archived');
    const others = (await (await as(JORDAN)).listing.mine()).filter((l) => l.id === listing.id);
    eq(others.length, 0, 'another user never gets it from mine');
    const before = Date.now();
    const s = nextSlot(Date.now() + HOUR);
    const relisted = await maya.listing.relist({
      id: listing.id,
      isSellToday: true,
      priceCents: 4000,
      windows: [{ startsAt: new Date(s), endsAt: new Date(s + HOUR) }],
    });
    eq(relisted.status, 'active', 'live again');
    eq(relisted.priceCents, 4000, 'lower price applied');
    const hrs = (relisted.expiresAt!.getTime() - before) / HOUR;
    assert(hrs > 23.9 && hrs <= 24.1, `fresh 24h expiry (${hrs})`);
    const feed2 = await anon.listing.feed({ campusId: CAMPUS, limit: 50 });
    assert(feed2.items.some((i) => i.id === listing.id), 'back in the feed');
    assert(!(await maya.listing.mine()).filter(isArchived).some((l) => l.id === listing.id), 'gone from archive');
  });

  await check('listing: availability must be within the rolling 24 hours, and at least one window', async () => {
    const maya = await as(MAYA);
    const base = {
      title: 'Window test',
      category: 'other' as const,
      condition: 'good' as const,
      priceCents: 1000,
      isSellToday: true,
      photoUrls: ['/api/uploads/demo-dorm.svg'],
      spotIds: [SPOT_A],
    };
    await expectCode('BAD_REQUEST', () => maya.listing.create({ ...base, windows: [] }));
    await expectCode('BAD_REQUEST', () =>
      maya.listing.create({ ...base, windows: [{ startsAt: new Date(Date.now() + 20 * HOUR), endsAt: new Date(Date.now() + 26 * HOUR) }] }),
    );
    await expectCode('BAD_REQUEST', () =>
      maya.listing.create({ ...base, windows: [{ startsAt: new Date(Date.now() - 3 * HOUR), endsAt: new Date(Date.now() - HOUR) }] }),
    );
    const ok = await maya.listing.create({ ...base, windows: [{ startsAt: new Date(Date.now()), endsAt: new Date(Date.now() + 2 * HOUR) }] });
    assert(ok.expiresAt && Math.abs(ok.expiresAt.getTime() - (Date.now() + 24 * HOUR)) < 60_000, 'expires in 24h');
  });

  /* ======================================================= community */

  // A second campus and a member, for isolation checks.
  const [otherCampus] = await db
    .insert(schema.campuses)
    .values({ name: 'Demo State', slug: `demo-state-${Date.now()}`, emailDomains: ['state.test'], timezone: 'America/Phoenix', isDemo: true })
    .returning();
  const [outsider] = await db
    .insert(schema.users)
    .values({ email: `pat${Date.now()}@state.test`, displayName: 'Pat Elsewhere', campusId: otherCampus!.id, campusEmailVerifiedAt: new Date() })
    .returning();

  let jordanPostId = '';
  await check('community: buyers and sellers both post; posts have no expiry', async () => {
    const jp = await (await as(JORDAN)).community.create({ kind: 'buying', body: 'Does anyone have shirts?' });
    const mp = await (await as(MAYA)).community.create({ kind: 'selling', body: 'Anyone interested in buying shirts?' });
    jordanPostId = jp.id;
    const feed = await (await as(SAM)).community.feed({ limit: 50 });
    const ids = feed.items.map((p) => p.id);
    assert(ids.includes(jp.id) && ids.includes(mp.id), 'both visible');
    assert(!('expiresAt' in jp), 'a post carries no expiry');
    const selling = await (await as(SAM)).community.feed({ kind: 'selling', limit: 50 });
    assert(selling.items.every((p) => p.kind === 'selling'), 'kind filter');
    await expectCode('BAD_REQUEST', () => (async () => (await as(SAM)).community.create({ kind: 'buying', body: 'x'.repeat(281) }))());
  });

  await check('community: campus isolation for feed and direct retrieval', async () => {
    const outsiderCaller = appRouter.createCaller({ db, user: outsider! });
    const feed = await outsiderCaller.community.feed({ limit: 50 });
    assert(!feed.items.some((p) => p.id === jordanPostId), 'other campus cannot see it');
    await expectCode('NOT_FOUND', () => outsiderCaller.community.byId({ id: jordanPostId }));
    await expectCode('UNAUTHORIZED', () => anon.community.feed({ limit: 5 }));
  });

  await check('community: posts stay up indefinitely (until removed)', async () => {
    const p = await (await as(SAM)).community.create({ kind: 'buying', body: 'Need a desk lamp tonight' });
    // Three days old, with a long-lapsed legacy deadline: still listed and retrievable.
    await db
      .update(schema.communityPosts)
      .set({ createdAt: new Date(Date.now() - 72 * HOUR), expiresAt: new Date(Date.now() - 48 * HOUR) })
      .where(d.eq(schema.communityPosts.id, p.id));
    const feed = await (await as(JORDAN)).community.feed({ limit: 50 });
    assert(feed.items.some((x) => x.id === p.id), 'still in the feed');
    eq((await (await as(JORDAN)).community.byId({ id: p.id })).id, p.id, 'still retrievable by id');
    await (await as(SAM)).community.remove({ id: p.id });
    const after = await (await as(JORDAN)).community.feed({ limit: 50 });
    assert(!after.items.some((x) => x.id === p.id), 'removal is what takes a post down');
  });

  await check('community: blocking hides posts both ways; reporting files a report', async () => {
    await (await as(SAM)).user.block({ userId: JORDAN });
    const samFeed = await (await as(SAM)).community.feed({ limit: 50 });
    assert(!samFeed.items.some((p) => p.id === jordanPostId), 'blocker no longer sees it');
    const sp = await (await as(SAM)).community.create({ kind: 'selling', body: 'Selling a TI-84' });
    const jordanFeed = await (await as(JORDAN)).community.feed({ limit: 50 });
    assert(!jordanFeed.items.some((p) => p.id === sp.id), 'blocked user does not see it either');
    await (await as(SAM)).user.unblock({ userId: JORDAN });
    await (await as(MAYA)).community.report({ id: jordanPostId, reason: 'scam', details: 'test' });
    const reps = await db.select().from(schema.reports).where(d.eq(schema.reports.targetPostId, jordanPostId));
    eq(reps.length, 1, 'report stored against the post');
    await expectCode('FORBIDDEN', () => (async () => (await as(MAYA)).community.remove({ id: jordanPostId }))());
  });

  /* ======================================================== messaging */

  await check('messaging: buyer↔seller thread from a listing; outsiders refused; survives expiry', async () => {
    const listing = await makeListing(MAYA);
    const jordan = await as(JORDAN);
    const convo = await jordan.conversation.open({ listingId: listing.id });
    await jordan.conversation.send({ conversationId: convo.id, body: 'Is this still available?' });
    const maya = await as(MAYA);
    await maya.conversation.send({ conversationId: convo.id, body: 'Yes! Book any open slot.' });
    await expectCode('FORBIDDEN', () => (async () => (await as(SAM)).conversation.messages({ conversationId: convo.id }))());
    await db.update(schema.listings).set({ status: 'expired' }).where(d.eq(schema.listings.id, listing.id));
    const msgs = await jordan.conversation.messages({ conversationId: convo.id });
    eq(msgs.items.length, 2, 'history still readable after the listing expired');
  });

  /* ======================================================= phone auth */

  const lastCode = (phone: string) => {
    const m = [...sms.sent].reverse().find((x) => x.to === phone && x.sensitive);
    return /(\d{6})/.exec(m?.body ?? '')?.[1] ?? '';
  };

  let phoneToken = '';
  let phoneUserId = '';
  await check('phone: normalization, simulated delivery, wrong code, resend cooldown', async () => {
    await expectCode('BAD_REQUEST', () => anon.auth.requestPhoneCode({ phone: '555-1234' }));
    const r = await anon.auth.requestPhoneCode({ phone: '(520) 555-0177' });
    eq(r.simulated, true, 'simulated delivery reported');
    const code = lastCode('+15205550177');
    assert(code.length === 6, 'code delivered to the simulated outbox');
    const wrong = code === '000000' ? '111111' : '000000';
    const msg = await expectCode('BAD_REQUEST', () => anon.auth.verifyPhoneCode({ phone: '5205550177', code: wrong }));
    assert(/4 tries left/.test(msg), msg);
    await expectCode('TOO_MANY_REQUESTS', () => anon.auth.requestPhoneCode({ phone: '+1 520 555 0177' }));
    const step = await anon.auth.verifyPhoneCode({ phone: '5205550177', code });
    eq(step.status, 'needs_profile', 'new number asks for a profile first');
    const done = await anon.auth.verifyPhoneCode({ phone: '5205550177', code, displayName: 'Riley Phone', campusId: CAMPUS, smsOptIn: true });
    assert(done.status === 'signed_in', 'signed in');
    eq(done.isNewAccount, true, 'new account');
    eq(done.user.campusEmailVerifiedAt, null, 'phone does NOT claim campus verification');
    phoneToken = done.token;
    phoneUserId = done.user.id;
    await expectCode('BAD_REQUEST', () => anon.auth.verifyPhoneCode({ phone: '5205550177', code }));
  });

  await check('phone: session persists (token resolves to the same user)', async () => {
    const u = await userFromAuthHeader(`Bearer ${phoneToken}`);
    eq(u?.id, phoneUserId, 'bearer token → user');
    const me = await appRouter.createCaller({ db, user: u }).auth.me();
    eq(me.phone, '+15205550177', 'me returns the phone to its owner');
  });

  await check('phone: unverified-campus account can browse/read but not sell, offer, book or post', async () => {
    const riley = await as(phoneUserId);
    await riley.community.feed({ limit: 5 });
    await expectCode('FORBIDDEN', () => riley.community.create({ kind: 'buying', body: 'anyone selling bikes?' }));
    const listing = await makeListing(MAYA);
    await expectCode('FORBIDDEN', () => riley.offer.create({ listingId: listing.id, amountCents: 1000 }));
    const slots = (await riley.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    await expectCode('FORBIDDEN', () => riley.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[0]!.startsAt }));
  });

  await check('phone: code expiry, 5-attempt burn, and hourly send cap', async () => {
    const phone = '+15205550188';
    await anon.auth.requestPhoneCode({ phone });
    const code = lastCode(phone);
    await db.update(schema.phoneCodes).set({ expiresAt: new Date(Date.now() - 1) }).where(d.eq(schema.phoneCodes.phone, phone));
    await expectCode('BAD_REQUEST', () => anon.auth.verifyPhoneCode({ phone, code }));
    // Skip the 30s cooldown by ageing the previous code.
    const age = () =>
      db.update(schema.phoneCodes).set({ createdAt: new Date(Date.now() - 31_000) }).where(d.eq(schema.phoneCodes.phone, phone));
    await age();
    await anon.auth.requestPhoneCode({ phone });
    const good = lastCode(phone);
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expectCode('BAD_REQUEST', () => anon.auth.verifyPhoneCode({ phone, code: bad }));
    await expectCode('BAD_REQUEST', () => anon.auth.verifyPhoneCode({ phone, code: good }));
    for (let i = 0; i < 3; i++) {
      await age();
      await anon.auth.requestPhoneCode({ phone });
    }
    await age();
    const msg = await expectCode('TOO_MANY_REQUESTS', () => anon.auth.requestPhoneCode({ phone }));
    assert(/hour/.test(msg), msg);
  });

  await check('linking: empty phone account verifying an existing campus email switches into it', async () => {
    // Jordan has listings; a fresh phone-only account claims Jordan's email.
    const phone = '+15205550199';
    await anon.auth.requestPhoneCode({ phone });
    const done = await anon.auth.verifyPhoneCode({ phone, code: lastCode(phone), displayName: 'J on phone', campusId: CAMPUS });
    assert(done.status === 'signed_in', 'signed in');
    await db.update(schema.users).set({ phone: null, phoneVerifiedAt: null }).where(d.eq(schema.users.id, JORDAN));
    const tmp = await as(done.user.id);
    await tmp.auth.requestEmailLinkCode({ email: 'jordan@demo.campus.test' });
    const [codeRow] = await db
      .select()
      .from(schema.emailCodes)
      .where(d.eq(schema.emailCodes.email, 'jordan@demo.campus.test'))
      .orderBy(d.desc(schema.emailCodes.expiresAt))
      .limit(1);
    const out = await tmp.auth.confirmEmailLink({ email: 'jordan@demo.campus.test', code: codeRow!.code });
    eq(out.switchedAccount, true, 'switched to the existing account');
    eq(out.user.id, JORDAN, 'kept the account with history');
    eq(out.user.phone, phone, 'phone moved onto it');
    const retired = await userRow(done.user.id);
    assert(retired.deletedAt != null, 'empty account retired');
    const listingsKept = await db.select().from(schema.listings).where(d.eq(schema.listings.sellerId, JORDAN));
    assert(listingsKept.length > 0, "Jordan's listings untouched");
  });

  await check('linking: attaching a phone that belongs to an account with history is refused', async () => {
    // Riley (phone account) now has activity; Sam (email) tries to take Riley's number.
    await db.update(schema.users).set({ campusEmailVerifiedAt: new Date() }).where(d.eq(schema.users.id, phoneUserId));
    await (await as(phoneUserId)).community.create({ kind: 'buying', body: 'Looking for a bike lock' });
    await db.update(schema.phoneCodes).set({ createdAt: new Date(Date.now() - 31_000) }).where(d.eq(schema.phoneCodes.phone, '+15205550177'));
    const sam = await as(SAM);
    await sam.auth.requestPhoneLinkCode({ phone: '5205550177' });
    await expectCode('CONFLICT', () => sam.auth.confirmPhoneLink({ phone: '5205550177', code: lastCode('+15205550177') }));
    eq((await userRow(phoneUserId)).phone, '+15205550177', 'number stays with its owner');
  });

  /* ============================================================ email */

  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');
  const mail = new SimulatedEmailProvider();
  setEmailProviderForTests(mail);

  await check('email: sign-in code is delivered through the provider; cooldown; failed send burns the code', async () => {
    const methods = await anon.auth.methods();
    eq(methods.primary, 'email', 'email-first while SMS is not live');
    eq(methods.email.simulated, true, 'email simulated in tests');
    const addr = 'casey@demo.campus.test';
    const r = await anon.auth.requestCode({ email: addr });
    eq(r.simulated, true, 'reports simulated delivery');
    const msg = mail.sent.find((m) => m.to === addr);
    assert(msg && /\b\d{6}\b/.test(msg.subject) && msg.text.includes('expires in 10 minutes'), 'code email sent');
    const code = /(\d{6})/.exec(msg!.subject)![1]!;
    await expectCode('TOO_MANY_REQUESTS', () => anon.auth.requestCode({ email: addr }));
    const done = await anon.auth.verifyCode({ email: addr, code, displayName: 'Casey' });
    assert(done.token, 'code from the email signs in');

    const addr2 = 'drew@demo.campus.test';
    mail.failNext = 1;
    await expectCode('INTERNAL_SERVER_ERROR', () => anon.auth.requestCode({ email: addr2 }));
    const rows = await db.select().from(schema.emailCodes).where(d.eq(schema.emailCodes.email, addr2));
    assert(rows.length === 1 && rows[0]!.consumedAt != null, 'unsent code is burned');
    // Ageing the burned code past the cooldown allows a retry that works.
    await db
      .update(schema.emailCodes)
      .set({ expiresAt: new Date(Date.now() + 10 * 60_000 - 31_000) })
      .where(d.eq(schema.emailCodes.email, addr2));
    await anon.auth.requestCode({ email: addr2 });
    assert(mail.sent.some((m) => m.to === addr2), 'retry delivered');
  });

  await check('email: campus-verification code for a signed-in phone account goes by email', async () => {
    const before = mail.sent.length;
    const caller = await as(phoneUserId);
    await caller.auth.requestEmailLinkCode({ email: 'riley@demo.campus.test' });
    const m = mail.sent.slice(before).find((x) => x.to === 'riley@demo.campus.test');
    assert(m && m.text.includes('verify your campus email'), 'verification email sent');
  });

  /* ============================================================== SMS */

  const MAYA_PHONE = '+15205550101';
  await check('sms: listing posted → seller text, sent by the dispatcher', async () => {
    const listing = await makeListing(MAYA);
    const rows = await smsRows(d.eq(schema.smsMessages.listingId, listing.id));
    eq(rows.length, 1, 'one listing_posted row');
    eq(rows[0]!.kind, 'listing_posted', 'kind');
    const before = sms.sent.length;
    await dispatchDueSms(db);
    assert(sms.sent.slice(before).some((m) => m.to === MAYA_PHONE && m.body.includes(listing.title)), 'seller got it');
  });

  await check('sms: confirmed booking → both participants; 30-min reminders scheduled; dedupe', async () => {
    const listing = await makeListing(MAYA, { startH: 2, endH: 4 });
    await db.update(schema.users).set({ phone: '+15205550103', phoneVerifiedAt: new Date(), smsOptIn: true }).where(d.eq(schema.users.id, SAM));
    const sam = await as(SAM);
    const slots = (await sam.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const r = await sam.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[0]!.startsAt });
    const rows = await smsRows(d.eq(schema.smsMessages.reservationId, r.id));
    eq(rows.filter((x) => x.kind === 'booking_confirmed').length, 2, 'confirmation to buyer and seller');
    eq(rows.filter((x) => x.kind === 'meetup_reminder').length, 2, 'reminder to both');
    const reminder = rows.find((x) => x.kind === 'meetup_reminder')!;
    eq(reminder.sendAfter.getTime(), r.startsAt.getTime() - 30 * 60_000, 'reminder 30 min before');
    await enqueueBookingSms(db, r.id);
    eq((await smsRows(d.eq(schema.smsMessages.reservationId, r.id))).length, 4, 'no duplicates on re-enqueue');
    const res1 = await dispatchDueSms(db);
    assert(res1.sent >= 2, 'confirmations sent now');
    const buyerMsg = sms.sent.find((m) => m.to === '+15205550103' && m.body.includes('Booked!'));
    assert(buyerMsg && buyerMsg.body.includes(listing.title) && buyerMsg.body.includes('$40'), 'buyer text has item and price');
    assert(!buyerMsg.body.includes(MAYA_PHONE), 'no phone numbers in the text');
    // Earlier tests leave other meetups queued (15-minute slots can sit just
    // before this one), so count only the texts about THIS listing.
    const mine = (from: number) => sms.sent.slice(from).filter((m) => m.body.includes(listing.title) && m.body.includes('reminder')).length;
    const before2 = sms.sent.length;
    await dispatchDueSms(db, { now: new Date(r.startsAt.getTime() - 29 * 60_000) });
    eq(mine(before2), 2, 'both reminders sent at T-30');
    const before3 = sms.sent.length;
    await dispatchDueSms(db, { now: new Date(r.startsAt.getTime() - 20 * 60_000) });
    eq(mine(before3), 0, 'nothing sent twice');
  });

  await check('sms: purchase triggers on final booking state, not on a pending request', async () => {
    const listing = await makeListing(MAYA, { startH: 2, endH: 4 });
    const sam = await as(SAM);
    const slots = (await sam.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const req = await sam.reservation.request({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[0]!.startsAt });
    eq((await smsRows(d.eq(schema.smsMessages.reservationId, req.id))).length, 0, 'no text for a pending request');
    await (await as(MAYA)).reservation.accept({ id: req.id });
    assert((await smsRows(d.eq(schema.smsMessages.reservationId, req.id))).length >= 2, 'texts once accepted');
  });

  await check('sms: booked < 30 min ahead → confirmation only, no duplicate reminder', async () => {
    const listing = await makeListing(MAYA, { startH: 0, endH: 2 });
    const sam = await as(SAM);
    const slots = (await sam.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const soonest = slots[0]!.startsAt;
    assert(soonest.getTime() - Date.now() <= 30 * 60_000, 'first slot is within 30 min');
    const r = await sam.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: soonest });
    const rows = await smsRows(d.eq(schema.smsMessages.reservationId, r.id));
    eq(rows.filter((x) => x.kind === 'meetup_reminder').length, 0, 'no reminder rows');
    assert(rows.some((x) => /\(in \d+ min\)/.test(x.body)), 'confirmation says how soon');
  });

  await check('sms: reschedule cancels old reminders and schedules new ones; cancel stops all', async () => {
    const listing = await makeListing(MAYA, { startH: 10, endH: 14 });
    const sam = await as(SAM);
    const maya = await as(MAYA);
    const slots = (await sam.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const r = await sam.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[0]!.startsAt });
    const newTime = slots[4]!.startsAt;
    await maya.reservation.counter({ id: r.id, spotId: SPOT_B, startsAt: newTime });
    let rows = await smsRows(d.eq(schema.smsMessages.reservationId, r.id));
    assert(rows.filter((x) => x.status === 'scheduled').length === 0, 'old texts cancelled while moving');
    await sam.reservation.accept({ id: r.id });
    rows = await smsRows(d.eq(schema.smsMessages.reservationId, r.id));
    const live = rows.filter((x) => x.status === 'scheduled' && x.kind === 'meetup_reminder');
    eq(live.length, 2, 'new reminders for both');
    assert(live.every((x) => x.meetupStartsAt!.getTime() === newTime.getTime()), 'for the new time');
    await sam.reservation.cancel({ id: r.id });
    rows = await smsRows(d.and(d.eq(schema.smsMessages.reservationId, r.id), d.eq(schema.smsMessages.status, 'scheduled')));
    eq(rows.length, 0, 'cancel clears every queued text');
    await dispatchDueSms(db, { now: new Date(newTime.getTime() - 29 * 60_000) });
    const sentReminders = await smsRows(
      d.and(d.eq(schema.smsMessages.reservationId, r.id), d.eq(schema.smsMessages.kind, 'meetup_reminder'), d.eq(schema.smsMessages.status, 'sent')),
    );
    eq(sentReminders.length, 0, 'no reminder for a cancelled booking');
  });

  await check('sms: a stale queued row is skipped, never sent', async () => {
    const listing = await makeListing(MAYA, { startH: 15, endH: 17 });
    const sam = await as(SAM);
    const slots = (await sam.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const r = await sam.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[0]!.startsAt });
    // Bypass the cancel hook to simulate a row that escaped cancellation.
    await db.update(schema.reservations).set({ status: 'cancelled' }).where(d.eq(schema.reservations.id, r.id));
    await dispatchDueSms(db, { now: new Date(r.startsAt.getTime() - 29 * 60_000) });
    const mine = await smsRows(d.eq(schema.smsMessages.reservationId, r.id));
    eq(mine.filter((x) => x.status === 'sent').length, 0, 'nothing sent for the cancelled booking');
    assert(mine.filter((x) => x.status === 'skipped').length >= 2, 'its queued texts were skipped');
  });

  await check('sms: failed delivery retries with backoff, then succeeds; permanent failure stops', async () => {
    const listing = await makeListing(MAYA);
    const [row] = await smsRows(d.eq(schema.smsMessages.listingId, listing.id));
    sms.failNext = 1000;
    const r1 = await dispatchDueSms(db);
    sms.failNext = 0;
    assert(r1.retried >= 1, 'retried');
    const [after] = await smsRows(d.eq(schema.smsMessages.id, row!.id));
    eq(after!.status, 'scheduled', 'back in the queue');
    eq(after!.attempts, 1, 'attempt counted');
    assert(after!.sendAfter.getTime() > Date.now(), 'backed off');
    const r2 = await dispatchDueSms(db, { now: new Date(Date.now() + 2 * 60_000) });
    assert(r2.sent >= 1, 'sent on retry');
    // Exhaust retries on another row.
    const l2 = await makeListing(MAYA);
    const [row2] = await smsRows(d.eq(schema.smsMessages.listingId, l2.id));
    sms.failNext = 99;
    for (let i = 0; i < 6; i++) await dispatchDueSms(db, { now: new Date(Date.now() + (i + 1) * 20 * 60_000) });
    sms.failNext = 0;
    const [dead] = await smsRows(d.eq(schema.smsMessages.id, row2!.id));
    eq(dead!.status, 'failed', 'gives up after 5 attempts');
    eq(dead!.attempts, 5, 'five attempts');
  });

  await check('sms: opted-out or unverified users get nothing; opting out cancels queued texts', async () => {
    const maya = await as(MAYA);
    const listing = await makeListing(MAYA, { startH: 18, endH: 20 });
    const sam = await as(SAM);
    const slots = (await sam.reservation.slots({ listingId: listing.id })).slots.filter((x) => x.available);
    const r = await sam.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slots[0]!.startsAt });
    await maya.user.updateSmsPreferences({ smsOptIn: false });
    const mayaRows = await smsRows(
      d.and(d.eq(schema.smsMessages.userId, MAYA), d.eq(schema.smsMessages.status, 'scheduled')),
    );
    eq(mayaRows.length, 0, 'queued texts cancelled on opt-out');
    const l2 = await makeListing(MAYA);
    eq((await smsRows(d.eq(schema.smsMessages.listingId, l2.id))).length, 0, 'no new rows while opted out');
    await maya.user.updateSmsPreferences({ smsOptIn: true });
    const samRows = await smsRows(d.and(d.eq(schema.smsMessages.reservationId, r.id), d.eq(schema.smsMessages.userId, SAM)));
    assert(samRows.length >= 1, "Sam's texts unaffected by Maya's choice");
    await expectCode('BAD_REQUEST', () =>
      appRouter.createCaller({ db, user: outsider! }).user.updateSmsPreferences({ smsOptIn: true }),
    );
  });

  await check('upvotes: repeat votes, removal, campus and authentication boundaries', async () => {
    const post = await (await as(MAYA)).community.create({ kind: 'selling', body: 'Vote regression item' });
    const voter = await as(JORDAN);
    await Promise.all([voter.community.setVote({ id: post.id, voted: true }), voter.community.setVote({ id: post.id, voted: true })]);
    const seen = await voter.community.byId({ id: post.id });
    eq(seen.voteCount, 1, 'concurrent repeats count once');
    eq(seen.viewerVoted, true, 'own vote is shown');
    eq((await voter.community.setVote({ id: post.id, voted: false })).voteCount, 0, 'remove vote');
    eq((await voter.community.setVote({ id: post.id, voted: false })).voteCount, 0, 'repeat removal');
    await expectCode('UNAUTHORIZED', () => anon.community.setVote({ id: post.id, voted: true }));
    await expectCode('NOT_FOUND', () => appRouter.createCaller({ db, user: outsider! }).community.setVote({ id: post.id, voted: true }));
    await (await as(MAYA)).community.remove({ id: post.id });
    await expectCode('NOT_FOUND', () => voter.community.setVote({ id: post.id, voted: true }));
  });

  await check('meetup email: both participants, retry, dedupe, and stale cancellation', async () => {
    const { dispatchBookingEmails, enqueueBookingEmails } = await import('../backend/email/bookings');
    // Only this test's messages are dispatched; the database is a temporary fixture.
    await db.delete(schema.bookingEmails);
    const listing = await makeListing(MAYA, { startH: 22, endH: 23 });
    const buyer = await as(JORDAN);
    const slot = (await buyer.reservation.slots({ listingId: listing.id })).slots.find((x) => x.available)!;
    const booking = await buyer.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slot.startsAt });
    const [row] = await db.select().from(schema.reservations).where(d.eq(schema.reservations.id, booking.id));
    await enqueueBookingEmails(db, row!);
    eq((await db.select().from(schema.bookingEmails)).length, 2, 'one queue row per participant');
    const before = mail.sent.length;
    mail.failNext = 1;
    await dispatchBookingEmails(db);
    eq(mail.sent.length - before, 1, 'other participant still receives email after one failure');
    await dispatchBookingEmails(db, new Date(Date.now() + 2 * 60_000));
    eq(mail.sent.length - before, 2, 'failed send retried');
    const messages = mail.sent.slice(before);
    assert(messages.every((m) => m.text.includes('America/Phoenix') && m.text.includes(`/reservation/${booking.id}`) && m.text.includes('Where:')), 'email includes time, place and link');
    eq(new Set(messages.map((m) => m.to)).size, 2, 'separate recipients');
    await dispatchBookingEmails(db);
    eq(mail.sent.length - before, 2, 'sent rows are not resent');
    await db.update(schema.bookingEmails).set({ status: 'scheduled' });
    await buyer.reservation.cancel({ id: booking.id });
    await dispatchBookingEmails(db, new Date(Date.now() + 3 * 60_000));
    eq(mail.sent.length - before, 2, 'cancelled booking emails skipped');
    assert((await db.select().from(schema.bookingEmails)).every((r) => r.status === 'skipped'), 'stale queue rows marked skipped');
  });

  await check('Twilio: signed STOP cancels queue; forged callback cannot change consent', async () => {
    const { createHmac } = await import('node:crypto');
    const { handleSmsOptOut, validTwilioSignature } = await import('../backend/sms/webhook');
    assert(validTwilioSignature('https://example.com/myapp.php?foo=1&bar=2', new URLSearchParams({ Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE' }), 'L/OH5YylLD5NRKLltdqwSvS0BnU=', '12345'), 'Twilio published signature fixture validates');
    process.env.TWILIO_AUTH_TOKEN = 'test-only-token';
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_INBOUND_WEBHOOK_URL = 'https://example.test/api/sms/inbound';
    const person = await userRow(MAYA);
    await db.update(schema.users).set({ smsOptIn: true }).where(d.eq(schema.users.id, MAYA));
    await makeListing(MAYA);
    const params = new URLSearchParams({ From: person.phone!, AccountSid: 'ACtest', Body: 'STOP', OptOutType: 'STOP' });
    eq(await handleSmsOptOut(db, params.toString(), 'forged'), 403, 'bad signature refused');
    eq((await userRow(MAYA)).smsOptIn, true, 'forgery does not change consent');
    const signature = createHmac('sha1', 'test-only-token').update(process.env.TWILIO_INBOUND_WEBHOOK_URL + [...params.keys()].sort().map((k) => k + params.get(k)).join('')).digest('base64');
    eq(await handleSmsOptOut(db, params.toString(), signature), 200, 'valid STOP accepted');
    eq((await userRow(MAYA)).smsOptIn, false, 'app consent removed');
    eq((await smsRows(d.and(d.eq(schema.smsMessages.userId, MAYA), d.eq(schema.smsMessages.status, 'scheduled')))).length, 0, 'queued texts cancelled');
    eq(await handleSmsOptOut(db, params.toString(), signature), 200, 'duplicate STOP harmless');
    eq(await handleSmsOptOut(db, params.toString().replace('STOP', 'START'), signature), 403, 'tampering refused');
  });

  await check('payments off: a booked, unpaid meetup is NOT cancelled after the old 24h pay deadline', async () => {
    eq(process.env.PAYMENTS_ENABLED, undefined, 'payments switch is off in this run');
    const listing = await makeListing(MAYA, { priceCents: 4000 });
    const jordan = await as(JORDAN);
    const slot = (await jordan.reservation.slots({ listingId: listing.id })).slots.find((s) => s.available)!;
    const booked = await jordan.reservation.book({ listingId: listing.id, spotId: SPOT_A, startsAt: slot.startsAt });
    eq(booked.status, 'accepted', 'booking needs no payment');
    // Worst case for the old rule: an auction-type row, 25h past its creation, no payment.
    await db
      .update(schema.reservations)
      .set({ createdAt: new Date(Date.now() - 25 * HOUR) })
      .where(d.eq(schema.reservations.id, booked.id));
    await db.update(schema.listings).set({ saleType: 'auction' }).where(d.eq(schema.listings.id, listing.id));
    const byRes = await jordan.payment.byReservation({ reservationId: booked.id });
    eq(byRes.timedOut, false, 'the meetup is not reported as timed out');
    await jordan.payment.mine();
    await applyExpiry(db);
    const [row] = await db.select().from(schema.reservations).where(d.eq(schema.reservations.id, booked.id));
    eq(row!.status, 'accepted', 'still booked after the old deadline');
    eq(row!.cancelReason, null, 'no cancel reason recorded');
    eq((await jordan.payment.config()).paymentsEnabled, false, 'config reports payments off');
    await expectCode('PRECONDITION_FAILED', () => jordan.payment.createIntent({ reservationId: booked.id }));
  });

  /* ------------------------------------------------------------ report */
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
