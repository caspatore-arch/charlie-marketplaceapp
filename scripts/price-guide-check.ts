/**
 * Price guide (Sell form bar) and listing autofill, checked against a
 * throwaway PGlite.
 *
 *   npx tsx scripts/price-guide-check.ts
 *
 * Modules are loaded with `await import(...)` after the env block because the
 * db client reads PGLITE_DIR when it is first imported.
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.PGLITE_DIR ??= 'backend/data/price-guide-check-pg';
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SELLER_ID = '00000000-0000-4000-8000-0000000000d1';
const DEMO_SELLER_ID = '00000000-0000-4000-8000-0000000000d2';
const VERIFIED_ID = '00000000-0000-4000-8000-0000000000d3';

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const { db, pglite } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const { campuses, listings, users } = await import('../backend/db/schema');
  const { priceGuide, trimmedMean } = await import('../backend/price-guide');
  const { appRouter } = await import('../backend/trpc/app-router');

  type Category = (typeof listings.category.enumValues)[number];
  type Status = (typeof listings.status.enumValues)[number];

  await runMigrations();
  await db.insert(campuses).values({
    id: CAMPUS_ID,
    name: 'University of Arizona',
    slug: 'arizona',
    emailDomains: ['arizona.edu', 'demo.campus.test'],
    timezone: 'America/Phoenix',
    isDemo: true,
  });
  await db.insert(users).values([
    { id: SELLER_ID, email: 'pg-seller@arizona.edu', displayName: 'Real Seller', campusId: CAMPUS_ID, isDemo: false },
    { id: DEMO_SELLER_ID, email: 'pg-demo@demo.campus.test', displayName: 'Demo Seller', campusId: CAMPUS_ID, isDemo: true },
    {
      id: VERIFIED_ID,
      email: 'pg-verified@arizona.edu',
      displayName: 'Verified',
      campusId: CAMPUS_ID,
      isDemo: false,
      campusEmailVerifiedAt: new Date(),
    },
  ]);

  async function add(
    category: Category,
    title: string,
    dollars: number,
    opts: { status?: Status; saleType?: 'fixed' | 'auction'; sellerId?: string } = {},
  ): Promise<string> {
    const [row] = await db
      .insert(listings)
      .values({
        sellerId: opts.sellerId ?? SELLER_ID,
        campusId: CAMPUS_ID,
        title,
        category,
        condition: 'good',
        priceCents: dollars * 100,
        status: opts.status ?? 'active',
        saleType: opts.saleType ?? 'fixed',
      })
      .returning();
    return row!.id;
  }

  // a) fewer than 3 comparables
  await add('dorm', 'Mini fridge', 100);
  await add('dorm', 'Rug', 50);
  const few = await priceGuide(db, { category: 'dorm' });
  check('a) <3 comparables: count 0', few.count === 0, JSON.stringify(few));
  check('a) <3 comparables: averageCents null', few.averageCents === null);
  check('a) <3 comparables: basis null', few.basis === null);

  // b) category basis (reset dorm by using a fresh category: 'books')
  await add('books', 'Calculus textbook', 10);
  await add('books', 'Chemistry notes', 20);
  await add('books', 'History reader', 30);
  await add('books', 'Novel box', 40);
  const cat = await priceGuide(db, { category: 'books' });
  check('b) category average is 2500', cat.averageCents === 2500, String(cat.averageCents));
  check('b) basis is category', cat.basis === 'category', String(cat.basis));
  check('b) count is 4', cat.count === 4);
  check('b) no demo sellers -> includesDemo false', cat.includesDemo === false);

  // c) similar titles
  await add('tech', 'Desk lamp', 10);
  await add('tech', 'LED lamp', 20);
  await add('tech', 'Reading lamp', 30);
  await add('tech', 'Gaming monitor', 300);
  await add('tech', 'Laptop stand', 500);
  const sim = await priceGuide(db, { category: 'tech', title: 'Bedside lamp' });
  check('c) similar_titles basis', sim.basis === 'similar_titles', String(sim.basis));
  check('c) average uses only lamps (2000)', sim.averageCents === 2000, String(sim.averageCents));
  check('c) count is 3', sim.count === 3);
  const noTitle = await priceGuide(db, { category: 'tech' });
  check('c) without title falls back to category', noTitle.basis === 'category' && noTitle.count === 5);
  const rare = await priceGuide(db, { category: 'tech', title: 'Zebra' });
  check('c) unmatched title falls back to category', rare.basis === 'category');

  // d) trimmedMean
  const small = [1000, 1000, 1000, 100000];
  check('d) <10 prices: no trimming', trimmedMean(small) === 25750, String(trimmedMean(small)));
  const ten = [100, 200, 300, 400, 500, 600, 700, 800, 900, 100000];
  // drops 100 and 100000 -> mean(200..900) = 550
  check('d) 10 prices: drops top and bottom', trimmedMean(ten) === 550, String(trimmedMean(ten)));

  // e) exclusions
  const clothesIds: string[] = [];
  for (const p of [10, 20, 30, 40]) clothesIds.push(await add('clothing', `Shirt ${p}`, p));
  await add('clothing', 'Auction jacket', 900, { saleType: 'auction' });
  await add('clothing', 'Removed coat', 900, { status: 'removed' });
  await add('shoes', 'Boots', 900);
  const clo = await priceGuide(db, { category: 'clothing' });
  check('e) auction/removed/other-category ignored', clo.count === 4 && clo.averageCents === 2500, JSON.stringify(clo));
  const excl = await priceGuide(db, { category: 'clothing', excludeListingId: clothesIds[3] });
  check('e) excludeListingId removes it', excl.count === 3 && excl.averageCents === 2000, JSON.stringify(excl));

  // f) demo flag
  await add('accessories', 'Hat', 10, { sellerId: DEMO_SELLER_ID });
  await add('accessories', 'Scarf', 20);
  await add('accessories', 'Belt', 30);
  const acc = await priceGuide(db, { category: 'accessories' });
  check('f) includesDemo true with a demo seller', acc.includesDemo === true && acc.count === 3, JSON.stringify(acc));

  // g) router
  const [verified] = await db.select().from(users).where((await import('drizzle-orm')).eq(users.id, VERIFIED_ID));
  const api = appRouter.createCaller({ db, user: verified! });
  const guide = await api.listing.priceGuide({ category: 'books' });
  check('g) listing.priceGuide via router', guide.averageCents === 2500);

  const allowed = ['clothing', 'shoes', 'jewelry', 'accessories', 'dorm', 'books', 'tech', 'other'];
  const draft = await api.listing.draftFromPhotos({ photoUrls: ['/api/uploads/x.jpg'] });
  check('g) draft is simulated', draft.simulated === true);
  check('g) draft category allowed', allowed.includes(draft.category), draft.category);
  check('g) priceLowCents <= priceHighCents', draft.priceLowCents <= draft.priceHighCents);

  for (let i = 2; i <= 15; i += 1) await api.listing.draftFromPhotos({ photoUrls: ['/api/uploads/x.jpg'] });
  let code = '';
  try {
    await api.listing.draftFromPhotos({ photoUrls: ['/api/uploads/x.jpg'] });
  } catch (err) {
    code = (err as { code?: string }).code ?? 'unknown';
  }
  check('g) 16th call in the hour is TOO_MANY_REQUESTS', code === 'TOO_MANY_REQUESTS', code);

  await pglite?.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
