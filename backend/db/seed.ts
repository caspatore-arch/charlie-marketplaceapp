/**
 * Idempotent demo seed. Everything it writes is flagged `isDemo` so the app can
 * badge it, and every row uses a fixed UUID so re-running never duplicates.
 *
 *   npm run db:seed     # safe to run repeatedly
 *   npm run db:reset    # wipes backend/data/pg first
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from './client';
import { runMigrations } from './migrate';
import {
  availabilityWindows,
  bids,
  communityPosts,
  campuses,
  listingPhotos,
  listingSpots,
  listings,
  meetupSpots,
  reservations,
  users,
} from './schema';
import { storage as configuredStorage } from '../storage';
import { refuseIfBackendRunning } from './guard';
import { LISTING_LIFETIME_MS, localDayBounds } from '../trpc/lib';

const TIMEZONE = 'America/Phoenix';

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';

const MAYA_ID = '00000000-0000-4000-8000-000000000001';
const JORDAN_ID = '00000000-0000-4000-8000-000000000002';
const SAM_ID = '00000000-0000-4000-8000-000000000003';

const SPOT_UNION = '00000000-0000-4000-8000-000000000011';
const SPOT_LIBRARY = '00000000-0000-4000-8000-000000000012';
const SPOT_OLD_MAIN = '00000000-0000-4000-8000-000000000013';
const SPOT_REC = '00000000-0000-4000-8000-000000000014';

const DEMO_SPOT_NOTE = 'Demo location — verify hours and permission before pilot';

/* ------------------------------------------------------------ demo photos */

type DemoArt = { slug: string; label: string; bg: string; ink: string; shape: 'box' | 'tee' | 'circle' };

const DEMO_ART: DemoArt[] = [
  { slug: 'demo-jacket', label: 'Jacket', bg: '#E7DFD3', ink: '#3B352C', shape: 'tee' },
  { slug: 'demo-sneakers', label: 'Sneakers', bg: '#DCE4E2', ink: '#2C3A37', shape: 'box' },
  { slug: 'demo-lamp', label: 'Lamp', bg: '#F1E3D0', ink: '#4A3A26', shape: 'box' },
  { slug: 'demo-books', label: 'Books', bg: '#E3E0EC', ink: '#332E4A', shape: 'box' },
  { slug: 'demo-tech', label: 'Tech', bg: '#D9E2EA', ink: '#25333E', shape: 'box' },
  { slug: 'demo-jewelry', label: 'Jewelry', bg: '#F0E6E9', ink: '#4A2F38', shape: 'circle' },
  { slug: 'demo-bag', label: 'Bag', bg: '#E6E9DD', ink: '#343A28', shape: 'box' },
  { slug: 'demo-dorm', label: 'Dorm', bg: '#EDE4DE', ink: '#43352E', shape: 'box' },
];

/**
 * A clean 4:5 placeholder: solid ground and one simple silhouette. No DEMO mark
 * is drawn into the art — every surface that shows a photo already renders the
 * `demo` Badge over it, and two markers per tile read as clutter. The badge is
 * also the honest one: it tracks the listing, so it still appears once a demo
 * seller uploads a real photo.
 */
function demoSvg(art: DemoArt): string {
  const silhouette =
    art.shape === 'tee'
      ? `<path d="M240 300 L330 250 L400 290 L470 250 L560 300 L520 380 L480 360 L480 660 L320 660 L320 360 L280 380 Z" fill="${art.ink}" opacity="0.18"/>`
      : art.shape === 'circle'
        ? `<circle cx="400" cy="450" r="130" fill="none" stroke="${art.ink}" stroke-width="26" opacity="0.18"/>`
        : `<rect x="270" y="320" width="260" height="260" rx="20" fill="${art.ink}" opacity="0.18"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000" role="img" aria-label="${art.label} placeholder">
  <rect width="800" height="1000" fill="${art.bg}"/>
  ${silhouette}
  <text x="400" y="740" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="46" font-weight="600" fill="${art.ink}" opacity="0.55">${art.label}</text>
</svg>`;
}

