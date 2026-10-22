/**
 * Focused proof for the "custom meetup address" feature (docs/AUCTIONS.md §2).
 *
 *   npx tsx scripts/geo-check.ts
 *
 * Deliberately separate from `scripts/e2e.ts` (kept separate) so the two scripts never collide. Boots its own in-process
 * backend on a random port with a throwaway PGlite data dir, and forces
 * `GEOCODER=stub` so this never depends on a third-party geocoding service
 * being reachable.
 *
 * Proves:
 *   1. An in-radius address is accepted and stored on the reservation.
 *   2. An out-of-radius address is rejected with the exact spec message.
 *   3. An unresolvable address is rejected with the exact spec message.
 *   4. The DB check constraint rejects a row with both spotId and a custom
 *      address (bypassing the API, via a raw insert).
 *   5. A non-participant cannot read a reservation (and so cannot read its
 *      custom address).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import superjson from 'superjson';
import { eq } from 'drizzle-orm';

import type { AppRouter } from '../backend/trpc/app-router';

/* ------------------------------------------------- isolated env (set first) */

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-geo-check-'));
process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.PORT = '0';
process.env.DEV_LOGIN = '1';
process.env.GEOCODER = 'stub'; // deterministic offline fixtures — see backend/geocode.ts
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
  if (actual !== expected) {
    throw new Error(`${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  }
}

async function expectTrpcError(code: string, message: string | undefined, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof TRPCClientError) {
      const actualCode = (err.data as { code?: string } | null)?.code;
      assertEqual(actualCode, code, `expected tRPC code ${code}`);
      if (message !== undefined) {
        assertEqual(err.message, message, 'expected exact error message');
      }
      return;
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

// Fixtures from backend/geocode.ts's GEOCODER=stub table.
const IN_RADIUS_ADDRESS = '900 E University Blvd, Tucson, AZ';
const OUT_OF_RADIUS_ADDRESS = '4455 E Speedway Blvd, Tucson, AZ';
const UNRESOLVABLE_ADDRESS = '1 Nowhere Lane, Nonexistentville, ZZ';

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
  const url = `http://127.0.0.1:${port}/api/trpc`;
  console.log(`booted in-process backend on ${url} (data: ${tempRoot})`);

  const guest = clientFor(url);
  const mayaAuth = await guest.auth.devSignIn.mutate({ userId: MAYA_ID });
  const jordanAuth = await guest.auth.devSignIn.mutate({ userId: JORDAN_ID });
  const samAuth = await guest.auth.devSignIn.mutate({ userId: SAM_ID });
  const maya: Client = clientFor(url, mayaAuth.token);
  const jordan: Client = clientFor(url, jordanAuth.token);
  const sam: Client = clientFor(url, samAuth.token);

  // A fresh listing owned by this script (not seed.ts, which the auctions
  // agent owns and may change) so the availability window is exactly what we
  // need and nothing here depends on their fixture data.
  const spots = await guest.campus.spots.query({ campusId: CAMPUS_ID });
  assert(spots.length > 0, 'campus should have seeded meetup spots');
  const spotId = spots[0]!.id;

  // Meetups are 15-minute slots on :00/:15/:30/:45, within the next 24h and inside a
  // seller window, so derive every time from the slot grid.
  const SLOT_MS = 15 * 60 * 1000;
  const alignedIn = (hours: number) =>
    new Date(Math.ceil((Date.now() + hours * 60 * 60 * 1000) / SLOT_MS) * SLOT_MS);
  const windowStart = alignedIn(0.5);
  const windowEnd = alignedIn(5);
  const startsAt = alignedIn(1);

  const listing = await maya.listing.create.mutate({
    title: 'Geo-check test listing',
    category: 'other',
    condition: 'good',
    priceCents: 500,
    isSellToday: false,
    photoUrls: ['/api/uploads/demo-bag.svg'],
    spotIds: [spotId],
    windows: [{ startsAt: windowStart.toISOString(), endsAt: windowEnd.toISOString() }],
  });

  /* ------------------------------------------------------------------ 1 */

  let inRadiusReservationId = '';
  await criterion('1. An in-radius custom address is accepted and stored', async () => {
    const reservation = await jordan.reservation.request.mutate({
      listingId: listing.id,
      customAddress: IN_RADIUS_ADDRESS,
      startsAt,
    });
    inRadiusReservationId = reservation.id;
    assertEqual(reservation.spotId, null, 'a custom-address reservation should have no spotId');
    assert(reservation.customAddress, 'the resolved address should be stored');
    assert(reservation.customLat != null && reservation.customLng != null, 'lat/lng should be stored');

    // Both participants can read it back with a directions URL.
    const asBuyer = await jordan.reservation.byId.query({ id: inRadiusReservationId });
    const asSeller = await maya.reservation.byId.query({ id: inRadiusReservationId });
    assert(asBuyer.customAddress, 'buyer should see the custom address');
    assert(asSeller.customAddress, 'seller should see the custom address');
    assert(asBuyer.directionsUrl?.includes(String(asBuyer.customLat)), 'directions URL should use the resolved coordinates');
  });

  /* ------------------------------------------------------------------ 2 */

  await criterion('2. An out-of-radius address is rejected with the exact spec message', async () => {
    await expectTrpcError('BAD_REQUEST', 'That address is outside the 2-mile campus area.', () =>
      jordan.reservation.request.mutate({
        listingId: listing.id,
        customAddress: OUT_OF_RADIUS_ADDRESS,
        startsAt,
      }),
    );
  });

  /* ------------------------------------------------------------------ 3 */

  await criterion('3. An unresolvable address is rejected with the exact spec message', async () => {
    await expectTrpcError('BAD_REQUEST', "We couldn't find that address.", () =>
      jordan.reservation.request.mutate({
        listingId: listing.id,
        customAddress: UNRESOLVABLE_ADDRESS,
        startsAt,
      }),
    );
  });

  /* ------------------------------------------------------------------ 4 */

  await criterion('4. The DB check constraint rejects spotId + a custom address together', async () => {
    const { db } = await import('../backend/db/client');
    const { reservations } = await import('../backend/db/schema');

    let threw = false;
    try {
      await db.insert(reservations).values({
        listingId: listing.id,
        buyerId: JORDAN_ID,
        sellerId: MAYA_ID,
        status: 'requested',
        spotId, // both branches set — should violate reservations_spot_xor_custom
        customAddress: '123 Test St',
        customLat: 32.23,
        customLng: -110.95,
        startsAt,
        proposedById: JORDAN_ID,
        priceCents: 500,
      });
    } catch (err) {
      threw = true;
      // Walk the cause chain — the driver often nests the actual Postgres
      // error (with the constraint name) under `.cause`.
      const messages: string[] = [];
      let cur: unknown = err;
      for (let i = 0; i < 5 && cur; i++) {
        if (cur instanceof Error) {
          messages.push(cur.message);
          cur = (cur as { cause?: unknown }).cause;
        } else {
          messages.push(String(cur));
          break;
        }
      }
      const combined = messages.join(' | ');
      assert(
        combined.includes('reservations_spot_xor_custom') ||
          combined.toLowerCase().includes('check constraint') ||
          combined.toLowerCase().includes('check_violation'),
        `expected a check-constraint violation, got: ${combined}`,
      );
    }
    assert(threw, 'inserting a row with both spotId and a custom address should have thrown');

    // Belt-and-braces: the bad row must not exist.
    const leaked = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.customAddress, '123 Test St'));
    assertEqual(leaked.length, 0, 'the rejected row should not have been written');
  });

  /* ------------------------------------------------------------------ 5 */

  await criterion('5. A non-participant cannot read the reservation (or its address)', async () => {
    await expectTrpcError('FORBIDDEN', 'This request is not yours.', () =>
      sam.reservation.byId.query({ id: inRadiusReservationId }),
    );
  });

  /* ------------------------------------------------------------------ 6 */

  await criterion('6. Counter-proposals accept a custom address (aligned future time) and validate it', async () => {
    const counterTime = alignedIn(2);
    await expectTrpcError('BAD_REQUEST', 'That address is outside the 2-mile campus area.', () =>
      maya.reservation.counter.mutate({
        id: inRadiusReservationId,
        customAddress: OUT_OF_RADIUS_ADDRESS,
        startsAt: counterTime,
      }),
    );
    // Off the 30-minute grid is refused before the address is even resolved.
    await expectTrpcError('BAD_REQUEST', 'Meetups start on a quarter hour (:00, :15, :30, :45) (15-minute slots).', () =>
      maya.reservation.counter.mutate({
        id: inRadiusReservationId,
        customAddress: IN_RADIUS_ADDRESS,
        startsAt: new Date(counterTime.getTime() + 7 * 60 * 1000),
      }),
    );
    const countered = await maya.reservation.counter.mutate({
      id: inRadiusReservationId,
      customAddress: IN_RADIUS_ADDRESS,
      startsAt: counterTime,
    });
    assertEqual(countered.status, 'countered', 'the counter moves the request to countered');
    assertEqual(countered.spotId, null, 'a custom-address counter has no spotId');
    assert(countered.customAddress, 'the counter stores the resolved address');
    assertEqual(countered.startsAt.getTime(), counterTime.getTime(), 'the counter stores the new time');
  });

  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('Failures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  return failed.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
