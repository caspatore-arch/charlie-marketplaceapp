/**
 * Generates a steady-state campus dataset on top of the demo seed, so load
 * tests run against data shaped like a real campus rather than 16 listings.
 *
 * Sizing (the default `--scale=1`) models one campus at ~5,000 daily active
 * users, roughly a semester in:
 *
 *   15,000 users          ~3x DAU registered at the campus
 *   24,000 listings       150 new/day, of which ~2,400 are still active
 *  120,000 messages       ~2,000/day, two thirds of listings never messaged
 *   30,000 windows        active listings carry 1-3 pickup windows
 *
 * Everything is written in batches through the same schema the app uses, so an
 * index that is missing here is missing in production too.
 *
 *   npx tsx scripts/bulk-seed.ts --scale=1
 *
 * This is a load-test fixture, not a demo: rows are marked isDemo so nothing
 * here can be mistaken for real inventory.
 */
import { sql } from 'drizzle-orm';

import { db } from '../backend/db/client';
import { runMigrations } from '../backend/db/migrate';
import { seed } from '../backend/db/seed';
import {
  availabilityWindows,
  conversations,
  listingSpots,
  listings,
  messages,
  users,
} from '../backend/db/schema';

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SPOT_IDS = [
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000014',
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Deterministic PRNG so a run is reproducible and diffable between changes. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const rand = makeRandom(20260920);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/** UUIDv4-shaped id derived from a counter, so ids are stable across runs. */
function idFor(prefix: number, n: number): string {
  const hex = n.toString(16).padStart(8, '0');
  const p = prefix.toString(16).padStart(4, '0');
  return `${hex}-0000-4000-8000-${p}00000000`.slice(0, 36);
}

const CATEGORIES = ['clothing', 'shoes', 'jewelry', 'accessories', 'dorm', 'books', 'tech', 'other'] as const;
const CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;
const NOUNS = [
  'desk lamp', 'mini fridge', 'denim jacket', 'running shoes', 'textbook', 'monitor',
  'backpack', 'coffee maker', 'bike lock', 'headphones', 'floor rug', 'hoodie',
  'desk chair', 'keyboard', 'sunglasses', 'tote bag', 'microwave', 'bookshelf',
];
const ADJECTIVES = ['barely used', 'like new', 'vintage', 'oversized', 'compact', 'dorm sized', 'spare', 'unopened'];

/** Inserts `rows` in chunks, so one statement never carries 20k value tuples. */
async function insertChunked<T>(
  label: string,
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  chunkSize = 500,
): Promise<void> {
  const started = Date.now();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(chunk as any).onConflictDoNothing();
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  ${label.padEnd(22)} ${rows.length.toLocaleString().padStart(8)} rows  ${secs}s`);
}

export interface BulkSizing {
  users: number;
  listings: number;
  /** Share of listings still `active` (the rest are sold/expired history). */
  activeShare: number;
  conversations: number;
  messagesPerConversation: number;
}

export function sizingForScale(scale: number): BulkSizing {
  return {
    users: Math.round(15_000 * scale),
    listings: Math.round(24_000 * scale),
    activeShare: 0.1,
    conversations: Math.round(12_000 * scale),
    messagesPerConversation: 10,
  };
}

export async function bulkSeed(sizing: BulkSizing): Promise<void> {
  await runMigrations();
  // The demo seed owns the campus and the four meetup spots that every row
  // below references, so it has to land first.
  await seed();

  const existing = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings);
  console.log(`starting from ${existing[0]?.n ?? 0} listings`);

  /* ------------------------------------------------------------- users */
  const userRows = Array.from({ length: sizing.users }, (_, i) => ({
    id: idFor(1, i),
    email: `load${i}@demo.campus.test`,
    displayName: `Load User ${i}`,
    campusId: CAMPUS_ID,
    campusEmailVerifiedAt: new Date(),
    isDemo: true,
    createdAt: new Date(Date.now() - Math.floor(rand() * 500) * DAY),
  }));
  await insertChunked('users', users, userRows);

  /* ---------------------------------------------------------- listings */
  const now = Date.now();
  const activeCount = Math.round(sizing.listings * sizing.activeShare);
  const listingRows = Array.from({ length: sizing.listings }, (_, i) => {
    const active = i < activeCount;
    // Active listings are the recent ones, so keyset pagination walks them
    // first exactly as it would in production.
    // A listing lives 24h, so live ones were posted within the last day.
    const ageDays = active ? rand() * 0.9 : 1 + rand() * 150;
    return {
      id: idFor(2, i),
      sellerId: idFor(1, Math.floor(rand() * sizing.users)),
      campusId: CAMPUS_ID,
      title: `${pick(NOUNS)}, ${pick(ADJECTIVES)}`,
      description: 'Load-test fixture listing. Not real inventory.',
      category: pick(CATEGORIES),
      condition: pick(CONDITIONS),
      priceCents: 500 + Math.floor(rand() * 20_000),
      saleType: 'fixed' as const,
      status: active ? ('active' as const) : pick(['sold', 'expired'] as const),
      isDemo: true,
      createdAt: new Date(now - ageDays * DAY),
      updatedAt: new Date(now - ageDays * DAY),
      expiresAt: new Date(now - ageDays * DAY + DAY),
    };
  });
  await insertChunked('listings', listings, listingRows);

  /* ------------------------------------------- spots + pickup windows */
  const spotRows: { listingId: string; spotId: string }[] = [];
  const windowRows: { listingId: string; startsAt: Date; endsAt: Date }[] = [];
  // Windows sit on the :00/:30 grid inside now -> now+24h (the booking rule).
  const SLOT = 30 * 60 * 1000;
  const firstSlot = Math.ceil(now / SLOT) * SLOT;

  for (let i = 0; i < activeCount; i += 1) {
    const listingId = idFor(2, i);
    const spotCount = 1 + Math.floor(rand() * 2);
    const chosen = new Set<string>();
    while (chosen.size < spotCount) chosen.add(pick(SPOT_IDS));
    for (const spotId of chosen) spotRows.push({ listingId, spotId });

    // Two thirds of active listings advertise windows; the rest are the
    // "Ask for a time" case, which must stay cheap to render too.
    if (rand() < 0.67) {
      const windows = 1 + Math.floor(rand() * 2);
      for (let w = 0; w < windows; w += 1) {
        const startsAt = new Date(firstSlot + Math.floor(rand() * 36) * SLOT); // up to +18h
        windowRows.push({ listingId, startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR) });
      }
    }
  }
  await insertChunked('listing_spots', listingSpots, spotRows);
  await insertChunked('availability_windows', availabilityWindows, windowRows);

  /* ----------------------------------------------- conversations + msgs */
  const convRows: { id: string; listingId: string; buyerId: string; sellerId: string; createdAt: Date }[] = [];
  const seenPair = new Set<string>();
  for (let i = 0; i < sizing.conversations; i += 1) {
    const listingIndex = Math.floor(rand() * activeCount);
    const buyerIndex = Math.floor(rand() * sizing.users);
    // conversations has a unique index on (listingId, buyerId).
    const key = `${listingIndex}:${buyerIndex}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    convRows.push({
      id: idFor(3, i),
      listingId: idFor(2, listingIndex),
      buyerId: idFor(1, buyerIndex),
      sellerId: listingRows[listingIndex]!.sellerId,
      createdAt: new Date(now - Math.floor(rand() * 30) * DAY),
    });
  }
  await insertChunked('conversations', conversations, convRows);

  const messageRows: {
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
    createdAt: Date;
  }[] = [];
  let messageSeq = 0;
  for (const conv of convRows) {
    const count = 1 + Math.floor(rand() * sizing.messagesPerConversation);
    for (let m = 0; m < count; m += 1) {
      messageRows.push({
        id: idFor(4, messageSeq),
        conversationId: conv.id,
        senderId: m % 2 === 0 ? conv.buyerId : conv.sellerId,
        body: 'Load-test message body.',
        createdAt: new Date(conv.createdAt.getTime() + m * HOUR),
      });
      messageSeq += 1;
    }
  }
  await insertChunked('messages', messages, messageRows);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(listings);
  console.log(`done: ${total.toLocaleString()} listings total`);
}