/** Writes the 8 demo SVGs to disk and returns slug → served URL. */
async function writeDemoPhotos(): Promise<Record<string, string>> {
  // The configured adapter: local disk in dev, S3 when S3_BUCKET is set — so
  // seeding a hosted database from your Mac also uploads the demo photos to
  // the bucket the deployed backend reads from.
  const storage = configuredStorage;
  const urls: Record<string, string> = {};
  for (const art of DEMO_ART) {
    const { url } = await storage.put(
      `${art.slug}.svg`,
      Buffer.from(demoSvg(art), 'utf8'),
      'image/svg+xml',
    );
    urls[art.slug] = url;
  }
  return urls;
}

/* ------------------------------------------------------------------ times */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A window at local [startHour, endHour) on the local day `dayOffset` days out. */
function localWindow(startHour: number, endHour: number, dayOffset = 0) {
  const { start } = localDayBounds(TIMEZONE);
  const dayStart = start.getTime() + dayOffset * 24 * HOUR;
  return { startsAt: new Date(dayStart + startHour * HOUR), endsAt: new Date(dayStart + endHour * HOUR) };
}

/**
 * The next bookable window, so the demo always has a slot someone could pick.
 *
 * Usually that is later today. Late at night it is not: clamping the end to
 * midnight used to produce a window ending BEFORE it started (seed at 11:45 PM
 * and the slot ran 12:15 AM -> 11:59 PM), which emptied the feed's "Today"
 * availability and failed acceptance criterion 1. When too little of the day is
 * left to meet in, roll to tomorrow morning rather than inventing a slot nobody
 * could actually make.
 */
export function soonWindow(nowMs: number = Date.now()) {
  const now = nowMs;
  const { start, end } = localDayBounds(TIMEZONE);
  // Round up to the next :00/:30 so the slot chips read "5:00 PM", not "4:34 PM".
  const HALF_HOUR = 30 * 60 * 1000;
  const rounded = Math.ceil((now + HALF_HOUR) / HALF_HOUR) * HALF_HOUR;

  // Keep demo slots inside hours a student would actually meet in. Seeding at
  // 1:30 AM previously produced a real, bookable "Today 2:30-5:30 AM" window:
  // valid data, but it reads as broken and makes the whole feed look untrusted.
  const dayStart = start.getTime();
  const EARLIEST = dayStart + 9 * HOUR;
  const LATEST_START = dayStart + 19 * HOUR;
  const startsAt = new Date(Math.max(rounded, EARLIEST));

  const latestEnd = Math.min(end.getTime() - 60 * 1000, dayStart + 21 * HOUR);
  const MIN_WINDOW = HOUR;
  if (startsAt.getTime() > LATEST_START || latestEnd - startsAt.getTime() < MIN_WINDOW) {
    return localWindow(9, 12, 1);
  }
  return { startsAt, endsAt: new Date(Math.min(startsAt.getTime() + 3 * HOUR, latestEnd)) };
}

/* ------------------------------------------------------------------ data */

type SeedListing = {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: 'clothing' | 'shoes' | 'jewelry' | 'accessories' | 'dorm' | 'books' | 'tech' | 'other';
  condition: 'new' | 'like_new' | 'good' | 'fair';
  priceCents: number;
  size?: string;
  brand?: string;
  isSellToday?: boolean;
  photos: string[];
  spots: string[];
  /** 'today' adds the guaranteed-bookable slot plus a later one today. */
  windows: 'today' | 'tomorrow' | 'none';
};

const L = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

/**
 * Past sales, so the trust signals on a profile have something real behind them.
 *
 * These are deliberately SEPARATE listings, already `sold`, rather than marking
 * the 16 browsable demo listings sold: the feed has to stay full. Maya reads as
 * an established seller, Jordan has a shorter mixed history, and Sam is left at
 * zero on purpose so the brand-new-account state is visible in a demo. Do not
 * give Sam history: an account with no record is exactly the case a buyer most
 * needs to be able to recognise.
 */
const H = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const R = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;

