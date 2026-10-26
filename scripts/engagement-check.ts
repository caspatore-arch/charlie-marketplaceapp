/**
 * Likes, shares, Hottest and the automatic Community listing post, checked
 * against a throwaway PGlite.
 *
 *   npm run test:engagement
 *
 * Covers: every new listing gets exactly one Community post (retries and
 * relists never duplicate it); likes are set-not-toggle and idempotent; Saved
 * is untouched by likes; Browse and Community read the SAME like, share and
 * comment numbers; preview comments (max two, most-discussed first); strictly
 * newest-first default vs Hottest; the share counting rule; and the expiry,
 * block, report and delete rules for listing posts.
 * Modules load with `await import(...)` after the env block (see save-check).
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR ??= 'backend/data/engagement-check-pg';
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SPOT_ID = '00000000-0000-4000-8000-0000000000b1';
const SELLER = '00000000-0000-4000-8000-0000000000d1';
const BUYER = '00000000-0000-4000-8000-0000000000d2';
const OTHER = '00000000-0000-4000-8000-0000000000d3';
const BLOCKED = '00000000-0000-4000-8000-0000000000d4';

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
  const { count, eq } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const { blocks, campuses, communityPosts, listingLikes, listings, meetupSpots, reports, savedListings, users } = await import(
    '../backend/db/schema'
  );
  const { appRouter } = await import('../backend/trpc/app-router');
  const { upsertListingPost } = await import('../backend/trpc/listing-post');

  await runMigrations();
  await db.insert(campuses).values({
    id: CAMPUS_ID,
    name: 'University of Arizona',
    slug: 'arizona',
    emailDomains: ['arizona.edu', 'demo.campus.test'],
    timezone: 'America/Phoenix',
    isDemo: true,
  });
  await db.insert(meetupSpots).values({
    id: SPOT_ID,
    campusId: CAMPUS_ID,
    name: 'Union',
    description: 'North doors',
    lat: 32.2,
    lng: -110.9,
    isDemo: true,
  });
  for (const [id, name] of [
    [SELLER, 'Seller'],
    [BUYER, 'Buyer'],
    [OTHER, 'Other'],
    [BLOCKED, 'Blocked'],
  ] as const) {
    await db.insert(users).values({
      id,
      email: `eng-${name.toLowerCase()}@demo.campus.test`,
      displayName: `${name} Test`,
      campusId: CAMPUS_ID,
      campusEmailVerifiedAt: new Date(),
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
  const blocked = await as(BLOCKED);

  const HOUR = 3_600_000;
  const create = (title: string, description?: string) =>
    seller.listing.create({
      title,
      description,
      category: 'dorm',
      condition: 'good',
      priceCents: 2500,
      saleType: 'fixed',
      isSellToday: false,
      photoUrls: ['/uploads/demo.jpg'],
      spotIds: [SPOT_ID],
      windows: [{ startsAt: new Date(Date.now() + HOUR), endsAt: new Date(Date.now() + 3 * HOUR) }],
    });
  const feedItems = async (sort: 'new' | 'hot', viewer = buyer) =>
    (await viewer.listing.feed({ campusId: CAMPUS_ID, sort, limit: 50 })).items;
  const communityItems = async (sort: 'new' | 'top' | 'hot', viewer = buyer) =>
    (await viewer.community.feed({ kind: 'selling', sort, limit: 50 })).items;
  const postRows = (listingId: string) =>
    db.select().from(communityPosts).where(eq(communityPosts.listingId, listingId));

  // --- every new listing gets exactly one compact Community post
  const lamp = await create('Desk lamp', 'Warm light, works great');
  const chair = await create('Office chair');
  check('creating a listing creates its Community post', (await postRows(lamp.id)).length === 1);
  const [lampRow] = await db.select().from(listings).where(eq(listings.id, lamp.id));
  await upsertListingPost(db, lampRow!);
  await upsertListingPost(db, lampRow!);
  check('retries never duplicate the post', (await postRows(lamp.id)).length === 1);
  const lampPost = (await communityItems('new')).find((p) => p.listing?.id === lamp.id);
  check('the post appears in the Sellers feed linked to the listing', !!lampPost && lampPost.kind === 'selling');
  check('caption is the listing description (live)', lampPost?.body === 'Warm light, works great');
  const chairPost = (await communityItems('new')).find((p) => p.listing?.id === chair.id);
  check('no description falls back to the title', chairPost?.body === 'Office chair');
  check('buyer-kind feed has no listing posts', (await buyer.community.feed({ kind: 'buying', sort: 'new', limit: 50 })).items.every((p) => !p.listing));
  await seller.listing.update({ id: lamp.id, description: 'Edited caption' });
  check('editing the listing updates the post caption live', (await communityItems('new')).find((p) => p.listing?.id === lamp.id)?.body === 'Edited caption');

  // text-post cap must not count automatic listing posts
  for (let i = 0; i < 5; i += 1) await seller.community.create({ kind: 'selling', body: `Text post number ${i + 1}` });
  // Five text posts succeeded although the seller has several live listing posts: they are not counted.
  const withListings = (await buyer.community.feed({ kind: 'selling', sort: 'new', limit: 50 })).items;
  const withoutListings = (await buyer.community.feed({ kind: 'selling', sort: 'new', includeListings: false, limit: 50 })).items;
  check('omitting includeListings includes listing posts', withListings.some((p) => p.listing) && withListings.some((p) => !p.listing));
  check('includeListings:true matches the default', (await buyer.community.feed({ kind: 'selling', sort: 'new', includeListings: true, limit: 50 })).items.length === withListings.length);
  check('includeListings:false excludes listing posts and keeps regular posts', withoutListings.length > 0 && withoutListings.every((p) => !p.listing) && withoutListings.length === withListings.filter((p) => !p.listing).length);
  const page1 = await buyer.community.feed({ kind: 'selling', sort: 'new', includeListings: false, limit: 2 });
  const page2 = await buyer.community.feed({ kind: 'selling', sort: 'new', includeListings: false, limit: 2, cursor: page1.nextCursor });
  check('includeListings:false paginates without listing posts or empty pages', page1.items.length === 2 && page2.items.length === 2 && [...page1.items, ...page2.items].every((p) => !p.listing));
  await rejects('the 6th text post is still capped', () => seller.community.create({ kind: 'selling', body: 'One too many' }), 'TOO_MANY_REQUESTS');

  // --- default Browse order is strictly newest first
  const newest = await feedItems('new');
  check('Browse default is newest first', newest[0]?.id === chair.id && newest[1]?.id === lamp.id);
  check('items carry zeroed engagement', newest.every((i) => i.engagement.likeCount === 0 && i.engagement.shareCount === 0 && i.engagement.topComments.length === 0));

  // --- likes: set-not-toggle, idempotent, public, separate from Saved
  const l1 = await buyer.listing.setLike({ id: lamp.id, liked: true });
  const l2 = await buyer.listing.setLike({ id: lamp.id, liked: true });
  check('a double like is one like', l1.likeCount === 1 && l2.likeCount === 1 && l2.viewerLiked);
  const l3 = await other.listing.setLike({ id: lamp.id, liked: true });
  check('a second person makes it two', l3.likeCount === 2);
  const [likeRows] = await db.select({ n: count() }).from(listingLikes).where(eq(listingLikes.listingId, lamp.id));
  check('exactly two like rows are stored', Number(likeRows!.n) === 2);
  const un = await buyer.listing.setLike({ id: lamp.id, liked: false });
  const un2 = await buyer.listing.setLike({ id: lamp.id, liked: false });
  check('unliking twice stays unliked and never goes negative', un.likeCount === 1 && un2.likeCount === 1 && !un2.viewerLiked);
  await buyer.listing.setLike({ id: lamp.id, liked: true });
  const [savedRows] = await db.select({ n: count() }).from(savedListings).where(eq(savedListings.listingId, lamp.id));
  check('liking does not save', Number(savedRows!.n) === 0);
  await buyer.listing.toggleSave({ id: chair.id, saved: true });
  check('saving does not like', (await feedItems('new')).find((i) => i.id === chair.id)?.engagement.likeCount === 0);
  await rejects('signed-out cannot like', () => anon.listing.setLike({ id: lamp.id, liked: true }), 'UNAUTHORIZED');

  // --- Browse and Community read the very same numbers
  const browseLamp = (await feedItems('new')).find((i) => i.id === lamp.id)!;
  const commLamp = (await communityItems('new')).find((p) => p.listing?.id === lamp.id)!;
  check('likes agree across Browse and Community', browseLamp.engagement.likeCount === 2 && commLamp.voteCount === 2 && commLamp.engagement?.likeCount === 2);
  check('the viewer’s own like agrees across views', browseLamp.engagement.viewerLiked && commLamp.viewerVoted);

  // --- comments: one thread, shared
  const q1 = await buyer.listingComment.add({ listingId: lamp.id, body: 'Still available?' });
  await new Promise((r) => setTimeout(r, 5));
  const q2 = await other.listingComment.add({ listingId: lamp.id, body: 'Does the bulb come with it?' });
  await new Promise((r) => setTimeout(r, 5));
  const q3 = await buyer.listingComment.add({ listingId: lamp.id, body: 'Can I pick up tonight?' });
  await seller.listingComment.add({ listingId: lamp.id, parentId: q2.id, body: 'Yes, bulb included.' });
  const withComments = (await feedItems('new')).find((i) => i.id === lamp.id)!;
  check('Browse shows at most two preview comments', withComments.engagement.topComments.length === 2);
  check('most-discussed comment comes first', withComments.engagement.topComments[0]?.id === q2.id);
  check('then the oldest remaining one', withComments.engagement.topComments[1]?.id === q1.id);
  check('replies are not previewed as top comments', !withComments.engagement.topComments.some((c) => c.id !== q2.id && c.id !== q1.id && c.id !== q3.id));
  check('commentCount counts replies too', withComments.engagement.commentCount === 4);
  check('a preview comment has author and text only', 'displayName' in withComments.engagement.topComments[0]!.author && !('voteCount' in withComments.engagement.topComments[0]!));
  const oneComment = (await feedItems('new')).find((i) => i.id === chair.id)!;
  check('no comments means an empty list, no placeholder', oneComment.engagement.topComments.length === 0);
  await buyer.listingComment.add({ listingId: chair.id, body: 'Nice chair' });
  check('one comment shows exactly one', (await feedItems('new')).find((i) => i.id === chair.id)!.engagement.topComments.length === 1);
  const commentedPost = (await communityItems('new')).find((p) => p.listing?.id === lamp.id)!;
  check('Community reads the same comment count and preview', commentedPost.commentCount === 4 && commentedPost.engagement?.topComments[0]?.id === q2.id);
  check('Community comment count matches the listing thread', (await anon.listingComment.list({ listingId: lamp.id })).length === 4);
  const post = (await postRows(lamp.id))[0]!;
  await rejects('no independent comment thread on the post', () => buyer.community.addComment({ postId: post.id, body: 'x' }), 'BAD_REQUEST');
  await rejects('no independent comment list on the post', () => buyer.community.comments({ postId: post.id }), 'BAD_REQUEST');
  await rejects('no independent upvote on the post', () => buyer.community.setVote({ id: post.id, voted: true }), 'BAD_REQUEST');
  await rejects('the post cannot be deleted separately', () => seller.community.remove({ id: post.id }), 'BAD_REQUEST');

  // --- shares: one honest rule, one per person per listing
  const s1 = await buyer.listing.recordShare({ id: lamp.id, via: 'share_sheet' });
  const s2 = await buyer.listing.recordShare({ id: lamp.id, via: 'copy_link' });
  check('first share counts', s1.counted && s1.shareCount === 1);
  check('repeat shares by the same person do not inflate', !s2.counted && s2.shareCount === 1);
  const s3 = await other.listing.recordShare({ id: lamp.id, via: 'copy_link' });
  check('a second person makes it two', s3.counted && s3.shareCount === 2);
  check('Browse and Community agree on shares', (await feedItems('new')).find((i) => i.id === lamp.id)!.engagement.shareCount === 2 && (await communityItems('new')).find((p) => p.listing?.id === lamp.id)!.engagement?.shareCount === 2);
  await rejects('signed-out shares are not counted', () => anon.listing.recordShare({ id: lamp.id, via: 'copy_link' }), 'UNAUTHORIZED');

  // --- Hottest vs newest
  const hot = await feedItems('hot');
  check('Hottest puts the engaged listing first', hot[0]?.id === lamp.id, hot.map((i) => i.title).join(' > '));
  check('newest is still strictly newest even with activity', (await feedItems('new'))[0]?.id === chair.id);
  const pageOne = await buyer.listing.feed({ campusId: CAMPUS_ID, sort: 'hot', limit: 1 });
  const pageTwo = await buyer.listing.feed({ campusId: CAMPUS_ID, sort: 'hot', limit: 1, cursor: pageOne.nextCursor });
  check('Hottest paginates without repeats', !!pageOne.nextCursor && pageOne.items[0]?.id !== pageTwo.items[0]?.id && pageTwo.nextCursor === undefined);
  await rejects('a bad Hottest cursor is rejected', () => buyer.listing.feed({ campusId: CAMPUS_ID, sort: 'hot', cursor: 'nope' }), 'BAD_REQUEST');
  const commHot = await communityItems('hot');
  check('Community Hottest uses the same listing activity', commHot[0]?.listing?.id === lamp.id);

  // --- visibility rules follow the listing
  await db.update(listings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(listings.id, chair.id));
  check('an expired listing leaves the live Browse feed', !(await feedItems('new')).some((i) => i.id === chair.id));
  check('...but its Community post stays up (archived)', (await communityItems('new')).some((p) => p.listing?.id === chair.id));
  const archivedLike = await buyer.listing.setLike({ id: chair.id, liked: true });
  check('an archived listing can still be liked', archivedLike.likeCount === 1 && archivedLike.viewerLiked);
  const chairPostRow = (await postRows(chair.id))[0]!;
  check('an archived listing post is still retrievable by id', (await buyer.community.byId({ id: chairPostRow.id })).id === chairPostRow.id);
  await db.update(listings).set({ status: 'expired' }).where(eq(listings.id, chair.id));
  const relisted = await seller.listing.relist({ id: chair.id, isSellToday: false, windows: [{ startsAt: new Date(Date.now() + HOUR), endsAt: new Date(Date.now() + 2 * HOUR) }] });
  check('relisting reuses the single post', (await postRows(chair.id)).length === 1 && relisted.id === chair.id);
  check('a relisted listing is back in Community', (await communityItems('new')).some((p) => p.listing?.id === chair.id));

  const mug = await create('Mug set');
  await db.update(listings).set({ status: 'sold' }).where(eq(listings.id, mug.id));
  check('a sold listing leaves Community', !(await communityItems('new')).some((p) => p.listing?.id === mug.id));

  await db.insert(blocks).values({ blockerId: SELLER, blockedId: BLOCKED });
  check('a blocked viewer does not see the seller in Browse', !(await feedItems('new', blocked)).some((i) => i.sellerId === SELLER));
  check('a blocked viewer does not see the seller’s listing posts', !(await communityItems('new', blocked)).some((p) => p.listing));
  await rejects('a blocked viewer cannot like the seller’s listing', () => blocked.listing.setLike({ id: lamp.id, liked: true }), 'NOT_FOUND');
  await rejects('a blocked viewer cannot share the seller’s listing', () => blocked.listing.recordShare({ id: lamp.id, via: 'copy_link' }), 'NOT_FOUND');

  // --- reporting a listing post reports the listing
  await buyer.community.report({ id: post.id, reason: 'scam' });
  const [rep] = await db.select().from(reports).where(eq(reports.reporterId, BUYER));
  check('a listing post is reported as the listing', rep?.targetListingId === lamp.id && rep?.targetPostId === null && rep?.targetUserId === SELLER);
  await rejects('the seller cannot report their own listing post', () => seller.community.report({ id: post.id, reason: 'scam' }), 'BAD_REQUEST');

  // --- profile "posts" and counts do not list automatic posts as text posts
  const profilePosts = await buyer.user.posts({ userId: SELLER });
  check('profile text posts exclude automatic listing posts', profilePosts.length === 5, `got ${profilePosts.length}`);

  await db.delete(listings).where(eq(listings.id, lamp.id));
  check('deleting a listing removes its post', (await postRows(lamp.id)).length === 0);

  await pglite?.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
