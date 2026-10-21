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
  let auctionListingId = '';
  const AUCTION_PHOTOS = ['/api/uploads/demo-tech.svg'];

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

    // Auctions ride the same feed shape as fixed-price listings.
    assert(
      feed.items.every(
        (i) =>
          typeof i.currentPriceCents === 'number' &&
          typeof i.bidCount === 'number' &&
          (i.saleType === 'fixed' || i.saleType === 'auction'),
      ),
      'every feed card carries saleType, currentPriceCents and bidCount',
    );
    assert(
      feed.items
        .filter((i) => i.saleType === 'fixed')
        .every((i) => i.currentPriceCents === i.priceCents && i.bidCount === 0),
      'fixed-price cards are unchanged: current price is the price, no bids',
    );
    const seededAuctions = feed.items.filter((i) => i.saleType === 'auction');
    assert(seededAuctions.length >= 3, `expected 3+ seeded auctions, got ${seededAuctions.length}`);
    assert(
      seededAuctions.every((i) => i.expiresAt != null && i.startPriceCents != null),
      'every seeded auction has an end time and a start price',
    );
    assert(
      seededAuctions.some((i) => i.bidCount >= 2 && i.currentPriceCents > i.startPriceCents!),
      'at least one seeded auction already has bids above its start price',
    );
    assert(
      seededAuctions.some((i) => i.buyoutPriceCents != null),
      'at least one seeded auction has a buy-it-now price',
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
    assertEqual(reread.saleType, 'fixed', 'a listing is fixed-price unless asked otherwise');
    assertEqual(reread.bidCount, 0, 'a fixed-price listing has no bids');
    assertEqual(
      reread.currentPriceCents,
      6900,
      'a fixed-price listing prices at its price, not a bid',
    );

    /* ------------------------------------------------- auctions (§1) --- */

    const auctionBase = {
      title: 'Auction: espresso machine',
      description: 'Pulls a good shot. Bidding for 24 hours.',
      category: 'tech' as const,
      condition: 'good' as const,
      priceCents: 0,
      isSellToday: false,
      photoUrls: AUCTION_PHOTOS,
      spotIds: [spotAId],
      windows: [{ startsAt: windowStart, endsAt: windowEnd }],
    };

    // Validation: a start price is required, has a $1 floor, and a buyout
    // price has to beat it.
    await expectTrpcError('BAD_REQUEST', () =>
      maya.listing.create.mutate({ ...auctionBase, saleType: 'auction' }),
    );
    await expectTrpcError('BAD_REQUEST', () =>
      maya.listing.create.mutate({ ...auctionBase, saleType: 'auction', startPriceCents: 50 }),
    );
    await expectTrpcError('BAD_REQUEST', () =>
      maya.listing.create.mutate({
        ...auctionBase,
        saleType: 'auction',
        startPriceCents: 2000,
        buyoutPriceCents: 2000,
      }),
    );

    const auction = await maya.listing.create.mutate({
      ...auctionBase,
      saleType: 'auction',
      startPriceCents: 2000,
      buyoutPriceCents: 9000,
    });
    auctionListingId = auction.id;

    assertEqual(auction.saleType, 'auction', 'the listing is an auction');
    assertEqual(auction.startPriceCents, 2000, 'the start price persists');
    assertEqual(auction.buyoutPriceCents, 9000, 'the buyout price persists');
    assertEqual(auction.currentPriceCents, 2000, 'with no bids, current price is the start price');
    assertEqual(auction.bidCount, 0, 'a new auction has no bids');
    assertEqual(auction.isSellToday, false, 'an auction is never a "Sell today" listing');
    assert(auction.expiresAt != null, 'an auction always has an end time');
    const hoursOut = (auction.expiresAt!.getTime() - Date.now()) / (60 * 60 * 1000);
    assert(hoursOut > 23.5 && hoursOut <= 24.1, `auction should end in ~24h, got ${hoursOut}h`);

    // Bidding on a fixed-price listing is a BAD_REQUEST, not a silent no-op.
    const fixedMsg = await expectTrpcError('BAD_REQUEST', () =>
      jordan.bid.place.mutate({ listingId, amountCents: 8000 }),
    );
    assertEqual(
      fixedMsg,
      'This item has a fixed price — request a meetup instead.',
      'the fixed-price rejection message is the one the UI shows',
    );

    // The seller cannot bid on their own auction.
    const sellerMsg = await expectTrpcError('FORBIDDEN', () =>
      maya.bid.place.mutate({ listingId: auctionListingId, amountCents: 3000 }),
    );
    assertEqual(sellerMsg, "You can't bid on your own listing.", 'seller self-bid is refused');

    // Under the start price is refused; at the start price is accepted — a
    // single bid sells the item at the seller's floor.
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.bid.place.mutate({ listingId: auctionListingId, amountCents: 1500 }),
    );
    const firstBid = await jordan.bid.place.mutate({
      listingId: auctionListingId,
      amountCents: 2000,
    });
    assertEqual(firstBid.currentPriceCents, 2000, 'the first bid sets the current price');
    assertEqual(firstBid.bidCount, 1, 'one bid so far');
    assertEqual(firstBid.extended, false, 'a bid a day out does not extend the auction');

    // Minimum increment: $1 or 5%, whichever is larger. On $20 that is $1.
    const lowMsg = await expectTrpcError('BAD_REQUEST', () =>
      sam.bid.place.mutate({ listingId: auctionListingId, amountCents: 2050 }),
    );
    assert(lowMsg.includes('$21'), `the increment error should name $21, got: ${lowMsg}`);
    await sam.bid.place.mutate({ listingId: auctionListingId, amountCents: 2100 });

    // 5% dominates once the price is high enough: $21 → $21 + $1.05 = $22.05.
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.bid.place.mutate({ listingId: auctionListingId, amountCents: 2200 }),
    );
    await jordan.bid.place.mutate({ listingId: auctionListingId, amountCents: 2205 });

    // A bid at or above the buyout must go through Buy it now.
    await expectTrpcError('BAD_REQUEST', () =>
      sam.bid.place.mutate({ listingId: auctionListingId, amountCents: 9000 }),
    );

    const afterBids = await guest.listing.byId.query({ id: auctionListingId });
    assertEqual(afterBids.currentPriceCents, 2205, 'current price is the highest bid');
    assertEqual(afterBids.bidCount, 3, 'three bids were accepted');

    // Public bid history: newest first, display names only, never an email.
    const history = await guest.bid.forListing.query({ listingId: auctionListingId });
    assertEqual(history.length, 3, 'the public history shows every bid');
    assertEqual(history[0]!.amountCents, 2205, 'bid history is newest first');
    assert(
      history.every((b) => !('email' in b.bidder) && typeof b.bidder.displayName === 'string'),
      'bid history exposes display names, never emails',
    );

    const mine = await jordan.bid.mine.query();
    assert(
      mine.some((b) => b.listing.id === auctionListingId && b.amountCents === 2205),
      "bid.mine lists the caller's own bids",
    );

    // Rule 6: once an auction has bids, prices and sale type freeze, and the
    // listing cannot be pulled out from under the bidders.
    const editMsg = await expectTrpcError('CONFLICT', () =>
      maya.listing.update.mutate({ id: auctionListingId, startPriceCents: 500 }),
    );
    assertEqual(
      editMsg,
      "This auction already has bids, so its prices can't change.",
      'the frozen-price message is the one the UI shows',
    );
    await expectTrpcError('CONFLICT', () =>
      maya.listing.update.mutate({ id: auctionListingId, saleType: 'fixed', priceCents: 500 }),
    );
    await expectTrpcError('CONFLICT', () => maya.listing.remove.mutate({ id: auctionListingId }));

    // Non-price edits still work.
    const retitled = await maya.listing.update.mutate({
      id: auctionListingId,
      title: 'Auction: espresso machine (with basket)',
    });
    assertEqual(
      retitled.title,
      'Auction: espresso machine (with basket)',
      'a non-price edit still saves on an auction with bids',
    );
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
      windows: [
        {
          startsAt: new Date(Date.now() + 15 * 60 * 1000),
          endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
        },
      ],
    });
    const probeSlot = new Date(Date.now() + 2 * 60 * 60 * 1000);

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

    /* ----------------------------------- buyout ends an auction (§1.4) --- */

    const buyoutListing = await maya.listing.create.mutate({
      title: 'Auction: turntable',
      description: 'Belt drive, new belt fitted.',
      category: 'tech',
      condition: 'good',
      priceCents: 0,
      saleType: 'auction',
      startPriceCents: 3000,
      buyoutPriceCents: 8000,
      isSellToday: false,
      photoUrls: AUCTION_PHOTOS,
      spotIds: [spotAId],
      windows: [],
    });

    // A buyout with no buyout price set is refused.
    const noBuyout = await maya.listing.create.mutate({
      title: 'Auction: no buy it now here',
      category: 'other',
      condition: 'good',
      priceCents: 0,
      saleType: 'auction',
      startPriceCents: 1500,
      isSellToday: false,
      photoUrls: AUCTION_PHOTOS,
      spotIds: [spotAId],
      windows: [],
    });
    await expectTrpcError('BAD_REQUEST', () =>
      jordan.bid.buyout.mutate({ listingId: noBuyout.id }),
    );

    await jordan.bid.place.mutate({ listingId: buyoutListing.id, amountCents: 3000 });

    const bought = await sam.bid.buyout.mutate({ listingId: buyoutListing.id });
    assertEqual(bought.pricePaidCents, 8000, 'the buyer pays the buy-it-now price');
    assert(bought.reservationId != null, 'a buyout creates the winner a reservation');

    const afterBuyout = await guest.listing.byId.query({ id: buyoutListing.id });
    assertEqual(afterBuyout.status, 'reserved', 'a buyout reserves the listing immediately');
    assert(
      afterBuyout.expiresAt != null && afterBuyout.expiresAt.getTime() <= Date.now(),
      'a buyout ends the auction there and then',
    );

    const winnerRes = await sam.reservation.byId.query({ id: bought.reservationId! });
    assertEqual(winnerRes.status, 'requested', "the winner's meetup starts as a request");
    assertEqual(winnerRes.priceCents, 8000, 'the reservation records the price actually paid');
    assertEqual(winnerRes.buyerId, SAM_ID, 'the reservation belongs to the buyer who bought it');

    // The auction is closed to everyone now.
    await expectTrpcError('CONFLICT', () =>
      jordan.bid.place.mutate({ listingId: buyoutListing.id, amountCents: 9000 }),
    );
    await expectTrpcError('CONFLICT', () =>
      jordan.bid.buyout.mutate({ listingId: buyoutListing.id }),
    );
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

    /* --------------------------- settlement at expiry (§1, settlement) --- */

    if (!external) {
      const { db } = await import('../backend/db/client');
      const { eq, and } = await import('drizzle-orm');
      const { listings: listingsTable, reservations: reservationsTable, bids: bidsTable } =
        await import('../backend/db/schema');
      const { applyExpiry } = await import('../backend/trpc/lib');

      /** Rewinds an auction's clock so the lazy settlement pass picks it up. */
      const endNow = async (id: string) =>
        db
          .update(listingsTable)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(listingsTable.id, id));

      // (a) an auction with bids settles into exactly one reservation for the
      //     top bidder — and running settlement twice does not create a second.
      const ending = await maya.listing.create.mutate({
        title: 'Auction: rice cooker',
        category: 'dorm',
        condition: 'good',
        priceCents: 0,
        saleType: 'auction',
        startPriceCents: 1000,
        isSellToday: false,
        photoUrls: AUCTION_PHOTOS,
        spotIds: [spotAId],
        windows: [{ startsAt: new Date(Date.now() + 20 * 60 * 1000), endsAt: new Date(Date.now() + 5 * 60 * 60 * 1000) }],
      });
      await jordan.bid.place.mutate({ listingId: ending.id, amountCents: 1000 });
      await sam.bid.place.mutate({ listingId: ending.id, amountCents: 1100 });

      await endNow(ending.id);
      await applyExpiry(db);
      await applyExpiry(db); // idempotency: the second pass must be a no-op

      const settled = await guest.listing.byId.query({ id: ending.id });
      assertEqual(settled.status, 'reserved', 'an auction with bids settles to reserved');

      const settledRes = await db
        .select()
        .from(reservationsTable)
        .where(eq(reservationsTable.listingId, ending.id));
      assertEqual(settledRes.length, 1, 'settlement creates exactly one reservation, even run twice');
      assertEqual(settledRes[0]!.buyerId, SAM_ID, 'the top bidder wins');
      assertEqual(settledRes[0]!.priceCents, 1100, 'the reservation price is the winning bid');
      assertEqual(settledRes[0]!.status, 'requested', 'the winner starts in the normal meetup flow');
      assertEqual(
        settledRes[0]!.proposedById,
        MAYA_ID,
        'the seller makes the opening meetup proposal',
      );

      // The winner really can see and act on it through the normal API.
      const winnerSees = await sam.reservation.mine.query({ role: 'buyer' });
      assert(
        winnerSees.some((r) => r.listingId === ending.id),
        'the winning bidder sees the reservation in their own list',
      );

      // (b) an auction with no bids expires, and relisting clears old bids.
      const noBids = await maya.listing.create.mutate({
        title: 'Auction: nobody wanted this',
        category: 'other',
        condition: 'fair',
        priceCents: 0,
        saleType: 'auction',
        startPriceCents: 1200,
        isSellToday: false,
        photoUrls: AUCTION_PHOTOS,
        spotIds: [spotAId],
        windows: [],
      });
      await endNow(noBids.id);
      await applyExpiry(db);

      const expiredAuction = await guest.listing.byId.query({ id: noBids.id });
      assertEqual(expiredAuction.status, 'expired', 'an auction with no bids just expires');
      const noReservations = await db
        .select()
        .from(reservationsTable)
        .where(eq(reservationsTable.listingId, noBids.id));
      assertEqual(noReservations.length, 0, 'a bidless auction creates nobody a reservation');

      // A leftover bid row from the previous run must not survive a relist.
      await db
        .insert(bidsTable)
        .values({ listingId: noBids.id, bidderId: JORDAN_ID, amountCents: 1200 });

      const relisted = await maya.listing.relist.mutate({ id: noBids.id, isSellToday: false });
      assertEqual(relisted.status, 'active', 'a relisted auction is active again');
      assertEqual(relisted.saleType, 'auction', 'a relisted auction is still an auction');
      assertEqual(relisted.bidCount, 0, 'relisting clears every previous bid');
      assertEqual(relisted.currentPriceCents, 1200, 'a relisted auction restarts at its start price');
      const relistHours = (relisted.expiresAt!.getTime() - Date.now()) / (60 * 60 * 1000);
      assert(relistHours > 23.5 && relistHours <= 24.1, 'relisting restarts the 24h clock');
      const leftover = await db
        .select()
        .from(bidsTable)
        .where(and(eq(bidsTable.listingId, noBids.id)));
      assertEqual(leftover.length, 0, 'the bids table really is emptied for that listing');

      // (c) anti-sniping: a bid inside the final 2 minutes pushes the end out.
      const sniped = await maya.listing.create.mutate({
        title: 'Auction: ending any second now',
        category: 'other',
        condition: 'good',
        priceCents: 0,
        saleType: 'auction',
        startPriceCents: 1000,
        isSellToday: false,
        photoUrls: AUCTION_PHOTOS,
        spotIds: [spotAId],
        windows: [],
      });
      await db
        .update(listingsTable)
        .set({ expiresAt: new Date(Date.now() + 60 * 1000) })
        .where(eq(listingsTable.id, sniped.id));

      const snipe = await jordan.bid.place.mutate({ listingId: sniped.id, amountCents: 1000 });
      assertEqual(snipe.extended, true, 'a last-minute bid extends the auction');
      const extraMinutes = (snipe.endsAt.getTime() - Date.now()) / 60000;
      assert(
        extraMinutes > 1.8 && extraMinutes <= 2.1,
        `anti-snipe should push the end to ~2 minutes out, got ${extraMinutes}m`,
      );

      // (d) two bids landing at once serialize — the row lock means the second
      //     sees the first, so they can never both win at the same amount.
      const race = await maya.listing.create.mutate({
        title: 'Auction: two bidders at once',
        category: 'other',
        condition: 'good',
        priceCents: 0,
        saleType: 'auction',
        startPriceCents: 2000,
        isSellToday: false,
        photoUrls: AUCTION_PHOTOS,
        spotIds: [spotAId],
        windows: [],
      });
      const outcomes = await Promise.allSettled([
        jordan.bid.place.mutate({ listingId: race.id, amountCents: 2000 }),
        sam.bid.place.mutate({ listingId: race.id, amountCents: 2000 }),
      ]);
      assertEqual(
        outcomes.filter((o) => o.status === 'fulfilled').length,
        1,
        'exactly one of two simultaneous equal bids is accepted',
      );
      const raced = await guest.listing.byId.query({ id: race.id });
      assertEqual(raced.bidCount, 1, 'the losing concurrent bid left no row behind');

      // Fixed-price expiry is untouched by any of this.
      const sellToday = await maya.listing.create.mutate({
        title: 'Fixed price, selling today',
        category: 'other',
        condition: 'good',
        priceCents: 1500,
        isSellToday: true,
        photoUrls: AUCTION_PHOTOS,
        spotIds: [spotAId],
        windows: [],
      });
      await endNow(sellToday.id);
      await applyExpiry(db);
      const expiredFixed = await guest.listing.byId.query({ id: sellToday.id });
      assertEqual(expiredFixed.status, 'expired', 'a fixed-price listing still just expires');
      const fixedRes = await db
        .select()
        .from(reservationsTable)
        .where(eq(reservationsTable.listingId, sellToday.id));
      assertEqual(fixedRes.length, 0, 'fixed-price expiry never creates a reservation');
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

    // A blocked user cannot bid on, or buy out, the other party's auction.
    const blockedMsg = await expectTrpcError('FORBIDDEN', () =>
      jordan.bid.place.mutate({ listingId: auctionListingId, amountCents: 5000 }),
    );
    assertEqual(blockedMsg, "You can't bid on this listing.", 'the block message is human');
    await expectTrpcError('FORBIDDEN', () =>
      jordan.bid.buyout.mutate({ listingId: auctionListingId }),
    );
    // Sam, who is not in a block relationship, still can.
    await sam.bid.place.mutate({ listingId: auctionListingId, amountCents: 5000 });

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

      const closureWindow = {
        startsAt: new Date(Date.now() + 15 * 60 * 1000),
        endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      };
      const closureTime = new Date(Date.now() + 45 * 60 * 1000);

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
        startsAt: closureTime,
      });

      // Listing 2 → left `requested` (pending) at closure time.
      const listing2 = await makeThrowawayListing('Closure test item 2 (stays pending)');
      const res2 = await jordan.reservation.request.mutate({
        listingId: listing2.id,
        spotId: spotAId,
        startsAt: closureTime,
      });
      assertEqual(res2.status, 'requested', 'reservation 2 starts out pending');

      // Listing 3 → carried all the way to `completed` before closure.
      const listing3 = await makeThrowawayListing('Closure test item 3 (already completed)');
      const res3 = await jordan.reservation.request.mutate({
        listingId: listing3.id,
        spotId: spotAId,
        startsAt: closureTime,
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

  /* ------------------------------------------------------------------ 9 */

  await criterion('9. Every new listing expires 24h after creation', async () => {
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
        windows: [],
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