type SeedHistory = {
  n: number;
  title: string;
  sellerId: string;
  buyerId: string;
  priceCents: number;
  daysAgo: number;
  /** 'cancelled' rows are cancelled BY the buyer, so the count lands on them. */
  status: 'completed' | 'cancelled';
};

const SEED_HISTORY: SeedHistory[] = [
  { n: 1, title: 'Mini fridge', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 5500, daysAgo: 61, status: 'completed' },
  { n: 2, title: 'Textbook: Organic Chemistry', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 3400, daysAgo: 54, status: 'completed' },
  { n: 3, title: 'Shower caddy', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 800, daysAgo: 47, status: 'completed' },
  { n: 4, title: 'Bike lock', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 1500, daysAgo: 40, status: 'completed' },
  { n: 5, title: 'Floor lamp', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 2200, daysAgo: 33, status: 'completed' },
  { n: 6, title: 'Rug, 5x7', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 4000, daysAgo: 26, status: 'completed' },
  { n: 7, title: 'Desk organiser', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 1200, daysAgo: 19, status: 'completed' },
  { n: 8, title: 'Wireless keyboard', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 2800, daysAgo: 12, status: 'completed' },
  { n: 9, title: 'Coffee maker', sellerId: JORDAN_ID, buyerId: MAYA_ID, priceCents: 2500, daysAgo: 30, status: 'completed' },
  { n: 10, title: 'Beach cruiser tyres', sellerId: JORDAN_ID, buyerId: MAYA_ID, priceCents: 1800, daysAgo: 17, status: 'completed' },
  { n: 11, title: 'Standing desk riser', sellerId: JORDAN_ID, buyerId: MAYA_ID, priceCents: 3900, daysAgo: 8, status: 'completed' },
  // One cancellation, so that row is not always a flat zero in the demo.
  { n: 12, title: 'Bookshelf', sellerId: MAYA_ID, buyerId: JORDAN_ID, priceCents: 3000, daysAgo: 22, status: 'cancelled' },
];