/**
 * Refuses to write tens of thousands of fixture rows into the dev database.
 *
 * This is not hypothetical: PGLITE_DIR has to be set before backend/db/client
 * is evaluated, and ES imports are hoisted, so a script that assigns it in its
 * module body assigns it too late and silently targets backend/data/pg. That
 * mistake put 24k load-test listings into the local dev database once already.
 */
function refuseToPolluteDevData(): void {
  if (process.env.DATABASE_URL) return; // a real Postgres the caller chose
  if (process.env.BULK_SEED_ALLOW_DEV_DIR === '1') return;
  const dir = process.env.PGLITE_DIR;
  if (dir && !dir.includes('backend/data')) return;
  console.error(
    `\nThis would write bulk fixture rows into the dev database (${dir ?? 'backend/data/pg'}).\n\n` +
      `Point it somewhere disposable:\n` +
      `  PGLITE_DIR=/tmp/campus-load/pg npx tsx scripts/bulk-seed.ts --scale=1\n\n` +
      `Or run scripts/loadtest.ts, which manages a throwaway datadir for you.\n` +
      `Set BULK_SEED_ALLOW_DEV_DIR=1 only if polluting dev data is the intent.\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  refuseToPolluteDevData();
  const scaleArg = process.argv.find((a) => a.startsWith('--scale='));
  const scale = scaleArg ? Number(scaleArg.split('=')[1]) : 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('--scale must be a positive number');

  const sizing = sizingForScale(scale);
  console.log(`bulk seeding at scale ${scale}:`);
  const started = Date.now();
  await bulkSeed(sizing);
  console.log(`total ${(Date.now() - started) / 1000}s`);
}

if (process.argv[1]?.includes('bulk-seed')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
