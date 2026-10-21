/**
 * End-to-end acceptance run for docs/BRIEF.md criteria 1–10.
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-e2e-'));
  process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
  process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
  process.env.PORT = '0';
}
process.env.DEV_LOGIN = '1';
// Self-contained regardless of what's in a local .env: Maya is the moderator.
process.env.MODERATOR_USER_IDS = '00000000-0000-4000-8000-000000000001';

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
  let blockTargetListingId = '';
  const PHOTOS = ['/api/uploads/demo-tech.svg'];

  // Meetups are 30-minute slots on :00/:30, in the future, within the next
  // 24h, and inside a seller window. These helpers build such times.
  const SLOT_MS = 30 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const alignedIn = (hours: number) =>
    new Date(Math.ceil((Date.now() + hours * HOUR_MS) / SLOT_MS) * SLOT_MS);
  /** One availability window comfortably covering alignedIn(1)..alignedIn(9). */
  const stdWindow = () => ({ startsAt: alignedIn(0.5), endsAt: alignedIn(10) });

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
    // `hasAvailabilityToday` is local-calendar-day based, so late in the
    // evening no demo window is left "today". Assert the flag is well-formed,
    // and that the demo listings are bookable via real open slots.
    assert(
      feed.items.every((i) => typeof i.hasAvailabilityToday === 'boolean'),
      'every feed card says whether it has availability today',
    );
    const slotProbe = await guest.reservation.slots.query({ listingId: feed.items[0]!.id });
    assertEqual(slotProbe.slotMinutes, 30, 'meetups are 30-minute slots');
    assert(
      slotProbe.slots.some((sl) => sl.available),
      'a seeded listing offers at least one open meetup slot in the next 24h',
    );

    // Free-text search (`q`): matches a seeded title, excludes non-matching
    // listings, returns empty for nonsense, and composes with other filters.
    // A distinctive word plucked from one seeded title is very unlikely to
    // appear (via title/brand/description) on every OTHER seeded listing, so
    // asserting some-match/not-all-match is a reliable, seed-agnostic check.
    const target = feed.items.find((i) => i.title.trim().includes(' ')) ?? feed.items[0]!;
    const needle = target.title.trim().split(/\s+/).sort((a, b) => b.length - a.length)[0]!;
    const searched = await guest.listing.feed.query({
      campusId: CAMPUS_ID,
      q: needle,
      limit: 50,
    });
    assert(
      searched.items.some((i) => i.id === target.id),
      `q="${needle}" should still return the listing titled "${target.title}"`,
    );
    assert(
      searched.items.length < feed.items.length,
      'q should narrow the feed down, not return everything',
    );

    const nonsense = await guest.listing.feed.query({
      campusId: CAMPUS_ID,
      q: 'zzzqqqxxx_no_such_listing_should_match_this_9999',
      limit: 50,
    });
    assertEqual(nonsense.items.length, 0, 'a nonsense q should return an empty page');
    assertEqual(nonsense.nextCursor, undefined, 'a nonsense q should have no next page');

    if (target.category) {
      const combined = await guest.listing.feed.query({
        campusId: CAMPUS_ID,
        q: needle,
        category: target.category,
        limit: 50,
      });
      assert(
        combined.items.some((i) => i.id === target.id),
        'q combined with a matching category filter should still find the listing',
      );
      assert(
        combined.items.every((i) => i.category === target.category),
        'q combined with a category filter should still respect the category filter',
      );

      const otherCategories = (
        ['clothing', 'shoes', 'jewelry', 'accessories', 'dorm', 'books', 'tech', 'other'] as const
      ).filter((c) => c !== target.category);
      const mismatched = await guest.listing.feed.query({
        campusId: CAMPUS_ID,
        q: needle,
        category: otherCategories[0],
        limit: 50,
      });
      assert(
        mismatched.items.every((i) => i.id !== target.id),
        'q combined with a non-matching category filter should exclude the listing',
      );
    }

    // Auctions are retired: every card is fixed-price at its asking price.
    assert(
      feed.items.every((i) => i.saleType === 'fixed'),
      'the seeded feed has no auction listings',
    );
    assert(
      feed.items.every((i) => i.currentPriceCents === i.priceCents && i.bidCount === 0),
      'a card prices at its asking price and carries no bids',
    );

    // q + keyset pagination: a small page size still finds a match beyond page 1.
    const commonWord = 'e'; // near-certain to hit multiple seeded titles/descriptions
    const pageOne = await guest.listing.feed.query({ campusId: CAMPUS_ID, q: commonWord, limit: 2 });
    if (pageOne.nextCursor) {
      const pageTwo = await guest.listing.feed.query({
        campusId: CAMPUS_ID,
        q: commonWord,
        limit: 2,
        cursor: pageOne.nextCursor,
      });
      const idsPageOne = new Set(pageOne.items.map((i) => i.id));
      assert(
        pageTwo.items.every((i) => !idsPageOne.has(i.id)),
        'q + cursor should return a distinct second page, not repeat page one',
      );
    }
  });

  /* ------------------------------------------------------------------ 2 */

  await criterion('2. Seller creates and edits a persisted listing', async () => {
    const spots = await guest.campus.spots.query({ campusId: CAMPUS_ID });
    assert(spots.length >= 2, 'campus should have demo spots');
    spotAId = spots[0]!.id;
    spotBId = spots[1]!.id;

    const { startsAt: windowStart, endsAt: windowEnd } = stdWindow();
    slotA = alignedIn(1);

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
    assertEqual(reread.saleType, 'fixed', 'a listing is fixed-price unless asked otherwise');
    assertEqual(reread.bidCount, 0, 'a fixed-price listing has no bids');
    assertEqual(
      reread.currentPriceCents,
      6900,
      'a fixed-price listing prices at its price, not a bid',
    );

    /* ------------------------------- auctions retired, windows required --- */

    const baseInput = {
      title: 'Espresso machine',
      description: 'Pulls a good shot.',
      category: 'tech' as const,
      condition: 'good' as const,
      priceCents: 3000,
      isSellToday: false,
      photoUrls: PHOTOS,
      spotIds: [spotAId],
      windows: [{ startsAt: windowStart, endsAt: windowEnd }],
    };

    // Creating an auction is refused, and the message points at offers.
    const auctionMsg = await expectTrpcError('BAD_REQUEST', () =>
      maya.listing.create.mutate({ ...baseInput, saleType: 'auction', startPriceCents: 2000 }),
    );
    assert(/offers/i.test(auctionMsg), `the refusal should mention offers: ${auctionMsg}`);

    // A listing needs at least one window inside the next 24h.
    await expectTrpcError('BAD_REQUEST', () =>
      maya.listing.create.mutate({ ...baseInput, windows: [] }),
    );
    await expectTrpcError('BAD_REQUEST', () =>
      maya.listing.create.mutate({
        ...baseInput,
        windows: [{ startsAt: alignedIn(30), endsAt: alignedIn(33) }],
      }),
    );

    // Stale clients that still bid get a clear PRECONDITION_FAILED.
    await expectTrpcError('PRECONDITION_FAILED', () =>
      jordan.bid.place.mutate({ listingId, amountCents: 8000 }),
    );
    await expectTrpcError('PRECONDITION_FAILED', () => jordan.bid.buyout.mutate({ listingId }));

    // A second plain listing, used later to exercise block rules on offers.
    const target = await maya.listing.create.mutate(baseInput);
    blockTargetListingId = target.id;
    assertEqual(target.saleType, 'fixed', 'a new listing is fixed-price');
    assertEqual(target.priceCents, 3000, 'the asking price persists');
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

    // --- read state: Jordan's message leaves Maya with one unread thread. ---
    const mayaListUnread = await maya.conversation.list.query();
    const mayaUnreadEntry = mayaListUnread.find((c) => c.id === conversationId);
    assertEqual(mayaUnreadEntry?.unreadCount, 1, "Maya's list shows the unread message");
    const mayaTotalUnread = await maya.conversation.unreadTotal.query();
    assertEqual(mayaTotalUnread.conversations, 1, "Maya's unreadTotal counts the thread");

    // Marking read drops both to zero.
    const markResult = await maya.conversation.markRead.mutate({ conversationId });
    assertEqual(markResult.ok, true, 'markRead reports ok');
    const mayaListRead = await maya.conversation.list.query();
    assertEqual(
      mayaListRead.find((c) => c.id === conversationId)?.unreadCount,
      0,
      'unreadCount drops to 0 after markRead',
    );
    const mayaTotalRead = await maya.conversation.unreadTotal.query();
    assertEqual(mayaTotalRead.conversations, 0, 'unreadTotal.conversations drops to 0 after markRead');

    // A non-participant cannot mark this thread read.
    await expectTrpcError('FORBIDDEN', () => sam.conversation.markRead.mutate({ conversationId }));

    // The seller can also open (or resume) the same thread by naming the buyer.
    const sellerOpened = await maya.conversation.open.mutate({ listingId, buyerId: JORDAN_ID });
    assertEqual(sellerOpened.id, conversationId, 'seller-opened conversation is the same thread');

    const sellerSent = await maya.conversation.send.mutate({
      conversationId: sellerOpened.id,
      body: 'Yep, still available!',
    });
    assertEqual(sellerSent.body, 'Yep, still available!', 'seller message should round-trip');

    const threadAfterSellerReply = await jordan.conversation.messages.query({
      conversationId: sellerOpened.id,
    });
    assert(
      threadAfterSellerReply.items.some((m) => m.body === 'Yep, still available!'),
      'the buyer should see the seller-initiated message',
    );

    // Jordan sends again — Maya's unread count goes back to 1.
    await jordan.conversation.send.mutate({
      conversationId,
      body: 'Great, want to meet up?',
    });
    const mayaListAgain = await maya.conversation.list.query();
    assertEqual(
      mayaListAgain.find((c) => c.id === conversationId)?.unreadCount,
      1,
      "Maya's unread count returns to 1 after Jordan sends again",
    );
    const mayaTotalAgain = await maya.conversation.unreadTotal.query();
    assertEqual(mayaTotalAgain.conversations, 1, "Maya's unreadTotal returns to 1");

    // --- actionableReservations: exercised on a throwaway listing (not
    // `listingId`) so it doesn't add extra rows to reservation.forListing,
    // which criterion 4 asserts an exact count against. ---
    const probeListing = await maya.listing.create.mutate({
      title: 'Actionable-count probe item',
      category: 'other',
      condition: 'good',
      priceCents: 100,
      isSellToday: false,
      photoUrls: ['/api/uploads/demo-bag.svg'],
      spotIds: [spotAId],
      windows: [stdWindow()],
    });
    const probeSlot = alignedIn(2);

    const probe = await jordan.reservation.request.mutate({
      listingId: probeListing.id,
      spotId: spotAId,
      startsAt: probeSlot,
    });
    const mayaActionableAfterRequest = await maya.conversation.unreadTotal.query();
    assertEqual(
      mayaActionableAfterRequest.actionableReservations,
      1,
      "the seller's actionableReservations is 1 once a request lands (ball in her court)",
    );
    const jordanActionableAfterRequest = await jordan.conversation.unreadTotal.query();
    assertEqual(
      jordanActionableAfterRequest.actionableReservations,
      0,
      "the requester's actionableReservations is 0 (they made the last move)",
    );

    await maya.reservation.counter.mutate({
      id: probe.id,
      spotId: spotAId,
      startsAt: probeSlot,
      note: 'probe counter',
    });
    const jordanActionableAfterCounter = await jordan.conversation.unreadTotal.query();
    assertEqual(
      jordanActionableAfterCounter.actionableReservations,
      1,
      'after the seller counters, the ball is back in the buyer\'s court',
    );
    const mayaActionableAfterCounter = await maya.conversation.unreadTotal.query();
    assertEqual(
      mayaActionableAfterCounter.actionableReservations,
      0,
      "the seller's actionableReservations drops to 0 after countering",
    );

    await jordan.reservation.cancel.mutate({ id: probe.id, reason: 'probe cleanup' });

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
    assertEqual(asBuyer.spot?.id, asSeller.spot?.id, 'both sides agree on the spot');
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

    // The item stays off the market for a late request too, whatever the time.
    await expectTrpcError('CONFLICT', () =>
      sam.reservation.book.mutate({ listingId, spotId: spotBId, startsAt: alignedIn(4) }),
    );
  });

  /* ------------------------------------------------------------------ 6 */

  await criterion('6. Rescheduling and cancelling stay consistent for both users', async () => {
    const newTime = alignedIn(3);

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
    assertEqual(asSeller.spot?.id, spotBId, 'both sides see the new spot');

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

      if (payish.includes('payments')) {
        // Stripe support (docs/AUCTIONS.md §3) is landing behind PAYMENTS_MODE.
        // The criterion is unchanged in substance: completing a handoff must
        // not, by itself, move or record money for this reservation.
        const paid = await db.execute<{ n: string }>(
          sql`select count(*)::text as n from payments where reservation_id = ${fresh.id}`,
        );
        const paidRows = (paid as unknown as { rows?: { n: string }[] }).rows ?? [];
        assertEqual(Number(paidRows[0]?.n ?? 0), 0, 'completing a handoff records no payment');
      } else {
        assertEqual(payish.length, 0, `no payment-ish tables (found ${payish.join(', ')})`);
      }
    }

    /* ----------------------------------------- expiry and relist (fixed) --- */

    if (!external) {
      const { db } = await import('../backend/db/client');
      const { eq } = await import('drizzle-orm');
      const { listings: listingsTable, reservations: reservationsTable } =
        await import('../backend/db/schema');
      const { applyExpiry } = await import('../backend/trpc/lib');

      // Auction settlement (bids, buyout, anti-snipe) is retired; a legacy
      // auction row settling is covered by scripts/workstreams-check.ts.
      const sellToday = await maya.listing.create.mutate({
        title: 'Fixed price, selling today',
        category: 'other',
        condition: 'good',
        priceCents: 1500,
        isSellToday: true,
        photoUrls: PHOTOS,
        spotIds: [spotAId],
        windows: [stdWindow()],
      });
      await db
        .update(listingsTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(listingsTable.id, sellToday.id));
      await applyExpiry(db);
      await applyExpiry(db); // idempotent
      const expiredFixed = await guest.listing.byId.query({ id: sellToday.id });
      assertEqual(expiredFixed.status, 'expired', 'a fixed-price listing just expires');
      const fixedRes = await db
        .select()
        .from(reservationsTable)
        .where(eq(reservationsTable.listingId, sellToday.id));
      assertEqual(fixedRes.length, 0, 'fixed-price expiry never creates a reservation');

      // Relisting restarts the 24h clock; windows are chosen again.
      const relisted = await maya.listing.relist.mutate({
        id: sellToday.id,
        isSellToday: false,
        windows: [stdWindow()],
      });
      assertEqual(relisted.status, 'active', 'a relisted listing is active again');
      assertEqual(relisted.saleType, 'fixed', 'a relisted listing stays fixed-price');
      const relistHours = (relisted.expiresAt!.getTime() - Date.now()) / HOUR_MS;
      assert(relistHours > 23.5 && relistHours <= 24.1, 'relisting restarts the 24h clock');
    }
  });

  /* ------------------------------------------------- 8 (offers + booking) */

  await criterion('8. Offers and instant booking replace bidding', async () => {
    const listing = await maya.listing.create.mutate({
      title: 'Desk lamp (offers test)',
      category: 'dorm',
      condition: 'good',
      priceCents: 5000,
      isSellToday: false,
      photoUrls: PHOTOS,
      spotIds: [spotAId, spotBId],
      windows: [stdWindow()],
    });

    // Offer rules: below asking, at least $1, not on your own listing.
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.offer.create.mutate({ listingId: listing.id, amountCents: 5000 }),
    );
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.offer.create.mutate({ listingId: listing.id, amountCents: 50 }),
    );
    await expectTrpcError('BAD_REQUEST', () =>
      maya.offer.create.mutate({ listingId: listing.id, amountCents: 3000 }),
    );

    // Decline path: the buyer can then offer again.
    const first = await jordan.offer.create.mutate({
      listingId: listing.id,
      amountCents: 3500,
      message: 'Would you take $35?',
    });
    assertEqual(first.status, 'pending', 'a new offer is pending');
    await expectTrpcError('CONFLICT', () =>
      jordan.offer.create.mutate({ listingId: listing.id, amountCents: 3600 }),
    );
    await expectTrpcError('FORBIDDEN', () => jordan.offer.accept.mutate({ id: first.id }));
    const declined = await maya.offer.decline.mutate({ id: first.id, reason: 'Too low' });
    assertEqual(declined.status, 'declined', 'the seller can decline');

    // Accept path: the item is held for that buyer at the offered price.
    const second = await jordan.offer.create.mutate({ listingId: listing.id, amountCents: 4200 });
    const sellerView = await maya.offer.forListing.query({ listingId: listing.id });
    assert(
      sellerView.offers.some((o) => o.id === second.id),
      'the seller sees the pending offer',
    );
    const acceptedOffer = await maya.offer.accept.mutate({ id: second.id });
    assertEqual(acceptedOffer.status, 'accepted', 'the seller can accept');
    assert(acceptedOffer.holdExpiresAt != null, 'an accepted offer carries a hold deadline');

    // Nobody else can book while it is held; the buyer books at the offer.
    const bookTime = alignedIn(2);
    await expectTrpcError('CONFLICT', () =>
      sam.reservation.book.mutate({ listingId: listing.id, spotId: spotAId, startsAt: bookTime }),
    );
    const booked = await jordan.reservation.book.mutate({
      listingId: listing.id,
      spotId: spotAId,
      startsAt: bookTime,
      offerId: second.id,
      expectedPriceCents: 4200,
    });
    assertEqual(booked.status, 'accepted', 'booking confirms the meetup instantly');
    assertEqual(booked.priceCents, 4200, 'the meetup is priced at the accepted offer');
    assertEqual(booked.buyerId, JORDAN_ID, 'the reservation belongs to the offering buyer');
    const heldListing = await guest.listing.byId.query({ id: listing.id });
    assertEqual(heldListing.status, 'reserved', 'booking reserves the listing');

    // Re-submitting the same booking is idempotent.
    const again = await jordan.reservation.book.mutate({
      listingId: listing.id,
      spotId: spotAId,
      startsAt: bookTime,
      offerId: second.id,
      expectedPriceCents: 4200,
    });
    assertEqual(again.id, booked.id, 'a repeated book returns the same reservation');

    // Conflict-safe slots: the same seller slot cannot be double booked, even
    // on a different listing, and neither can the same buyer's slot.
    const other = await maya.listing.create.mutate({
      title: 'Second item (slot clash test)',
      category: 'other',
      condition: 'good',
      priceCents: 1000,
      isSellToday: false,
      photoUrls: PHOTOS,
      spotIds: [spotAId],
      windows: [stdWindow()],
    });
    const clashMsg = await expectTrpcError('CONFLICT', () =>
      sam.reservation.book.mutate({ listingId: other.id, spotId: spotAId, startsAt: bookTime }),
    );
    assert(/booked|pick another/i.test(clashMsg), `slot clash message: ${clashMsg}`);
    const slotList = await guest.reservation.slots.query({ listingId: other.id });
    const clashSlot = slotList.slots.find((sl) => sl.startsAt.getTime() === bookTime.getTime());
    assertEqual(clashSlot?.available, false, 'the booked slot shows as unavailable');
    assertEqual(clashSlot?.reason, 'seller_busy', 'the reason is that the seller is busy');

    // Off-grid, past, out-of-window and beyond-24h times are refused.
    const freeTime = alignedIn(4);
    await expectTrpcError('BAD_REQUEST', () =>
      sam.reservation.book.mutate({
        listingId: other.id,
        spotId: spotAId,
        startsAt: new Date(freeTime.getTime() + 5 * 60 * 1000),
      }),
    );
    await expectTrpcError('BAD_REQUEST', () =>
      sam.reservation.book.mutate({
        listingId: other.id,
        spotId: spotAId,
        startsAt: new Date(alignedIn(0).getTime() - SLOT_MS),
      }),
    );
    await expectTrpcError('BAD_REQUEST', () =>
      sam.reservation.book.mutate({ listingId: other.id, spotId: spotAId, startsAt: alignedIn(30) }),
    );
    // A price the buyer did not see is refused instead of silently charged.
    await expectTrpcError('CONFLICT', () =>
      sam.reservation.book.mutate({
        listingId: other.id,
        spotId: spotAId,
        startsAt: freeTime,
        expectedPriceCents: 999,
      }),
    );
    const direct = await sam.reservation.book.mutate({
      listingId: other.id,
      spotId: spotAId,
      startsAt: freeTime,
      expectedPriceCents: 1000,
    });
    assertEqual(direct.status, 'accepted', 'booking at the asking price confirms instantly');
    assertEqual(direct.priceCents, 1000, 'the price is the asking price');
    const history = await sam.reservation.history.query({ id: direct.id });
    assert(
      history.some((h) => h.kind === 'booked'),
      'the reservation history records the booking',
    );
  });

  /* ------------------------------------------------------------------ 9 */

  await criterion('11. An offer carries a meetup the seller offered, and accepting books it', async () => {
    const listing = await maya.listing.create.mutate({
      title: 'Bookshelf (offer proposal test)',
      category: 'dorm',
      condition: 'good',
      priceCents: 8000,
      isSellToday: false,
      photoUrls: PHOTOS,
      spotIds: [spotAId],
      windows: [stdWindow()],
    });
    // A slot no earlier criterion has booked for Maya or Jordan, so accepting
    // can really book it rather than falling back to a hold.
    const goodTime = alignedIn(6);

    // A spot the seller did not choose is refused.
    const badSpot = await expectTrpcError('BAD_REQUEST', () =>
      jordan.offer.create.mutate({
        listingId: listing.id,
        amountCents: 6000,
        proposedStartsAt: goodTime,
        proposedSpotId: spotBId,
      }),
    );
    assert(/spot/i.test(badSpot), `the spot refusal should say so: ${badSpot}`);
    // A time outside every window is refused (window ends ~10h out).
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.offer.create.mutate({
        listingId: listing.id,
        amountCents: 6000,
        proposedStartsAt: alignedIn(16),
        proposedSpotId: spotAId,
      }),
    );
    // A time in the past is refused.
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.offer.create.mutate({
        listingId: listing.id,
        amountCents: 6000,
        proposedStartsAt: new Date(Math.floor((Date.now() - 2 * HOUR_MS) / SLOT_MS) * SLOT_MS),
        proposedSpotId: spotAId,
      }),
    );
    // A time off the 30-minute grid is refused.
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.offer.create.mutate({
        listingId: listing.id,
        amountCents: 6000,
        proposedStartsAt: new Date(goodTime.getTime() + 7 * 60_000),
        proposedSpotId: spotAId,
      }),
    );
    // Time without a spot (or the reverse) is refused.
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.offer.create.mutate({ listingId: listing.id, amountCents: 6000, proposedStartsAt: goodTime }),
    );

    // None of the refusals left an open offer behind; a valid proposal works.
    const ok = await jordan.offer.create.mutate({
      listingId: listing.id,
      amountCents: 6000,
      message: 'Can carry it myself',
      proposedStartsAt: goodTime,
      proposedSpotId: spotAId,
    });
    assertEqual(ok.status, 'pending', 'a valid proposal creates a pending offer');

    // The proposal is structured data, not a sentence glued onto the note.
    assertEqual(ok.message, 'Can carry it myself', "the buyer's note is kept verbatim");
    assert(!/Proposed meetup:/.test(ok.message ?? ''), 'the note is not rewritten with the proposal');
    assertEqual(
      ok.proposedStartsAt?.getTime(),
      goodTime.getTime(),
      'the proposed time is stored on the offer',
    );
    assertEqual(ok.proposedSpotId, spotAId, 'the proposed spot is stored on the offer');

    // It round-trips as structured data through the seller's read, spot and all.
    const sellerSees = await maya.offer.forListing.query({ listingId: listing.id });
    const pending = sellerSees.offers.find((o) => o.id === ok.id)!;
    assertEqual(
      pending.proposedStartsAt?.getTime(),
      goodTime.getTime(),
      'the seller reads the proposed time as a date',
    );
    assertEqual(pending.proposedSpot?.id, spotAId, 'the seller reads the proposed spot');
    assert(!!pending.proposedSpot?.name, 'the proposed spot carries its name for the UI');

    // Accepting books that exact time and spot — nobody re-enters anything.
    const accepted = await maya.offer.accept.mutate({ id: ok.id });
    assertEqual(accepted.status, 'booked', 'accepting a proposal books it outright');
    assert(accepted.reservation != null, 'acceptance produces a reservation');
    const res = accepted.reservation!;
    assertEqual(res.startsAt.getTime(), goodTime.getTime(), 'the meetup is at the proposed time');
    assertEqual(res.spotId, spotAId, 'the meetup is at the proposed spot');
    assertEqual(res.customAddress, null, 'a spot booking carries no custom address');
    assertEqual(res.priceCents, 6000, 'the meetup is priced at the accepted offer');
    assertEqual(res.buyerId, JORDAN_ID, 'the reservation belongs to the offering buyer');
    assertEqual(res.status, 'accepted', 'the reservation is confirmed, not pending');
    assertEqual(accepted.reservationId, res.id, 'the offer points at the booking it produced');

    // And the buyer sees the confirmed meetup, with no booking step left.
    const buyerView = await jordan.reservation.byId.query({ id: res.id });
    assertEqual(buyerView.startsAt.getTime(), goodTime.getTime(), 'the buyer sees the proposed time');
    assertEqual(buyerView.spot?.id, spotAId, 'the buyer sees the proposed spot');
    const reserved = await guest.listing.byId.query({ id: listing.id });
    assertEqual(reserved.status, 'reserved', 'accepting the proposal reserves the item');
    const history = await jordan.reservation.history.query({ id: res.id });
    assert(
      history.some((h) => h.kind === 'booked'),
      'the reservation history records the booking',
    );

    // An offer with no proposal still just agrees the price and holds the item.
    const plain = await maya.listing.create.mutate({
      title: 'Desk lamp (no proposal)',
      category: 'dorm',
      condition: 'good',
      priceCents: 4000,
      isSellToday: false,
      photoUrls: PHOTOS,
      spotIds: [spotAId],
      windows: [stdWindow()],
    });
    const bare = await jordan.offer.create.mutate({ listingId: plain.id, amountCents: 3000 });
    assertEqual(bare.proposedStartsAt, null, 'an offer without a proposal stores no time');
    const heldOnly = await maya.offer.accept.mutate({ id: bare.id });
    assertEqual(heldOnly.status, 'accepted', 'without a proposal the offer is only accepted');
    assertEqual(heldOnly.reservation, null, 'without a proposal nothing is booked yet');
    assert(heldOnly.holdExpiresAt != null, 'the buyer gets the hold to pick a time');
  });

  await criterion('9. Reporting, blocking and access controls hold', async () => {
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
        windows: [stdWindow()],
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
    // Maya (the seller) cannot open a conversation with a buyer who blocked her, either.
    await expectTrpcError('FORBIDDEN', () =>
      maya.conversation.open.mutate({ listingId, buyerId: JORDAN_ID }),
    );
    await expectTrpcError('FORBIDDEN', () =>
      jordan.reservation.request.mutate({
        listingId: SEEDED_MAYA_LISTING,
        spotId: spotAId,
        startsAt: slotA,
      }),
    );

    // A blocked user cannot make an offer on, or book, the other party's listing.
    const blockedMsg = await expectTrpcError('FORBIDDEN', () =>
      jordan.offer.create.mutate({ listingId: blockTargetListingId, amountCents: 2000 }),
    );
    assertEqual(blockedMsg, 'You cannot make an offer to this person.', 'the block message is human');
    await expectTrpcError('FORBIDDEN', () =>
      jordan.reservation.book.mutate({
        listingId: blockTargetListingId,
        spotId: spotAId,
        startsAt: alignedIn(5),
      }),
    );
    // Sam, who is not in a block relationship, still can.
    await sam.offer.create.mutate({ listingId: blockTargetListingId, amountCents: 2000 });

    // Basic moderation access: the report Jordan just filed is visible to a
    // moderator (Maya, via MODERATOR_USER_IDS), invisible to a non-moderator,
    // and acting on it removes the listing from the public feed.
    const mayaIsModerator = await maya.moderation.isModerator.query();
    assert(mayaIsModerator === true, 'Maya is configured as the demo moderator');

    const samIsModerator = await sam.moderation.isModerator.query();
    assert(samIsModerator === false, 'Sam is not a moderator');

    const openReports = await maya.moderation.reports.query({ status: 'open' });
    const filedReport = openReports.find((r) => r.targetListingId === SEEDED_MAYA_LISTING);
    assert(filedReport != null, "the moderator sees Jordan's open report on Maya's listing");
    assertEqual(filedReport!.reporter.id, JORDAN_ID, 'the report shows who filed it');
    assertEqual(filedReport!.targetUser?.id, MAYA_ID, 'the report shows the targeted user');
    assertEqual(
      filedReport!.targetListing?.id,
      SEEDED_MAYA_LISTING,
      'the report shows the targeted listing',
    );

    await expectTrpcError('FORBIDDEN', () => sam.moderation.reports.query({ status: 'open' }));

    const reviewed = await maya.moderation.reviewReport.mutate({
      id: filedReport!.id,
      action: 'remove_listing',
      note: 'Removed during the acceptance run.',
    });
    assertEqual(reviewed.status, 'reviewed', 'reviewing a report marks it reviewed');
    assertEqual(reviewed.reviewedById, MAYA_ID, 'the review records the moderator');

    const removedListing = await guest.listing.byId.query({ id: SEEDED_MAYA_LISTING });
    assertEqual(removedListing.status, 'removed', 'remove_listing removes the listing');

    const feedAfterModeration = await guest.listing.feed.query({ campusId: CAMPUS_ID, limit: 50 });
    assert(
      feedAfterModeration.items.every((i) => i.id !== SEEDED_MAYA_LISTING),
      'the removed listing vanishes from the public feed',
    );

    // Account closure (user.deleteAccount). Needs the real email code, which
    // is only ever printed to the server console — so, like the payment-table
    // introspection above, this piece reads the in-process DB directly and
    // only runs for the in-process harness (not E2E_URL).
    if (!external) {
      const { db } = await import('../backend/db/client');
      const schema = await import('../backend/db/schema');
      const { eq: eqOp } = await import('drizzle-orm');

      const throwawayEmail = 'throwaway-e2e@demo.campus.test';
      await guest.auth.requestCode.mutate({ email: throwawayEmail });
      const [codeRow] = await db
        .select()
        .from(schema.emailCodes)
        .where(eqOp(schema.emailCodes.email, throwawayEmail))
        .limit(1);
      assert(codeRow != null, 'requestCode should insert a code row for the throwaway user');

      const verified = await guest.auth.verifyCode.mutate({
        email: throwawayEmail,
        code: codeRow!.code,
        displayName: 'Throwaway E2E',
      });
      const throwaway: Client = clientFor(url, verified.token);
      const throwawayId = verified.user.id;

      const closureWindow = stdWindow();
      // Distinct aligned times: an accepted meetup blocks the same slot for
      // both people, so each closure scenario gets its own.
      const closureTime1 = alignedIn(1);
      const closureTime2 = alignedIn(2);
      const closureTime3 = alignedIn(3);

      const makeThrowawayListing = (title: string) =>
        throwaway.listing.create.mutate({
          title,
          category: 'other',
          condition: 'good',
          priceCents: 500,
          isSellToday: false,
          photoUrls: ['/api/uploads/demo-bag.svg'],
          spotIds: [spotAId],
          windows: [closureWindow],
        });

      // Listing 1 → an accepted-then-cancelled reservation (used to exercise
      // the CONFLICT guard, then cleared so the account can actually close).
      const listing1 = await makeThrowawayListing('Closure test item 1 (accepted then cancelled)');
      const res1 = await jordan.reservation.request.mutate({
        listingId: listing1.id,
        spotId: spotAId,
        startsAt: closureTime1,
      });

      // Listing 2 → left `requested` (pending) at closure time.
      const listing2 = await makeThrowawayListing('Closure test item 2 (stays pending)');
      const res2 = await jordan.reservation.request.mutate({
        listingId: listing2.id,
        spotId: spotAId,
        startsAt: closureTime2,
      });
      assertEqual(res2.status, 'requested', 'reservation 2 starts out pending');

      // Listing 3 → carried all the way to `completed` before closure.
      const listing3 = await makeThrowawayListing('Closure test item 3 (already completed)');
      const res3 = await jordan.reservation.request.mutate({
        listingId: listing3.id,
        spotId: spotAId,
        startsAt: closureTime3,
      });
      await throwaway.reservation.accept.mutate({ id: res3.id });
      const res3Buyer = await jordan.reservation.byId.query({ id: res3.id });
      await jordan.reservation.confirmHandoff.mutate({ id: res3.id });
      const res3Final = await throwaway.reservation.confirmHandoff.mutate({
        id: res3.id,
        code: res3Buyer.handoffCode!,
      });
      assertEqual(res3Final.status, 'completed', 'reservation 3 is completed before closure');

      // (a) an open `accepted` reservation blocks account closure with CONFLICT.
      const accepted1 = await throwaway.reservation.accept.mutate({ id: res1.id });
      assertEqual(accepted1.status, 'accepted', 'reservation 1 is accepted');
      const conflictMessage = await expectTrpcError('CONFLICT', () =>
        throwaway.user.deleteAccount.mutate({ confirmText: 'DELETE' }),
      );
      assertEqual(
        conflictMessage,
        'Finish or cancel your open meetups before closing your account.',
        'the CONFLICT message is the one the UI shows',
      );

      // (b) once nothing is `accepted`, deleteAccount succeeds.
      await throwaway.reservation.cancel.mutate({ id: res1.id, reason: 'clearing for closure test' });
      const closeResult = await throwaway.user.deleteAccount.mutate({ confirmText: 'DELETE' });
      assertEqual(closeResult.ok, true, 'deleteAccount succeeds once no accepted reservation remains');

      // (c) the now-closed account's session is rejected.
      await expectTrpcError('UNAUTHORIZED', () => throwaway.auth.me.query());

      // (d) their listing (active at closure time) is removed and gone from the feed.
      const closedListing1 = await guest.listing.byId.query({ id: listing1.id });
      assertEqual(closedListing1.status, 'removed', "the closed seller's listing is removed");
      const feedAfterClosure = await guest.listing.feed.query({ campusId: CAMPUS_ID, limit: 50 });
      assert(
        feedAfterClosure.items.every((i) => i.id !== listing1.id),
        "the closed seller's listing is gone from the public feed",
      );

      // (e) user.byId still resolves — to the anonymized "Deleted user" profile.
      const closedProfile = await guest.user.byId.query({ id: throwawayId });
      assertEqual(closedProfile.displayName, 'Deleted user', 'the profile shows "Deleted user"');
      assertEqual(closedProfile.activeListingCount, 0, 'the closed profile has no active listings');

      // (f) their pending reservation is cancelled with reason 'account_closed'.
      const closedRes2 = await jordan.reservation.byId.query({ id: res2.id });
      assertEqual(closedRes2.status, 'cancelled', 'the pending reservation is cancelled on closure');
      assertEqual(
        closedRes2.cancelReason,
        'account_closed',
        'the cancellation reason records the account closure',
      );

      // (g) a previously completed reservation (and its sale) is untouched.
      const closedRes3 = await jordan.reservation.byId.query({ id: res3.id });
      assertEqual(closedRes3.status, 'completed', 'a completed reservation is never touched');
      const closedListing3 = await guest.listing.byId.query({ id: listing3.id });
      assertEqual(closedListing3.status, 'sold', "the completed sale's listing stays 'sold'");
    }
  });

  /* ----------------------------------------------------------------- 10 */

  await criterion('10. Every new listing expires 24h after creation', async () => {
    if (!external) {
      const { db } = await import('../backend/db/client');
      const { eq: eqOp, lt: ltOp } = await import('drizzle-orm');
      const { listings: listingsTable } = await import('../backend/db/schema');
      const { applyExpiry } = await import('../backend/trpc/lib');

      // (a) A plain fixed-price listing (not isSellToday, not an auction) must
      //     be created with a non-null expiresAt roughly 24h out.
      const plain = await maya.listing.create.mutate({
        title: 'Lifetime test: plain fixed price',
        category: 'other',
        condition: 'good',
        priceCents: 1000,
        isSellToday: false,
        photoUrls: ['/api/uploads/demo-tech.svg'],
        spotIds: [spotAId],
        windows: [stdWindow()],
      });

      assert(plain.expiresAt != null, 'a plain fixed-price listing must have a non-null expiresAt');
      const hoursOut = (plain.expiresAt!.getTime() - Date.now()) / (60 * 60 * 1000);
      assert(
        hoursOut > 23.5 && hoursOut <= 24.1,
        `plain fixed-price listing should expire ~24h out, got ${hoursOut}h`,
      );

      // (b) Editing the listing must NOT reset its expiry clock.
      const beforeEdit = plain.expiresAt!.getTime();
      await maya.listing.update.mutate({ id: plain.id, priceCents: 999 });
      const afterEdit = await guest.listing.byId.query({ id: plain.id });
      assert(afterEdit.expiresAt != null, 'expiresAt must still be set after an edit');
      // Allow ±1s for timing noise; any larger shift means the clock was reset.
      assert(
        Math.abs(afterEdit.expiresAt!.getTime() - beforeEdit) < 1000,
        `editing must not reset the expiry clock (before=${beforeEdit}, after=${afterEdit.expiresAt!.getTime()})`,
      );

      // (c) A listing whose expiresAt is in the past must not appear in the feed.
      // Wind back the clock directly in the DB, then run the sweep.
      await db
        .update(listingsTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eqOp(listingsTable.id, plain.id));
      await applyExpiry(db);

      const feed = await guest.listing.feed.query({ campusId: CAMPUS_ID, limit: 50 });
      assert(
        feed.items.every((i) => i.id !== plain.id),
        'a listing past its expiresAt must not appear in the feed',
      );

      const expired = await guest.listing.byId.query({ id: plain.id });
      assertEqual(expired.status, 'expired', 'the listing status must be expired after the sweep');
    }
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
