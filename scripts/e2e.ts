/**
 * End-to-end acceptance run for docs/BRIEF.md criteria 1–8.
 *
 *   npm run test:e2e
 *
 * By default this boots the real Hono server in-process on a random port with
 * PGLITE_DIR pointed at a throwaway temp directory, so it never touches dev
 * data. Set E2E_URL to run against an already-running backend instead.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import superjson from 'superjson';

import type { AppRouter } from '../backend/trpc/app-router';

/* ------------------------------------------------- isolated env (set first) */

const external = process.env.E2E_URL;
let tempRoot: string | null = null;

if (!external) {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-swap-e2e-'));
  process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
  process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
  process.env.PORT = '0';
}
process.env.DEV_LOGIN = '1';

/* ------------------------------------------------------------ test harness */

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];

async function criterion(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message} (got ${String(actual)}, want ${String(expected)})`);
}

/** Runs `fn`, expecting it to throw a tRPC error with `code`. */
async function expectTrpcError(code: string, fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof TRPCClientError) {
      const actual = (err.data as { code?: string } | null)?.code;
      assertEqual(actual, code, `expected ${code}`);
      return err.message;
    }
    throw err;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

/* ------------------------------------------------------------------ setup */

const MAYA_ID = '00000000-0000-4000-8000-000000000001';
const JORDAN_ID = '00000000-0000-4000-8000-000000000002';
const SAM_ID = '00000000-0000-4000-8000-000000000003';
const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SEEDED_MAYA_LISTING = '00000000-0000-4000-8000-000000000101';

function clientFor(url: string, token?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url,
        transformer: superjson,
        headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
      }),
    ],
  });
}

type Client = ReturnType<typeof clientFor>;

async function main(): Promise<number> {
  let stop: (() => void) | null = null;
  let url: string;

  if (external) {
    url = external;
    console.log(`running against ${url}`);
  } else {
    const { serve } = await import('@hono/node-server');
    const { runMigrations } = await import('../backend/db/migrate');
    const { seed } = await import('../backend/db/seed');
    const app = (await import('../backend/hono')).default;

    await runMigrations();
    await seed();

    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s as never));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    url = `http://127.0.0.1:${port}/api/trpc`;
    stop = () => server.close();
    console.log(`booted in-process backend on ${url} (data: ${tempRoot})`);
  }

  const guest = clientFor(url);

  const mayaAuth = await guest.auth.devSignIn.mutate({ userId: MAYA_ID });
  const jordanAuth = await guest.auth.devSignIn.mutate({ userId: JORDAN_ID });
  const samAuth = await guest.auth.devSignIn.mutate({ userId: SAM_ID });

  const maya: Client = clientFor(url, mayaAuth.token);
  const jordan: Client = clientFor(url, jordanAuth.token);
  const sam: Client = clientFor(url, samAuth.token);

  // Shared state threaded between criteria.
  let listingId = '';
  let spotAId = '';
  let spotBId = '';
  let slotA = new Date();
  let jordanReservationId = '';
  let conversationId = '';

  /* ------------------------------------------------------------------ 1 */

  await criterion('1. Public feed shows clearly marked sample listings', async () => {
    const feed = await guest.listing.feed.query({ campusId: CAMPUS_ID, limit: 50 });
    assert(feed.items.length >= 12, `expected 12+ demo listings, got ${feed.items.length}`);
    assert(
      feed.items.every((i) => i.seller.isDemo),
      'every seeded listing should belong to a demo user',
    );
    assert(
      feed.items.every((i) => (i.coverPhotoUrl ?? '').startsWith('/api/uploads/demo-')),
      'every seeded listing should have a demo photo',
    );
    assert(
      feed.items.some((i) => i.hasAvailabilityToday),
      'some seeded listings should have pickup availability today',
    );
  });

  /* ------------------------------------------------------------------ 2 */

  await criterion('2. Seller creates and edits a persisted listing', async () => {
    const spots = await guest.campus.spots.query({ campusId: CAMPUS_ID });
    assert(spots.length >= 2, 'campus should have demo spots');
    spotAId = spots[0]!.id;
    spotBId = spots[1]!.id;

    const windowStart = new Date(Date.now() + 15 * 60 * 1000);
    const windowEnd = new Date(Date.now() + 6 * 60 * 60 * 1000);
    slotA = new Date(Date.now() + 60 * 60 * 1000);

    const created = await maya.listing.create.mutate({
      title: 'Vintage wool overcoat',
      description: 'Heavy, warm, barely worn.',
      category: 'clothing',
      condition: 'like_new',
      priceCents: 7500,
      size: 'M',
      brand: 'Pendleton',
      isSellToday: false,
      photoUrls: ['/api/uploads/demo-jacket.svg', '/api/uploads/demo-bag.svg'],
      spotIds: [spotAId, spotBId],
      windows: [{ startsAt: windowStart, endsAt: windowEnd }],
    });
    listingId = created.id;

    assertEqual(created.photos.length, 2, 'created listing should keep both photos');
    assertEqual(created.spots.length, 2, 'created listing should keep both spots');
    assertEqual(created.availabilityWindows.length, 1, 'created listing should keep its window');

    await maya.listing.update.mutate({ id: listingId, priceCents: 6900, title: 'Wool overcoat' });

    const reread = await guest.listing.byId.query({ id: listingId });
    assertEqual(reread.priceCents, 6900, 'edit should persist the new price');
    assertEqual(reread.title, 'Wool overcoat', 'edit should persist the new title');
    assertEqual(reread.status, 'active', 'a new listing is active');
  });

  /* ------------------------------------------------------------------ 3 */

  await criterion('3. Buyer messages the seller and requests a spot and time', async () => {
    const convo = await jordan.conversation.open.mutate({ listingId });
    conversationId = convo.id;

    const sent = await jordan.conversation.send.mutate({
      conversationId,
      body: 'Hi! Is the overcoat still around?',
    });
    assertEqual(sent.body, 'Hi! Is the overcoat still around?', 'message should round-trip');

    const thread = await maya.conversation.messages.query({ conversationId });
    assertEqual(thread.items.length, 1, 'the seller should see the message');

    const reservation = await jordan.reservation.request.mutate({
      listingId,
      spotId: spotAId,
      startsAt: slotA,
    });
    jordanReservationId = reservation.id;
    assertEqual(reservation.status, 'requested', 'a new request starts as requested');
  });

  /* ---------------------------------------------------------------- 4, 5 */

  await criterion('4. Seller accepts; both sides see the same reservation', async () => {
    // Sam gets a request in BEFORE Maya accepts — this is the race case.
    const samEarly = await sam.reservation.request.mutate({
      listingId,
      spotId: spotBId,
      startsAt: slotA,
    });

    const pending = await maya.reservation.forListing.query({ listingId });
    assertEqual(pending.length, 2, 'the seller should see both requests');

    const accepted = await maya.reservation.accept.mutate({ id: jordanReservationId });
    assertEqual(accepted.status, 'accepted', 'accept should move the reservation to accepted');

    const asBuyer = await jordan.reservation.byId.query({ id: jordanReservationId });
    const asSeller = await maya.reservation.byId.query({ id: jordanReservationId });
    assertEqual(asBuyer.spot.id, asSeller.spot.id, 'both sides agree on the spot');
    assertEqual(
      asBuyer.startsAt.getTime(),
      asSeller.startsAt.getTime(),
      'both sides agree on the time',
    );
    assertEqual(asBuyer.priceCents, asSeller.priceCents, 'both sides agree on the price');
    assertEqual(asBuyer.priceCents, 6900, 'price snapshot matches the edited listing price');
    assert(asBuyer.handoffCode != null, 'the buyer can see the handoff code');
    assertEqual(asSeller.handoffCode, null, 'the seller cannot see the handoff code');

    const listing = await guest.listing.byId.query({ id: listingId });
    assertEqual(listing.status, 'reserved', 'the listing is now reserved');

    // Sam's earlier request was auto-declined the moment Maya accepted.
    const samView = await sam.reservation.byId.query({ id: samEarly.id });
    assertEqual(samView.status, 'declined', "Sam's earlier request is auto-declined");
    assertEqual(samView.cancelReason, 'item_reserved', 'auto-decline records the reason');
  });

  await criterion('5. A second buyer cannot reserve the same item', async () => {
    const message = await expectTrpcError('CONFLICT', () =>
      sam.reservation.request.mutate({ listingId, spotId: spotBId, startsAt: slotA }),
    );
    assertEqual(
      message,
      'This item was just reserved by someone else.',
      'the conflict message is the one the UI shows',
    );

    // Sam also cannot resurrect the auto-declined request by accepting it.
    const samReservations = await sam.reservation.mine.query({ role: 'buyer' });
    const declined = samReservations.find((r) => r.listingId === listingId);
    assert(declined != null, "Sam's declined reservation should still be listed");
    await expectTrpcError('CONFLICT', () => sam.reservation.accept.mutate({ id: declined!.id }));
  });

  /* ------------------------------------------------------------------ 6 */

  await criterion('6. Rescheduling and cancelling stay consistent for both users', async () => {
    const newTime = new Date(Date.now() + 3 * 60 * 60 * 1000);

    const countered = await jordan.reservation.counter.mutate({
      id: jordanReservationId,
      spotId: spotBId,
      startsAt: newTime,
      note: 'Could we do a bit later?',
    });
    assertEqual(countered.status, 'countered', 'a reschedule puts the reservation in countered');

    // The proposer cannot accept their own proposal.
    await expectTrpcError('FORBIDDEN', () =>
      jordan.reservation.accept.mutate({ id: jordanReservationId }),
    );

    const held = await guest.listing.byId.query({ id: listingId });
    assertEqual(held.status, 'reserved', 'the item stays off the market while rescheduling');

    const reaccepted = await maya.reservation.accept.mutate({ id: jordanReservationId });
    assertEqual(reaccepted.status, 'accepted', 'the seller can accept the new time');

    const asBuyer = await jordan.reservation.byId.query({ id: jordanReservationId });
    const asSeller = await maya.reservation.byId.query({ id: jordanReservationId });
    assertEqual(asBuyer.startsAt.getTime(), newTime.getTime(), 'the buyer sees the new time');
    assertEqual(asSeller.startsAt.getTime(), newTime.getTime(), 'the seller sees the new time');
    assertEqual(asSeller.spot.id, spotBId, 'both sides see the new spot');

    const cancelled = await jordan.reservation.cancel.mutate({
      id: jordanReservationId,
      reason: 'Something came up',
    });
    assertEqual(cancelled.status, 'cancelled', 'either party can cancel');

    const released = await guest.listing.byId.query({ id: listingId });
    assertEqual(released.status, 'active', 'cancelling puts the item back on the market');
    assertEqual(released.activeReservationId, null, 'no hold remains after cancelling');
  });

  /* ------------------------------------------------------------------ 7 */

  await criterion('7. Handoff confirmation sells the item, with no payment event', async () => {
    const fresh = await jordan.reservation.request.mutate({
      listingId,
      spotId: spotAId,
      startsAt: slotA,
    });
    await maya.reservation.accept.mutate({ id: fresh.id });

    const buyerView = await jordan.reservation.byId.query({ id: fresh.id });
    const code = buyerView.handoffCode;
    assert(code != null && /^\d{4}$/.test(code), 'the buyer gets a 4-digit handoff code');

    // A seller who guesses the code gets a human error, not a sale.
    await expectTrpcError('BAD_REQUEST', () =>
      maya.reservation.confirmHandoff.mutate({ id: fresh.id, code: code === '0000' ? '1111' : '0000' }),
    );

    const afterBuyer = await jordan.reservation.confirmHandoff.mutate({ id: fresh.id });
    assertEqual(afterBuyer.status, 'accepted', 'one confirmation is not enough');

    const afterSeller = await maya.reservation.confirmHandoff.mutate({ id: fresh.id, code: code! });
    assertEqual(afterSeller.status, 'completed', 'both confirmations complete the reservation');

    const sold = await guest.listing.byId.query({ id: listingId });
    assertEqual(sold.status, 'sold', 'the listing is sold');
    assert(sold.soldAt != null, 'soldAt is recorded');

    // The quote is arithmetic only, and it says so.
    const quote = await guest.payment.quote.query({ priceCents: sold.priceCents });
    assertEqual(quote.simulated, true, 'the quote is labelled simulated');
    assertEqual(quote.label, 'Simulated — no money moves', 'the label is the contract copy');

    // And there is genuinely no payment storage anywhere in the database.
    if (!external) {
      const { db } = await import('../backend/db/client');
      const { sql } = await import('drizzle-orm');
      const tables = await db.execute<{ table_name: string }>(
        sql`select table_name from information_schema.tables where table_schema = 'public'`,
      );
      const rows = (tables as unknown as { rows?: { table_name: string }[] }).rows ?? [];
      const payish = rows
        .map((r) => r.table_name)
        .filter((n) => /pay|charge|invoice|transaction|payout/i.test(n));
      assertEqual(payish.length, 0, `no payment-ish tables (found ${payish.join(', ')})`);
    }
  });

  /* ------------------------------------------------------------------ 8 */

  await criterion('8. Reporting, blocking and access controls hold', async () => {
    // Access control first, while everyone can still talk to everyone.
    await expectTrpcError('FORBIDDEN', () =>
      sam.conversation.messages.query({ conversationId }),
    );
    await expectTrpcError('UNAUTHORIZED', () =>
      guest.listing.create.mutate({
        title: 'Should never exist',
        category: 'other',
        condition: 'good',
        priceCents: 100,
        isSellToday: false,
        photoUrls: ['/api/uploads/demo-bag.svg'],
        spotIds: [spotAId],
        windows: [],
      }),
    );
    await expectTrpcError('FORBIDDEN', () =>
      jordan.listing.update.mutate({ id: SEEDED_MAYA_LISTING, priceCents: 1 }),
    );
    await expectTrpcError('FORBIDDEN', () =>
      sam.reservation.forListing.query({ listingId: SEEDED_MAYA_LISTING }),
    );

    // Public shapes never carry the private email field.
    const profile = await guest.user.byId.query({ id: MAYA_ID });
    assert(!('email' in profile), 'public profiles do not expose email');
    const feedBefore = await jordan.listing.feed.query({ campusId: CAMPUS_ID, limit: 50 });
    assert(
      feedBefore.items.every((i) => !('email' in i.seller)),
      'feed sellers do not expose email',
    );
    assert(
      feedBefore.items.some((i) => i.seller.id === MAYA_ID),
      "Maya's listings are visible before the block",
    );

    await jordan.user.report.mutate({
      targetListingId: SEEDED_MAYA_LISTING,
      targetUserId: MAYA_ID,
      reason: 'prohibited_item',
      details: 'Reported during the acceptance run.',
    });

    await jordan.user.block.mutate({ userId: MAYA_ID });

    const blocked = await jordan.user.blocked.query();
    assert(
      blocked.some((u) => u.id === MAYA_ID),
      'the blocked list contains Maya',
    );

    const feedAfter = await jordan.listing.feed.query({ campusId: CAMPUS_ID, limit: 50 });
    assert(
      feedAfter.items.every((i) => i.seller.id !== MAYA_ID),
      "Maya's listings vanish from Jordan's feed",
    );

    await expectTrpcError('FORBIDDEN', () =>
      maya.conversation.send.mutate({ conversationId, body: 'Are you there?' }),
    );
    await expectTrpcError('FORBIDDEN', () =>
      jordan.conversation.open.mutate({ listingId: SEEDED_MAYA_LISTING }),
    );
    await expectTrpcError('FORBIDDEN', () =>
      jordan.reservation.request.mutate({
        listingId: SEEDED_MAYA_LISTING,
        spotId: spotAId,
        startsAt: slotA,
      }),
    );
  });

  stop?.();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} criteria passed` +
      (failed.length > 0 ? ` — failing: ${failed.map((f) => f.name).join('; ')}` : ''),
  );
  return failed.length > 0 ? 1 : 0;
}

main()
  .then((code) => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    process.exit(1);
  });