const SEED_LISTINGS: SeedListing[] = [
  {
    id: L(1),
    sellerId: MAYA_ID,
    title: 'Cropped corduroy jacket',
    description: 'Worn a handful of times. Warm enough for desert mornings, light enough for class.',
    category: 'clothing',
    condition: 'like_new',
    priceCents: 3800,
    size: 'M',
    brand: 'Madewell',
    photos: ['demo-jacket', 'demo-bag'],
    spots: [SPOT_UNION, SPOT_LIBRARY],
    windows: 'today',
  },
  {
    id: L(2),
    sellerId: MAYA_ID,
    title: 'White leather sneakers',
    description: 'Cleaned and ready. Small scuff on the left heel, shown in the photos.',
    category: 'shoes',
    condition: 'good',
    priceCents: 4500,
    size: 'W 8',
    brand: 'Veja',
    photos: ['demo-sneakers', 'demo-bag', 'demo-jacket'],
    spots: [SPOT_UNION],
    windows: 'today',
  },
  {
    id: L(3),
    sellerId: MAYA_ID,
    title: 'Gold hoop earrings',
    description: 'Gold-plated, never tarnished. Comes in the original pouch.',
    category: 'jewelry',
    condition: 'like_new',
    priceCents: 1600,
    photos: ['demo-jewelry'],
    spots: [SPOT_LIBRARY, SPOT_OLD_MAIN],
    windows: 'tomorrow',
  },
  {
    id: L(4),
    sellerId: MAYA_ID,
    title: 'Desk lamp with warm bulb',
    description: 'Clamps onto a dorm desk. Bulb included, no flicker.',
    category: 'dorm',
    condition: 'good',
    priceCents: 1200,
    isSellToday: true,
    photos: ['demo-lamp', 'demo-dorm'],
    spots: [SPOT_REC, SPOT_UNION],
    windows: 'today',
  },
  {
    id: L(5),
    sellerId: MAYA_ID,
    title: 'Intro to Statistics, 5th ed.',
    description: 'A few highlighted pages in chapters 3 and 4. Binding is solid.',
    category: 'books',
    condition: 'fair',
    priceCents: 2200,
    photos: ['demo-books'],
    spots: [SPOT_LIBRARY],
    windows: 'today',
  },
  {
    id: L(6),
    sellerId: MAYA_ID,
    title: 'Canvas tote, barely used',
    description: 'Holds a laptop and a water bottle. No stains.',
    category: 'accessories',
    condition: 'like_new',
    priceCents: 900,
    photos: ['demo-bag', 'demo-jacket'],
    spots: [SPOT_UNION, SPOT_REC],
    windows: 'none',
  },
  {
    id: L(7),
    sellerId: JORDAN_ID,
    title: 'Mechanical keyboard, 65%',
    description: 'Brown switches, USB-C, PBT keycaps. Quiet enough for a shared room.',
    category: 'tech',
    condition: 'good',
    priceCents: 5500,
    brand: 'Keychron',
    photos: ['demo-tech', 'demo-dorm'],
    spots: [SPOT_LIBRARY, SPOT_UNION],
    windows: 'today',
  },
  {
    id: L(8),
    sellerId: JORDAN_ID,
    title: 'Mini fridge, dorm sized',
    description: 'Runs cold and quiet. You will want a friend and a car for this one.',
    category: 'dorm',
    condition: 'good',
    priceCents: 6500,
    photos: ['demo-dorm', 'demo-lamp'],
    spots: [SPOT_REC],
    windows: 'tomorrow',
  },
  {
    id: L(9),
    sellerId: JORDAN_ID,
    title: 'Running shoes, size 10',
    description: 'About 80 miles on them. Plenty of tread left for campus walking.',
    category: 'shoes',
    condition: 'fair',
    priceCents: 2800,
    size: 'M 10',
    brand: 'Brooks',
    photos: ['demo-sneakers'],
    spots: [SPOT_REC, SPOT_OLD_MAIN],
    windows: 'today',
  },
  {
    id: L(10),
    sellerId: JORDAN_ID,
    title: 'Organic Chemistry bundle',
    description: 'Textbook plus the solutions manual. Both clean.',
    category: 'books',
    condition: 'good',
    priceCents: 4000,
    isSellToday: true,
    photos: ['demo-books', 'demo-tech'],
    spots: [SPOT_LIBRARY, SPOT_OLD_MAIN],
    windows: 'today',
  },
  {
    id: L(11),
    sellerId: JORDAN_ID,
    title: 'Denim jacket, oversized',
    description: 'Thrifted last year, washed twice. Fits like a medium.',
    category: 'clothing',
    condition: 'good',
    priceCents: 3200,
    size: 'L',
    photos: ['demo-jacket', 'demo-bag'],
    spots: [SPOT_UNION],
    windows: 'tomorrow',
  },
  {
    id: L(12),
    sellerId: JORDAN_ID,
    title: 'Wired earbuds and case',
    description: 'USB-C, works with the newer phones. Case has one scratch.',
    category: 'tech',
    condition: 'like_new',
    priceCents: 1500,
    photos: ['demo-tech'],
    spots: [SPOT_UNION, SPOT_LIBRARY],
    windows: 'none',
  },
  /* ------------------- formerly auction demos, now fixed asking prices */
  {
    id: L(13),
    sellerId: JORDAN_ID,
    title: 'Film camera, fully working',
    description: 'Shoots beautifully. Battery and strap included. Open to offers.',
    category: 'tech',
    condition: 'good',
    priceCents: 6500,
    brand: 'Canon',
    photos: ['demo-tech'],
    spots: [SPOT_UNION, SPOT_LIBRARY],
    windows: 'today',
  },
  {
    id: L(14),
    sellerId: MAYA_ID,
    title: 'Leather weekender bag',
    description: 'Full-grain leather, soft from use.',
    category: 'accessories',
    condition: 'good',
    priceCents: 6000,
    photos: ['demo-bag', 'demo-jacket'],
    spots: [SPOT_LIBRARY],
    windows: 'tomorrow',
  },
  {
    id: L(15),
    sellerId: JORDAN_ID,
    title: 'Mechanical keyboard, hot-swap',
    description: 'Tactile switches, extra keycaps in the box. Offers welcome.',
    category: 'tech',
    condition: 'like_new',
    priceCents: 7500,
    photos: ['demo-tech', 'demo-books'],
    spots: [SPOT_UNION, SPOT_REC],
    windows: 'today',
  },
  {
    id: L(16),
    sellerId: MAYA_ID,
    title: 'Desk chair, barely used',
    description: 'Adjustable, no squeaks. Priced to go before move-out.',
    category: 'dorm',
    condition: 'like_new',
    priceCents: 4000,
    photos: ['demo-dorm'],
    spots: [SPOT_REC, SPOT_OLD_MAIN],
    windows: 'today',
  },
];

