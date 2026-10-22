/**
 * Comment threads on listings and community posts, checked against a
 * throwaway PGlite.
 *
 *   npm run test:comments
 *
 * Covers: one-level replies (a reply to a reply attaches to the top-level
 * comment), cross-thread parents rejected, listing comment gates (campus
 * verification, closed listings, blocks), and who may delete.
 * Modules load with `await import(...)` after the env block (see save-check).
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR ??= 'backend/data/comments-check-pg';
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SELLER = '00000000-0000-4000-8000-0000000000d1';
const BUYER = '00000000-0000-4000-8000-0000000000d2';
const OTHER = '00000000-0000-4000-8000-0000000000d3';
const UNVERIFIED = '00000000-0000-4000-8000-0000000000d4';

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
  const { blocks, campuses, communityPosts, listings, users } = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');

  await runMigrations();
  await db.insert(campuses).values({
    id: CAMPUS_ID,
    name: 'University of Arizona',
    slug: 'arizona',
    emailDomains: ['arizona.edu', 'demo.campus.test'],
    timezone: 'America/Phoenix',
    isDemo: true,
  });
  for (const [id, name, verified] of [
    [SELLER, 'Seller', true],
    [BUYER, 'Buyer', true],
    [OTHER, 'Other', true],
    [UNVERIFIED, 'Unverified', false],
  ] as const) {
    await db.insert(users).values({
      id,
      email: `cm-${name.toLowerCase()}@demo.campus.test`,
      displayName: `${name} Test`,
      campusId: CAMPUS_ID,
      campusEmailVerifiedAt: verified ? new Date() : null,
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
  const unverified = await as(UNVERIFIED);

  const mkListing = async (title: string) =>
    (
      await db
        .insert(listings)
        .values({ sellerId: SELLER, campusId: CAMPUS_ID, title, category: 'dorm', condition: 'good', priceCents: 1000 })
        .returning()
    )[0]!;
  const lamp = await mkListing('Desk lamp');
  const chair = await mkListing('Chair');

  // --- listing comments
  const q = await buyer.listingComment.add({ listingId: lamp.id, body: 'Still available?' });
  check('top-level listing comment has no parent', q.parentId === null);
  const a = await seller.listingComment.add({ listingId: lamp.id, parentId: q.id, body: 'Yes!' });
  check('reply points at the question', a.parentId === q.id);
  const a2 = await buyer.listingComment.add({ listingId: lamp.id, parentId: a.id, body: 'Great' });
  check('reply to a reply attaches to the top-level comment', a2.parentId === q.id);
  await rejects('parent from another listing is rejected', () => buyer.listingComment.add({ listingId: chair.id, parentId: q.id, body: 'x' }), 'NOT_FOUND');
  await rejects('unverified account cannot comment', () => unverified.listingComment.add({ listingId: lamp.id, body: 'hi' }), 'FORBIDDEN');
  await rejects('signed-out cannot comment', () => anon.listingComment.add({ listingId: lamp.id, body: 'hi' }), 'UNAUTHORIZED');
  await rejects('empty body is rejected', () => buyer.listingComment.add({ listingId: lamp.id, body: '   ' }), 'BAD_REQUEST');

  const publicList = await anon.listingComment.list({ listingId: lamp.id });
  check('signed-out can read all three', publicList.length === 3);
  check('seller reply is labeled', publicList.find((c) => c.id === a.id)?.isSeller === true);
  check('signed-out can remove nothing', publicList.every((c) => !c.canRemove));
  const sellerView = await seller.listingComment.list({ listingId: lamp.id });
  check('seller can remove any comment on their listing', sellerView.every((c) => c.canRemove));

  await rejects('a stranger cannot delete someone else’s comment', () => other.listingComment.remove({ id: q.id }), 'FORBIDDEN');
  await seller.listingComment.remove({ id: a2.id });
  check('seller removed a buyer comment', (await anon.listingComment.list({ listingId: lamp.id })).length === 2);

  await db.insert(blocks).values({ blockerId: SELLER, blockedId: OTHER });
  await rejects('blocked user cannot comment on the seller’s listing', () => other.listingComment.add({ listingId: lamp.id, body: 'hi' }), 'NOT_FOUND');
  check('blocked user does not see the seller’s comments', (await other.listingComment.list({ listingId: lamp.id })).every((c) => c.author.id !== SELLER));

  await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, lamp.id));
  await rejects('sold listing is closed to new comments', () => buyer.listingComment.add({ listingId: lamp.id, body: 'hi' }), 'BAD_REQUEST');
  check('sold listing comments still readable', (await anon.listingComment.list({ listingId: lamp.id })).length === 2);
  await db.update(listings).set({ status: 'removed' }).where(eq(listings.id, lamp.id));
  await rejects('removed listing hides its comments', () => anon.listingComment.list({ listingId: lamp.id }), 'NOT_FOUND');

  // --- community replies
  const now = new Date();
  const mkPost = async (body: string) =>
    (
      await db
        .insert(communityPosts)
        .values({ campusId: CAMPUS_ID, authorId: SELLER, kind: 'selling', body, createdAt: now, expiresAt: new Date(now.getTime() + 3_600_000) })
        .returning()
    )[0]!;
  const post = await mkPost('Anyone want shirts?');
  const post2 = await mkPost('Mini fridge?');
  const c1 = await buyer.community.addComment({ postId: post.id, body: 'Me!' });
  check('top-level community comment has no parent', c1.parentId === null);
  const r1 = await seller.community.addComment({ postId: post.id, parentId: c1.id, body: 'DM me' });
  check('community reply points at the comment', r1.parentId === c1.id);
  const r2 = await buyer.community.addComment({ postId: post.id, parentId: r1.id, body: 'Sent' });
  check('community reply to a reply flattens', r2.parentId === c1.id);
  await rejects('community parent from another post is rejected', () => buyer.community.addComment({ postId: post2.id, parentId: c1.id, body: 'x' }), 'BAD_REQUEST');
  const thread = await buyer.community.comments({ postId: post.id });
  check('community list returns parentId', thread.filter((c) => c.parentId === c1.id).length === 2);
  check('post comment count includes replies', (await buyer.community.byId({ id: post.id })).commentCount === 3);

  await pglite?.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
