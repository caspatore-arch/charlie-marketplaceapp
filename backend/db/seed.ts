/**
 * Idempotent demo seed. Everything it writes is flagged `isDemo` so the app can
 * badge it, and every row uses a fixed UUID so re-running never duplicates.
 *
 *   npm run db:seed     # safe to run repeatedly
 *   npm run db:reset    # wipes backend/data/pg first
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';

import { db } from './client';
import { runMigrations } from './migrate';
import {
  availabilityWindows,
  campuses,
  listingPhotos,
  listingSpots,
  listings,
  meetupSpots,
  users,
} from './schema';
import { LocalDiskStorage } from '../storage';
import { localDayBounds } from '../trpc/lib';

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

/** A clean 4:5 placeholder: solid ground, one simple silhouette, a DEMO mark. */
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
  <g opacity="0.9">
    <rect x="40" y="40" width="112" height="40" rx="20" fill="#5B4FCF"/>
    <text x="96" y="67" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="19" font-weight="700" letter-spacing="1.5" fill="#FFFFFF">DEMO</text>
  </g>
</svg>`;
}

/** Writes the 8 demo SVGs to disk and returns slug → served URL. */
async function writeDemoPhotos(): Promise<Record<string, string>> {
  const storage = new LocalDiskStorage();
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

/** A window at local [startHour, endHour) on the local day `dayOffset` days out. */
function localWindow(startHour: number, endHour: number, dayOffset = 0) {
  const { start } = localDayBounds(TIMEZONE);
  const dayStart = start.getTime() + dayOffset * 24 * HOUR;
  return { startsAt: new Date(dayStart + startHour * HOUR), endsAt: new Date(dayStart + endHour * HOUR) };
}

/** Always-today, always-in-the-future window so the demo has a bookable slot. */
function soonWindow() {
  const now = Date.now();
  const { end } = localDayBounds(TIMEZONE);
  const startsAt = new Date(now + 30 * 60 * 1000);
  const endsAt = new Date(Math.min(startsAt.getTime() + 3 * HOUR, end.getTime() - 60 * 1000));
  return { startsAt, endsAt };
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
        displayName: 'Maya Test',
        campusId: CAMPUS_ID,
        campusEmailVerifiedAt: new Date(),
        bio: 'Demo seller account. Junior, moving out in May.',
        isDemo: true,
      },
      {
        id: JORDAN_ID,
        email: 'jordan@demo.campus.test',
        displayName: 'Jordan Test',
        campusId: CAMPUS_ID,
        campusEmailVerifiedAt: new Date(),
        bio: 'Demo account. Buys and sells around the rec center.',
        isDemo: true,
      },
      {
        id: SAM_ID,
        email: 'sam@demo.campus.test',
        displayName: 'Sam Test',
        campusId: CAMPUS_ID,
        campusEmailVerifiedAt: new Date(),
        bio: 'Demo account used for the double-booking test.',
        isDemo: true,
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
        size: l.size ?? null,
        brand: l.brand ?? null,
        status: 'active' as const,
        isSellToday: l.isSellToday ?? false,
        expiresAt: l.isSellToday ? new Date(Date.now() + 24 * HOUR) : null,
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

  const windowRows = SEED_LISTINGS.flatMap((l) => {
    if (l.windows === 'none') return [];
    if (l.windows === 'tomorrow') {
      return [
        { listingId: l.id, ...localWindow(10, 13, 1) },
        { listingId: l.id, ...localWindow(16, 19, 1) },
      ];
    }
    return [
      { listingId: l.id, ...soonWindow() },
      { listingId: l.id, ...localWindow(10, 13, 1) },
    ];
  });
  if (windowRows.length > 0) await db.insert(availabilityWindows).values(windowRows);

  // "Sell today" expiry is relative to now, so refresh it on every seed run.
  for (const l of SEED_LISTINGS.filter((x) => x.isSellToday)) {
    await db
      .update(listings)
      .set({ expiresAt: new Date(Date.now() + 24 * HOUR) })
      .where(eq(listings.id, l.id));
  }

  const total = await db.select({ id: listings.id }).from(listings);
  console.log(
    `seeded: 1 campus, 4 demo spots, 3 test users, ${SEED_LISTINGS.length} demo listings ` +
      `(${total.length} listings in db), ${DEMO_ART.length} demo photos written`,
  );
}

// Run only when invoked directly (npm run db:seed) — scripts/e2e.ts imports seed().
const invokedDirectly =
  process.argv[1] != null && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