/* ------------------------------------------------------------------ main */

export async function seed(): Promise<void> {
  await runMigrations();
  const photoUrls = await writeDemoPhotos();

  await db
    .insert(campuses)
    .values({
      id: CAMPUS_ID,
      name: 'University of Arizona',
      slug: 'arizona',
      emailDomains: ['arizona.edu', 'demo.campus.test'],
      timezone: TIMEZONE,
      isDemo: true,
    })
    .onConflictDoNothing();

  await db
    .insert(meetupSpots)
    .values([
      {
        id: SPOT_UNION,
        campusId: CAMPUS_ID,
        name: 'Student Union Memorial Center',
        description: 'Main entrance, under the awning by the north doors',
        lat: 32.232,
        lng: -110.9505,
        hoursNote: DEMO_SPOT_NOTE,
        isDemo: true,
      },
      {
        id: SPOT_LIBRARY,
        campusId: CAMPUS_ID,
        name: 'Main Library',
        description: 'Front steps, to the right of the entrance doors',
        lat: 32.2296,
        lng: -110.952,
        hoursNote: DEMO_SPOT_NOTE,
        isDemo: true,
      },
      {
        id: SPOT_OLD_MAIN,
        campusId: CAMPUS_ID,
        name: 'Old Main',
        description: 'Front lawn, by the fountain on the walkway side',
        lat: 32.2318,
        lng: -110.954,
        hoursNote: DEMO_SPOT_NOTE,
        isDemo: true,
      },
      {
        id: SPOT_REC,
        campusId: CAMPUS_ID,
        name: 'Student Recreation Center',
        description: 'Entrance, by the bike racks outside the front desk',
        lat: 32.234,
        lng: -110.947,
        hoursNote: DEMO_SPOT_NOTE,
        isDemo: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: MAYA_ID,
        email: 'maya@demo.campus.test',
        // Fictional 555-01xx numbers. SMS is simulated: nothing is ever sent.
        phone: '+15205550101',
        phoneVerifiedAt: new Date(),
        smsOptIn: true,
        smsOptInAt: new Date(),
        displayName: 'Maya Test',
        campusId: CAMPUS_ID,
        campusEmailVerifiedAt: new Date(),
        bio: 'Demo seller account. Junior, moving out in May.',
        isDemo: true,
        // Staggered so "Member since" differs between the demo accounts.
        createdAt: new Date(Date.now() - 400 * DAY),
      },
      {
        id: JORDAN_ID,
        email: 'jordan@demo.campus.test',
        // Fictional 555-01xx numbers. SMS is simulated: nothing is ever sent.
        phone: '+15205550102',
        phoneVerifiedAt: new Date(),
        smsOptIn: true,
        smsOptInAt: new Date(),
        displayName: 'Jordan Test',
        campusId: CAMPUS_ID,
        campusEmailVerifiedAt: new Date(),
        bio: 'Demo account. Buys and sells around the rec center.',
        isDemo: true,
        createdAt: new Date(Date.now() - 150 * DAY),
      },
      {
        id: SAM_ID,
        email: 'sam@demo.campus.test',
        // Fictional 555-01xx numbers. SMS is simulated: nothing is ever sent.
        phone: '+15205550103',
        phoneVerifiedAt: new Date(),
        smsOptIn: true,
        smsOptInAt: new Date(),
        displayName: 'Sam Test',
        campusId: CAMPUS_ID,
        campusEmailVerifiedAt: new Date(),
        bio: 'Demo account used for the double-booking test.',
        isDemo: true,
        createdAt: new Date(Date.now() - 2 * DAY),
      },
    ])
    .onConflictDoNothing();

  // Listings: insert once (never clobber state a demo run has changed), then
  // always refresh the child rows so "today" windows really are today.
  await db
    .insert(listings)
    .values(
      SEED_LISTINGS.map((l) => ({
        id: l.id,
        sellerId: l.sellerId,
        campusId: CAMPUS_ID,
        title: l.title,
        description: l.description,
        category: l.category,
        condition: l.condition,
        priceCents: l.priceCents,
        saleType: 'fixed' as const,
        startPriceCents: null,
        buyoutPriceCents: null,
        size: l.size ?? null,
        brand: l.brand ?? null,
        status: 'active' as const,
        isSellToday: l.isSellToday ?? false,
        // Every listing expires 24h after seed time so the demo feed is
        // correctly populated and non-expired right after a seed.
        // Auctions keep their custom end-time (endsInHours); fixed-price
        // listings all use LISTING_LIFETIME_MS.
        expiresAt: new Date(Date.now() + LISTING_LIFETIME_MS),
      })),
    )
    .onConflictDoNothing();

  const ids = SEED_LISTINGS.map((l) => l.id);
  await db.delete(listingPhotos).where(inArray(listingPhotos.listingId, ids));
  await db.delete(listingSpots).where(inArray(listingSpots.listingId, ids));
  await db.delete(availabilityWindows).where(inArray(availabilityWindows.listingId, ids));

  await db.insert(listingPhotos).values(
    SEED_LISTINGS.flatMap((l) =>
      l.photos.map((slug, i) => ({ listingId: l.id, url: photoUrls[slug]!, sortOrder: i })),
    ),
  );

  await db.insert(listingSpots).values(
    SEED_LISTINGS.flatMap((l) => l.spots.map((spotId) => ({ listingId: l.id, spotId }))),
  );

  // Availability is "the next rolling 24 hours" (docs/CONTRACT.md "Booking"),
  // so clamp every demo window to end by the listing's 24h expiry.
  const horizon = Date.now() + LISTING_LIFETIME_MS - 60_000;
  const clamp = (w: { startsAt: Date; endsAt: Date }) =>
    w.endsAt.getTime() > horizon ? { startsAt: w.startsAt, endsAt: new Date(horizon) } : w;
  const windowRows = SEED_LISTINGS.flatMap((l) => {
    if (l.windows === 'none') return [];
    if (l.windows === 'tomorrow') {
      return [
        { listingId: l.id, ...clamp(localWindow(10, 13, 1)) },
        { listingId: l.id, ...clamp(localWindow(16, 19, 1)) },
      ];
    }
    return [
      { listingId: l.id, ...clamp(soonWindow()) },
      { listingId: l.id, ...clamp(localWindow(10, 13, 1)) },
    ];
  }).filter((w) => w.endsAt.getTime() - Math.max(w.startsAt.getTime(), Date.now()) >= 30 * 60 * 1000);
  if (windowRows.length > 0) await db.insert(availabilityWindows).values(windowRows);

  // Every demo listing is fixed-price and expires 24h from seed time; refresh
  // on every run so a re-seed never leaves the feed stale. This also converts
  // a dev database seeded before auctions were retired (demo data only — real
  // auction rows are never rewritten; see migration 0009).
  for (const l of SEED_LISTINGS) {
    await db
      .update(listings)
      .set({
        saleType: 'fixed',
        startPriceCents: null,
        buyoutPriceCents: null,
        priceCents: l.priceCents,
        description: l.description,
        expiresAt: new Date(Date.now() + LISTING_LIFETIME_MS),
      })
      .where(eq(listings.id, l.id));
  }
  // Demo bids from the old auction demos are dropped with their auctions.
  await db.delete(bids).where(inArray(bids.listingId, ids));

  // Demo users get their fictional numbers even on a database seeded earlier.
  for (const [id, phone] of [
    [MAYA_ID, '+15205550101'],
    [JORDAN_ID, '+15205550102'],
    [SAM_ID, '+15205550103'],
  ] as const) {
    await db
      .update(users)
      .set({ phone, phoneVerifiedAt: new Date(), smsOptIn: true, smsOptInAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.phone)));
  }

  // Community demo posts: fixed ids, re-created every run with a fresh 24h.
  const P = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;
  const posts = [
    { n: 1, authorId: JORDAN_ID, kind: 'buying' as const, body: 'Anyone selling a mini fridge? Moving into Coronado this weekend.', agoMin: 25 },
    { n: 2, authorId: MAYA_ID, kind: 'selling' as const, body: 'Clearing out my closet before break — anyone interested in vintage band tees? Sizes S–L.', agoMin: 70 },
    { n: 3, authorId: SAM_ID, kind: 'buying' as const, body: 'Does anyone have a TI-84 they want to sell before finals?', agoMin: 180 },
  ];
  await db.delete(communityPosts).where(inArray(communityPosts.id, posts.map((p) => P(p.n))));
  await db.insert(communityPosts).values(
    posts.map((p) => {
      const createdAt = new Date(Date.now() - p.agoMin * 60 * 1000);
      return {
        id: P(p.n),
        campusId: CAMPUS_ID,
        authorId: p.authorId,
        kind: p.kind,
        body: p.body,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * HOUR),
      };
    }),
  );

  // Past sales and their completed meetups. Inserted after the browsable
  // listings so the feed is untouched: every row here is already `sold`.
  await db
    .insert(listings)
    .values(
      SEED_HISTORY.map((h) => ({
        id: H(h.n),
        sellerId: h.sellerId,
        campusId: CAMPUS_ID,
        title: h.title,
        description: 'Sample past sale, kept so profile activity is not empty.',
        category: 'other' as const,
        condition: 'good' as const,
        priceCents: h.priceCents,
        // Never 'active': nothing in this history set may reach the public
        // feed. A completed sale is 'sold'; the cancelled one simply lapsed,
        // which is what happens when a meetup falls through and nobody
        // relists. These rows have no photos, so a feed leak also breaks the
        // "every listing has a demo photo" acceptance check.
        status: (h.status === 'completed' ? 'sold' : 'expired') as 'sold' | 'expired',
        soldAt: h.status === 'completed' ? new Date(Date.now() - h.daysAgo * DAY) : null,
        createdAt: new Date(Date.now() - (h.daysAgo + 3) * DAY),
        isDemo: true,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(reservations)
    .values(
      SEED_HISTORY.map((h) => ({
        id: R(h.n),
        listingId: H(h.n),
        buyerId: h.buyerId,
        sellerId: h.sellerId,
        status: h.status,
        spotId: SPOT_UNION,
        startsAt: new Date(Date.now() - h.daysAgo * DAY),
        proposedById: h.buyerId,
        priceCents: h.priceCents,
        // A finished handoff has both confirmations and no live code.
        handoffCode: null,
        buyerConfirmedAt: h.status === 'completed' ? new Date(Date.now() - h.daysAgo * DAY) : null,
        sellerConfirmedAt: h.status === 'completed' ? new Date(Date.now() - h.daysAgo * DAY) : null,
        cancelledById: h.status === 'cancelled' ? h.buyerId : null,
        cancelReason: h.status === 'cancelled' ? 'Buyer could not make the time' : null,
        createdAt: new Date(Date.now() - (h.daysAgo + 1) * DAY),
      })),
    )
    .onConflictDoNothing();

  const total = await db.select({ id: listings.id }).from(listings);
  console.log(
    `seeded: 1 campus, 4 demo spots, 3 test users, ${SEED_LISTINGS.length} demo listings ` +
      `(${SEED_HISTORY.length} past sales for profile history, ` +
      `${total.length} listings in db), ${DEMO_ART.length} demo photos written`,
  );
}

// Run only when invoked directly (npm run db:seed) — scripts/e2e.ts imports seed().
const invokedDirectly =
  process.argv[1] != null && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  refuseIfBackendRunning()
    .then(() => seed())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
