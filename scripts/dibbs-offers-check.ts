/**
 * "Get a Dibbs offer" requests, checked against a throwaway PGlite.
 *
 *   npm run test:dibbs-offers
 *
 * Covers: private access and media privacy (upload rules, signed links, nothing
 * in public feeds), staff permissions and version conflicts, the estimate to
 * final-offer flow, meetup rules, the shared lock with a linked public listing
 * (booking vs Dibbs hold), estimate expiry, the email queue, and that an
 * ordinary listing still lives 24 hours.
 * Modules load with `await import(...)` after the env block (see archive-check).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR = 'backend/data/dibbs-offers-check-pg';
process.env.DATABASE_URL = ''; // never touch a hosted database
process.env.NODE_ENV = 'test';
process.env.PRIVATE_UPLOADS_DIR = 'backend/data/dibbs-offers-check-private';
process.env.DIBBS_OFFERS_EMAIL = 'team@example.test';
process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://dibbs.example.test';
process.env.RATE_LIMIT_UPLOADS_PER_MIN = '1000';
delete process.env.EMAIL_MODE;
delete process.env.S3_BUCKET;
delete process.env.S3_PRIVATE_BUCKET;
delete process.env.PRIVATE_MEDIA_SECRET;
fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
fs.rmSync(path.resolve(process.env.PRIVATE_UPLOADS_DIR), { recursive: true, force: true });

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_CAMPUS_ID = '00000000-0000-4000-8000-0000000000ab';
const SPOT_A = '00000000-0000-4000-8000-0000000000b1';
const SPOT_B = '00000000-0000-4000-8000-0000000000b2';
const SPOT_INACTIVE = '00000000-0000-4000-8000-0000000000b3';
const SPOT_ELSEWHERE = '00000000-0000-4000-8000-0000000000b4';
const S1 = '00000000-0000-4000-8000-0000000000d1'; // seller: media, privacy, lifecycle
const S2 = '00000000-0000-4000-8000-0000000000d2'; // seller: linked listings
const S3 = '00000000-0000-4000-8000-0000000000d3'; // seller: email
const OTHER = '00000000-0000-4000-8000-0000000000d4'; // another student, not staff
const BUYER = '00000000-0000-4000-8000-0000000000d5';
const STAFF_A = '00000000-0000-4000-8000-0000000000e1';
const STAFF_B = '00000000-0000-4000-8000-0000000000e2';
const NOPOST = '00000000-0000-4000-8000-0000000000f1'; // no email at all: no posting access
const BLOCKED = '00000000-0000-4000-8000-0000000000f2';
process.env.DIBBS_STAFF_USER_IDS = `${STAFF_A},${STAFF_B}`;

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
    check(label, got === code, `got ${got}${got === code ? '' : ` (${(e as Error).message?.slice(0, 120)})`}`);
  }
}

/* ------------------------------------------------------- media fixtures */

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
function box(type: string, body: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
/** ftyp + moov(mvhd). Version 0 by default; timescale 1000 means duration is in ms. */
function mp4(durationMs: number, version: 0 | 1 = 0, timescale = 1000): Buffer {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isom')]));
  const units = Math.round((durationMs / 1000) * timescale);
  let body: Buffer;
  if (version === 0) {
    body = Buffer.alloc(100);
    body.writeUInt32BE(timescale, 12);
    body.writeUInt32BE(units, 16);
  } else {
    body = Buffer.alloc(112);
    body[0] = 1;
    body.writeUInt32BE(timescale, 20);
    body.writeBigUInt64BE(BigInt(units), 24);
  }
  return Buffer.concat([ftyp, box('moov', box('mvhd', body))]);
}

async function main() {
  const { and, eq } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const schema = await import('../backend/db/schema');
  const {
    availabilityWindows,
    campuses,
    dibbsOfferEvents,
    dibbsOfferMedia,
    dibbsOfferNotifications,
    dibbsOfferRequests,
    listingSpots,
    listings,
    meetupSpots,
    reservations,
    sessions,
    users,
  } = schema;
  const { appRouter } = await import('../backend/trpc/app-router');
  const { upsertListingPost } = await import('../backend/trpc/listing-post');
  const { __resetExpirySweepForTests } = await import('../backend/trpc/lib');
  const { hashToken } = await import('../backend/trpc/create-context');
  const { app } = await import('../backend/hono');
  const media = await import('../backend/dibbs/media');
  const { dispatchDibbsEmails } = await import('../backend/dibbs/notify');
  const { dibbsHoldsListing } = await import('../backend/dibbs/hold');
  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');

  await runMigrations();

  /* ---------------------------------------------------------- fixtures */

  await db.insert(campuses).values([
    { id: CAMPUS_ID, name: 'University of Arizona', slug: 'arizona', emailDomains: ['arizona.edu', 'demo.campus.test'], timezone: 'America/Phoenix', isDemo: true },
    { id: OTHER_CAMPUS_ID, name: 'Other U', slug: 'other-u', emailDomains: ['other.test'], timezone: 'America/Phoenix', isDemo: true },
  ]);
  for (const [id, campusId, name, isActive] of [
    [SPOT_A, CAMPUS_ID, 'Union', true],
    [SPOT_B, CAMPUS_ID, 'Library', true],
    [SPOT_INACTIVE, CAMPUS_ID, 'Closed gate', false],
    [SPOT_ELSEWHERE, OTHER_CAMPUS_ID, 'Far away', true],
  ] as const) {
    await db.insert(meetupSpots).values({ id, campusId, name, description: name, lat: 32.2, lng: -110.9, isActive, isDemo: true });
  }
  const emailOf = (id: string) => `dibbs-${id.slice(-4)}@demo.campus.test`;
  for (const [id, name] of [
    [S1, 'Seller One'],
    [S2, 'Seller Two'],
    [S3, 'Seller Three'],
    [OTHER, 'Other Student'],
    [BUYER, 'Buyer'],
    [STAFF_A, 'Staff Ann'],
    [STAFF_B, 'Staff Ben'],
  ] as const) {
    await db.insert(users).values({
      id,
      email: emailOf(id),
      displayName: name,
      campusId: CAMPUS_ID,
      campusEmailVerifiedAt: new Date(),
      isDemo: true,
    });
  }
  await db.insert(users).values({ id: NOPOST, email: null, displayName: 'No Email', campusId: CAMPUS_ID, isDemo: true });
  await db.insert(users).values({
    id: BLOCKED,
    email: emailOf(BLOCKED),
    displayName: 'Blocked',
    campusId: CAMPUS_ID,
    campusEmailVerifiedAt: new Date(),
    postingAccess: 'blocked',
    isDemo: true,
  });

  const as = async (id: string) => {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    return appRouter.createCaller({ db, user: u! });
  };
  const anon = appRouter.createCaller({ db, user: null });
  const s1 = await as(S1);
  const s2 = await as(S2);
  const s3 = await as(S3);
  const other = await as(OTHER);
  const buyer = await as(BUYER);
  const staffA = await as(STAFF_A);
  const staffB = await as(STAFF_B);
  const nopost = await as(NOPOST);
  const blocked = await as(BLOCKED);
  type Act = Parameters<typeof staffA.dibbsStaff.act>[0]['action'];

  const tokens = new Map<string, string>();
  const tokenFor = async (userId: string) => {
    const hit = tokens.get(userId);
    if (hit) return hit;
    const token = crypto.randomBytes(32).toString('hex');
    await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) });
    tokens.set(userId, token);
    return token;
  };
  const upload = async (token: string | null, bytes: Buffer, type: string, name = 'file') => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(bytes)], name, { type }));
    return app.request('/api/private-media', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
  };
  type UploadJson = { id: string; kind: string; durationMs: number | null; url: string; error?: string };

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const slotAt = (ms: number) => new Date(Math.ceil((Date.now() + ms) / 900_000) * 900_000);
  const T1 = slotAt(3 * HOUR);
  const T2 = slotAt(4 * HOUR);
  const T4 = slotAt(5 * HOUR);
  const T5 = slotAt(6 * HOUR);
  const T6 = slotAt(7 * HOUR);
  const T7 = slotAt(9 * HOUR);

  /** An uploaded-but-unattached media row without a file (for limit and ownership checks). */
  const dbMedia = async (uploaderId: string, kind: 'image' | 'video' = 'image') => {
    const [m] = await db
      .insert(dibbsOfferMedia)
      .values({
        uploaderId,
        kind,
        contentType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
        storageKey: `private/${crypto.randomUUID()}${kind === 'image' ? '.jpg' : '.mp4'}`,
        bytes: 100,
        durationMs: kind === 'video' ? 5000 : null,
      })
      .returning();
    return m!.id;
  };
  const mkReq = async (c: typeof s1, patch: Partial<Parameters<typeof s1.dibbsOffer.create>[0]> = {}) =>
    c.dibbsOffer.create({
      clientRequestId: crypto.randomUUID(),
      itemName: 'Test item',
      mediaIds: patch.listingId ? [] : [await dbMedia(c === s1 ? S1 : c === s2 ? S2 : S3)],
      ...patch,
    });
  /** Staff action with the latest version (unless one is given). */
  const act = async (who: typeof staffA, id: string, action: Act, version?: number) => {
    const v = version ?? (await who.dibbsStaff.byId({ id })).version;
    return who.dibbsStaff.act({ id, expectedVersion: v, action });
  };
  const rowOf = async (id: string) => (await db.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.id, id)))[0]!;
  const listingStatus = async (id: string) => (await db.select().from(listings).where(eq(listings.id, id)))[0]!.status;

  const mkListing = async (sellerId: string, title: string, patch: Partial<typeof listings.$inferInsert> = {}) => {
    const [l] = await db
      .insert(listings)
      .values({
        sellerId,
        campusId: CAMPUS_ID,
        title,
        category: 'dorm',
        condition: 'good',
        priceCents: 2000,
        expiresAt: new Date(Date.now() + 12 * HOUR),
        ...patch,
      })
      .returning();
    await db.insert(listingSpots).values({ listingId: l!.id, spotId: SPOT_A });
    await db.insert(availabilityWindows).values({ listingId: l!.id, startsAt: slotAt(30 * 60_000), endsAt: slotAt(10 * HOUR) });
    await upsertListingPost(db, l!);
    return l!;
  };

  /* ============================== PRIVATE ACCESS & MEDIA PRIVACY ============================== */
  console.log('\n# private access and media');

  // unit: video length and validation
  check('videoDurationMs reads a 10 s mp4 (mvhd v0)', media.videoDurationMs(mp4(10_000)) === 10_000, String(media.videoDurationMs(mp4(10_000))));
  check('videoDurationMs reads a 45 s mp4', media.videoDurationMs(mp4(45_000)) === 45_000);
  check('videoDurationMs honours the timescale (v0, 600/s)', media.videoDurationMs(mp4(12_000, 0, 600)) === 12_000);
  check('videoDurationMs reads mvhd v1', media.videoDurationMs(mp4(20_000, 1, 1000)) === 20_000);
  check('videoDurationMs returns null with no moov box', media.videoDurationMs(Buffer.concat([jpeg(), Buffer.alloc(40)])) === null);
  check('videoDurationMs returns null on a truncated box', media.videoDurationMs(mp4(5000).subarray(0, 40)) === null);
  check('videoDurationMs returns null for a zero timescale', media.videoDurationMs(mp4(5000, 0, 0)) === null);

  const vOk = media.validatePrivateMedia(jpeg(), 'image/jpeg');
  check('validatePrivateMedia accepts a jpeg', vOk.kind === 'image' && vOk.ext === '.jpg' && vOk.durationMs === null);
  check('validatePrivateMedia accepts a png', media.validatePrivateMedia(png(), 'image/png').ext === '.png');
  const vVid = media.validatePrivateMedia(mp4(10_000), 'video/mp4');
  check('validatePrivateMedia accepts a 10 s mp4 and reports its length', vVid.kind === 'video' && vVid.durationMs === 10_000);
  const throwsStatus = (fn: () => unknown) => {
    try {
      fn();
      return -1;
    } catch (e) {
      return e instanceof media.PrivateMediaError ? e.status : -2;
    }
  };
  check('validatePrivateMedia: text is 415', throwsStatus(() => media.validatePrivateMedia(Buffer.from('hello hello hello'), 'text/plain')) === 415);
  check('validatePrivateMedia: png bytes claimed as jpeg is 415', throwsStatus(() => media.validatePrivateMedia(png(), 'image/jpeg')) === 415);
  check('validatePrivateMedia: 45 s video is 400', throwsStatus(() => media.validatePrivateMedia(mp4(45_000), 'video/mp4')) === 400);
  check('validatePrivateMedia: 30.4 s video still passes (rounding grace)', throwsStatus(() => media.validatePrivateMedia(mp4(30_400), 'video/mp4')) === -1);
  check('validatePrivateMedia: a video with no readable length is 415', throwsStatus(() => media.validatePrivateMedia(Buffer.concat([box('ftyp', Buffer.alloc(12)), Buffer.alloc(40)]), 'video/mp4')) === 415);
  check('validatePrivateMedia: an image over 8 MB is 413', throwsStatus(() => media.validatePrivateMedia(Buffer.concat([jpeg(), Buffer.alloc(media.PRIVATE_IMAGE_MAX_BYTES)]), 'image/jpeg')) === 413);

  // HTTP upload
  const tokS1 = await tokenFor(S1);
  const noAuth = await upload(null, jpeg(), 'image/jpeg');
  check('upload without sign-in is 401', noAuth.status === 401, String(noAuth.status));
  check('upload of a text file is 415', (await upload(tokS1, Buffer.from('this is just text, not media'), 'text/plain')).status === 415);
  check('upload with a lying content type (png bytes as jpeg) is 415', (await upload(tokS1, png(), 'image/jpeg')).status === 415);
  const tooLong = await upload(tokS1, mp4(45_000), 'video/mp4');
  check('upload of a 45 s video is 400', tooLong.status === 400, String(tooLong.status));
  const okVideoRes = await upload(tokS1, mp4(10_000), 'video/mp4', 'clip.mp4');
  const okVideo = (await okVideoRes.json()) as UploadJson;
  check('upload of a 10 s video is OK with its length read from the file', okVideoRes.status === 200 && okVideo.kind === 'video' && Math.abs((okVideo.durationMs ?? 0) - 10_000) <= 500, `${okVideoRes.status} ${okVideo.durationMs}`);
  const photoRes1 = await upload(tokS1, jpeg(), 'image/jpeg', 'a.jpg');
  const photo1 = (await photoRes1.json()) as UploadJson;
  const photo2 = (await (await upload(tokS1, png(), 'image/png', 'b.png')).json()) as UploadJson;
  const spare = (await (await upload(tokS1, jpeg(), 'image/jpeg', 'spare.jpg')).json()) as UploadJson;
  check('upload of a jpeg and a png is OK', photoRes1.status === 200 && !!photo1.id && !!photo2.id);

  // signed GET
  const getUrl = async (url: string, headers: Record<string, string> = {}) => app.request(url, { headers });
  const signedGet = await getUrl(photo1.url);
  const signedBytes = Buffer.from(await signedGet.arrayBuffer());
  check('a signed link serves the private file', signedGet.status === 200 && signedGet.headers.get('content-type') === 'image/jpeg' && signedBytes.byteLength > 60, String(signedGet.status));
  check('private files are served with nosniff and a private cache', signedGet.headers.get('x-content-type-options') === 'nosniff' && /private/.test(signedGet.headers.get('cache-control') ?? ''));
  const rangeRes = await getUrl(okVideo.url, { range: 'bytes=0-3' });
  check('video links support Range requests', rangeRes.status === 206 && (await rangeRes.arrayBuffer()).byteLength === 4, String(rangeRes.status));
  const tampered = photo1.url.replace(/s=(.)/, (_m, c: string) => `s=${c === 'A' ? 'B' : 'A'}`);
  check('a tampered signature is 403', (await getUrl(tampered)).status === 403);
  const bumped = photo1.url.replace(/e=(\d+)/, (_m, n: string) => `e=${Number(n) + 3600}`);
  check('a signature with a changed expiry is 403', (await getUrl(bumped)).status === 403);
  check('a link with no signature is 403', (await getUrl(photo1.url.split('?')[0]!)).status === 403);
  check('a signature for one file does not open another', (await getUrl(photo1.url.replace(photo1.id, photo2.id))).status === 403);
  const oldPath = media.signedMediaPath(photo1.id, Date.now() - 2 * media.SIGNED_URL_TTL_MS);
  const oldE = /e=(\d+)/.exec(oldPath)![1];
  const oldS = /s=([^&]+)/.exec(oldPath)![1];
  check('verifySignedMedia: a past expiry is false', media.verifySignedMedia(photo1.id, oldE, oldS) === false);
  check('verifySignedMedia: the same link was valid back then', media.verifySignedMedia(photo1.id, oldE, oldS, Date.now() - 2 * media.SIGNED_URL_TTL_MS) === true);
  check('an expired link over HTTP is 403', (await getUrl(oldPath)).status === 403);

  // not reachable through the public uploads route
  const [photo1Row] = await db.select().from(dibbsOfferMedia).where(eq(dibbsOfferMedia.id, photo1.id));
  const keyBase = photo1Row!.storageKey.slice('private/'.length);
  check('the private file is on disk in the private directory', fs.existsSync(path.join(path.resolve(process.env.PRIVATE_UPLOADS_DIR!), keyBase)));
  for (const probe of [keyBase, photo1.id, `${photo1.id}.jpg`, encodeURIComponent(photo1Row!.storageKey), `..%2F${keyBase}`]) {
    const r = await app.request(`/api/uploads/${probe}`);
    check(`GET /api/uploads/${probe.slice(0, 18)}... does not reach private media`, r.status === 404 || r.status === 400, String(r.status));
  }

  // attach rules
  await rejects('another student cannot attach someone else’s unattached media', () => other.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Stolen photo', mediaIds: [spare.id] }), 'BAD_REQUEST');
  await rejects('create refuses an unknown media id', () => s1.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Ghost photo', mediaIds: [crypto.randomUUID()] }), 'BAD_REQUEST');
  const nine = await Promise.all(Array.from({ length: 9 }, () => dbMedia(S1)));
  await rejects('9 photos on one request is refused', () => s1.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Too many photos', mediaIds: nine }), 'BAD_REQUEST');
  const twoVids = [await dbMedia(S1, 'video'), await dbMedia(S1, 'video')];
  await rejects('2 videos on one request is refused', () => s1.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Two videos', mediaIds: twoVids }), 'BAD_REQUEST');
  await rejects('more than 9 media ids is refused', () => s1.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Ten files', mediaIds: [...nine, spare.id] }), 'BAD_REQUEST');
  const maxReq = await s1.dibbsOffer.create({
    clientRequestId: crypto.randomUUID(),
    itemName: 'Boundary request',
    mediaIds: [...nine.slice(0, 8), twoVids[0]!],
  });
  check('8 photos and 1 video is allowed', maxReq.media.length === 9);
  await s1.dibbsOffer.withdraw({ id: maxReq.id });

  // create: access, content, idempotency
  await rejects('create requires sign-in', () => anon.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Anon item', mediaIds: [spare.id] }), 'UNAUTHORIZED');
  await rejects('create needs posting access (no verified email)', () => nopost.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'No email item', mediaIds: [spare.id] }), 'FORBIDDEN');
  await rejects('create is refused for a blocked account', () => blocked.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Blocked item', mediaIds: [spare.id] }), 'FORBIDDEN');
  await rejects('create needs a photo, a video or a listing', () => s1.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Nothing attached' }), 'BAD_REQUEST');

  const cid1 = crypto.randomUUID();
  const R1 = await s1.dibbsOffer.create({
    clientRequestId: cid1,
    itemName: 'Walnut Standing Desk',
    condition: 'good',
    specs: 'Uplift V2, 48 inch',
    description: 'Works great.',
    mediaIds: [photo1.id, photo2.id, okVideo.id],
  });
  check('create with media ids works and starts as submitted', R1.status === 'submitted' && R1.media.length === 3 && R1.version === 1);
  check('request media come back as signed private links, in order', R1.media.every((m) => m.url.startsWith('/api/private-media/')) && R1.media[0]!.id === photo1.id && R1.media[2]!.kind === 'video');
  const R1again = await s1.dibbsOffer.create({ clientRequestId: cid1, itemName: 'Walnut Standing Desk', mediaIds: [photo1.id] });
  const R1rows = await db.select().from(dibbsOfferRequests).where(and(eq(dibbsOfferRequests.sellerId, S1), eq(dibbsOfferRequests.clientRequestId, cid1)));
  check('the same clientRequestId twice gives the same request and one row', R1again.id === R1.id && R1rows.length === 1);
  const R1attached = await db.select().from(dibbsOfferMedia).where(eq(dibbsOfferMedia.requestId, R1.id));
  check('the replay did not re-attach or duplicate media', R1attached.length === 3);
  await rejects('an attached media id cannot be claimed by another request', () => s1.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Reuse photo', mediaIds: [photo1.id] }), 'BAD_REQUEST');
  const spareReq = await s1.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Spare photo item', mediaIds: [spare.id] });
  await s1.dibbsOffer.withdraw({ id: spareReq.id });

  // other students
  await rejects('another student gets NOT_FOUND on byId (not FORBIDDEN)', () => other.dibbsOffer.byId({ id: R1.id }), 'NOT_FOUND');
  check('another student’s mine list does not include it', !(await other.dibbsOffer.mine()).some((r) => r.id === R1.id));
  check('the seller’s mine list includes it with a private cover link', (await s1.dibbsOffer.mine()).some((r) => r.id === R1.id && r.coverUrl?.startsWith('/api/private-media/')));
  await rejects('another student cannot withdraw it (NOT_FOUND)', () => other.dibbsOffer.withdraw({ id: R1.id }), 'NOT_FOUND');
  await rejects('another student cannot reply to it (NOT_FOUND)', () => other.dibbsOffer.reply({ id: R1.id, message: 'hi' }), 'NOT_FOUND');
  await rejects('non-staff: dibbsStaff.queue is FORBIDDEN', () => other.dibbsStaff.queue({ filter: 'all' }), 'FORBIDDEN');
  await rejects('non-staff: dibbsStaff.byId is FORBIDDEN', () => other.dibbsStaff.byId({ id: R1.id }), 'FORBIDDEN');
  await rejects('non-staff: dibbsStaff.act is FORBIDDEN', () => other.dibbsStaff.act({ id: R1.id, expectedVersion: 1, action: { type: 'start_review' } }), 'FORBIDDEN');
  await rejects('the seller themself is not staff: dibbsStaff.act is FORBIDDEN', () => s1.dibbsStaff.act({ id: R1.id, expectedVersion: 1, action: { type: 'start_review' } }), 'FORBIDDEN');
  await rejects('non-staff: dibbsStaff.addNote is FORBIDDEN', () => other.dibbsStaff.addNote({ id: R1.id, message: 'hi' }), 'FORBIDDEN');
  await rejects('signed-out: dibbsStaff.queue is UNAUTHORIZED', () => anon.dibbsStaff.queue({ filter: 'all' }), 'UNAUTHORIZED');
  check('the request did not move after the refused staff calls', (await rowOf(R1.id)).version === 1 && (await rowOf(R1.id)).status === 'submitted');
  check('dibbsStaff.amI is true for staff and false for students', (await staffA.dibbsStaff.amI()).isStaff && !(await other.dibbsStaff.amI()).isStaff && !(await s1.dibbsStaff.amI()).isStaff);
  const queueAll = await staffA.dibbsStaff.queue({ filter: 'all' });
  check('staff see the request in the queue with the seller’s name', queueAll.some((r) => r.id === R1.id && r.sellerName === 'Seller One'));
  const staffView = await staffA.dibbsStaff.byId({ id: R1.id });
  const staffMediaGet = await getUrl(staffView.media[0]!.url);
  check('staff get working signed links for the request’s media', staffMediaGet.status === 200);

  /* ============================== STAFF PERMISSIONS, ESTIMATES, FINAL OFFER ============================== */
  console.log('\n# staff conflicts and estimate flow');

  const reviewed = await act(staffA, R1.id, { type: 'start_review' }, 1);
  check('staff A start_review with the right version works and assigns them', reviewed.status === 'in_review' && reviewed.assignedStaff?.id === STAFF_A && reviewed.version === 2);
  await rejects('staff B acting with the old version gets CONFLICT', () => staffB.dibbsStaff.act({ id: R1.id, expectedVersion: 1, action: { type: 'send_estimate', lowCents: 5000, highCents: 5000 } }), 'CONFLICT');
  check('the stale action changed nothing', (await rowOf(R1.id)).status === 'in_review' && (await rowOf(R1.id)).estimateVersion === 0);
  await rejects('start_review twice is a CONFLICT (already in review)', () => act(staffB, R1.id, { type: 'start_review' }), 'CONFLICT');
  await rejects('send_estimate with low > high is BAD_REQUEST', () => act(staffB, R1.id, { type: 'send_estimate', lowCents: 9000, highCents: 5000 }), 'BAD_REQUEST');
  await rejects('send_estimate with low 0 is BAD_REQUEST', () => act(staffB, R1.id, { type: 'send_estimate', lowCents: 0, highCents: 5000 }), 'BAD_REQUEST');
  await rejects('send_estimate over the $5,000 ceiling is BAD_REQUEST', () => act(staffB, R1.id, { type: 'send_estimate', lowCents: 100, highCents: 500_001 }), 'BAD_REQUEST');
  const exact = await act(staffB, R1.id, { type: 'send_estimate', lowCents: 6000, highCents: 6000 });
  check('an exact estimate (low == high) works and the status is offered', exact.status === 'offered' && exact.estimate?.kind === 'exact' && exact.estimate.lowCents === 6000 && exact.estimate.version === 1);
  check('the estimate has an expiry about 48 hours out', !!exact.estimate?.expiresAt && Math.abs(exact.estimate.expiresAt.getTime() - Date.now() - 48 * HOUR) < 60_000);
  const ranged = await act(staffA, R1.id, { type: 'send_estimate', lowCents: 5000, highCents: 8000, message: 'Revised after a closer look' });
  check('staff can revise the estimate (a range) and its version bumps', ranged.estimate?.kind === 'range' && ranged.estimate.version === 2 && ranged.status === 'offered');

  const spotOk = { spotId: SPOT_A, startsAt: slotAt(2 * DAY) };
  await rejects('seller answering with the old estimate version gets CONFLICT (propose)', () => s1.dibbsOffer.proposeMeetup({ id: R1.id, estimateVersion: 1, ...spotOk }), 'CONFLICT');
  await rejects('seller answering with the old estimate version gets CONFLICT (decline)', () => s1.dibbsOffer.declineEstimate({ id: R1.id, estimateVersion: 1 }), 'CONFLICT');
  check('the stale seller answers changed nothing', (await rowOf(R1.id)).status === 'offered');

  await rejects('seller proposeMeetup off the 15-minute grid is BAD_REQUEST', () => s1.dibbsOffer.proposeMeetup({ id: R1.id, estimateVersion: 2, spotId: SPOT_A, startsAt: new Date(spotOk.startsAt.getTime() + 60_000) }), 'BAD_REQUEST');
  await rejects('seller proposeMeetup in the past is BAD_REQUEST', () => s1.dibbsOffer.proposeMeetup({ id: R1.id, estimateVersion: 2, spotId: SPOT_A, startsAt: slotAt(-HOUR) }), 'BAD_REQUEST');
  await rejects('seller proposeMeetup beyond 7 days is BAD_REQUEST', () => s1.dibbsOffer.proposeMeetup({ id: R1.id, estimateVersion: 2, spotId: SPOT_A, startsAt: slotAt(8 * DAY) }), 'BAD_REQUEST');
  await rejects('seller proposeMeetup at an inactive spot is BAD_REQUEST', () => s1.dibbsOffer.proposeMeetup({ id: R1.id, estimateVersion: 2, spotId: SPOT_INACTIVE, startsAt: spotOk.startsAt }), 'BAD_REQUEST');
  await rejects('seller proposeMeetup at another campus’s spot is BAD_REQUEST', () => s1.dibbsOffer.proposeMeetup({ id: R1.id, estimateVersion: 2, spotId: SPOT_ELSEWHERE, startsAt: spotOk.startsAt }), 'BAD_REQUEST');
  await rejects('staff propose_meetup with an off-grid time is BAD_REQUEST', () => act(staffA, R1.id, { type: 'propose_meetup', spotId: SPOT_A, startsAt: new Date(spotOk.startsAt.getTime() + 60_000) }), 'BAD_REQUEST');
  const proposed = await s1.dibbsOffer.proposeMeetup({ id: R1.id, estimateVersion: 2, ...spotOk });
  check('a valid seller proposal is meetup_proposed, proposed by the seller', proposed.status === 'meetup_proposed' && proposed.meetup?.proposedBy === 'seller' && proposed.meetup.confirmed === false);
  check('agreeing to meet is not accepting a price', proposed.finalAcceptedCents === null && proposed.finalOffer === null);
  await rejects('the seller cannot accept their own proposal (acceptMeetup needs a Dibbs proposal)', () => s1.dibbsOffer.acceptMeetup({ id: R1.id, expectedVersion: proposed.version }), 'CONFLICT');

  const confirmed = await act(staffB, R1.id, { type: 'confirm_meetup' });
  check('staff confirm_meetup moves to meetup_confirmed', confirmed.status === 'meetup_confirmed' && confirmed.meetup?.confirmed === true);
  await rejects('record_completed right after the meetup is confirmed is CONFLICT', () => act(staffA, R1.id, { type: 'record_completed' }), 'CONFLICT');
  const fo1 = await act(staffA, R1.id, { type: 'send_final_offer', amountCents: 9000 });
  check('send_final_offer 9000 moves to final_offer', fo1.status === 'final_offer' && fo1.finalOffer?.cents === 9000 && fo1.finalOffer.version === 1);
  check('the final offer is separate from the estimate', fo1.estimate?.lowCents === 5000 && fo1.estimate.highCents === 8000);
  await rejects('record_completed before final_accepted is CONFLICT', () => act(staffA, R1.id, { type: 'record_completed' }), 'CONFLICT');
  await rejects('record_payout before completion is CONFLICT', () => act(staffA, R1.id, { type: 'record_payout', message: 'Venmo' }), 'CONFLICT');
  await rejects('final offer response with the wrong amount is CONFLICT', () => s1.dibbsOffer.respondToFinalOffer({ id: R1.id, finalOfferVersion: 1, expectedCents: 8000, decision: 'accept' }), 'CONFLICT');
  await rejects('final offer response with an old version is CONFLICT', () => s1.dibbsOffer.respondToFinalOffer({ id: R1.id, finalOfferVersion: 0, expectedCents: 9000, decision: 'accept' }), 'CONFLICT');
  const fo2 = await act(staffB, R1.id, { type: 'send_final_offer', amountCents: 8500, message: 'Scuff on the corner' });
  check('staff can revise the final offer (version 2, 8500)', fo2.finalOffer?.cents === 8500 && fo2.finalOffer.version === 2 && fo2.status === 'final_offer');
  await rejects('accepting the old 9000 with the old version is CONFLICT', () => s1.dibbsOffer.respondToFinalOffer({ id: R1.id, finalOfferVersion: 1, expectedCents: 9000, decision: 'accept' }), 'CONFLICT');
  await rejects('accepting 9000 against the new version is CONFLICT', () => s1.dibbsOffer.respondToFinalOffer({ id: R1.id, finalOfferVersion: 2, expectedCents: 9000, decision: 'accept' }), 'CONFLICT');
  await rejects('another student cannot answer the final offer (NOT_FOUND)', () => other.dibbsOffer.respondToFinalOffer({ id: R1.id, finalOfferVersion: 2, expectedCents: 8500, decision: 'accept' }), 'NOT_FOUND');
  check('nothing was accepted by the failed answers', (await rowOf(R1.id)).status === 'final_offer' && (await rowOf(R1.id)).finalAcceptedCents === null);
  const accepted = await s1.dibbsOffer.respondToFinalOffer({ id: R1.id, finalOfferVersion: 2, expectedCents: 8500, decision: 'accept' });
  check('accepting 8500 with the new version gives final_accepted at 8500', accepted.status === 'final_accepted' && accepted.finalAcceptedCents === 8500);
  check('the estimate fields are unchanged by the final offer', accepted.estimate?.lowCents === 5000 && accepted.estimate.highCents === 8000 && accepted.estimate.version === 2);
  await rejects('answering the final offer twice is CONFLICT', () => s1.dibbsOffer.respondToFinalOffer({ id: R1.id, finalOfferVersion: 2, expectedCents: 8500, decision: 'accept' }), 'CONFLICT');
  const done = await act(staffA, R1.id, { type: 'record_completed' });
  check('record_completed gives completed; payout is still not recorded', done.status === 'completed' && done.payoutStatus === 'not_recorded' && !!done.completedAt);
  const paid = await act(staffB, R1.id, { type: 'record_payout', message: 'Venmo @handle' });
  check('record_payout marks the payout recorded_outside_app', paid.payoutStatus === 'recorded_outside_app' && paid.status === 'completed');
  await rejects('a second payout record is CONFLICT', () => act(staffA, R1.id, { type: 'record_payout', message: 'again' }), 'CONFLICT');
  await rejects('withdrawing a completed request is CONFLICT', () => s1.dibbsOffer.withdraw({ id: R1.id }), 'CONFLICT');

  // audit trail
  const evs = await db.select().from(dibbsOfferEvents).where(eq(dibbsOfferEvents.requestId, R1.id)).orderBy(dibbsOfferEvents.createdAt);
  const staffEvs = evs.filter((e) => e.actorKind === 'staff');
  const actorsOf = (kind: string) => staffEvs.filter((e) => e.kind === kind).map((e) => e.actorId);
  check('every staff event records the acting staff id', staffEvs.length > 0 && staffEvs.every((e) => e.actorId === STAFF_A || e.actorId === STAFF_B));
  check('review_started was staff A', actorsOf('review_started').join() === STAFF_A);
  check('estimate_sent events were B then A', actorsOf('estimate_sent').join() === [STAFF_B, STAFF_A].join(), actorsOf('estimate_sent').join());
  check('meetup_confirmed was staff B', actorsOf('meetup_confirmed').join() === STAFF_B);
  check('final offer events were A then B', [...actorsOf('final_offer_sent'), ...actorsOf('final_offer_revised')].join() === [STAFF_A, STAFF_B].join());
  check('handoff_completed was A and the payout was B', actorsOf('handoff_completed').join() === STAFF_A && actorsOf('payout_recorded_outside_app').join() === STAFF_B);
  check('seller events record the seller’s id', evs.filter((e) => e.actorKind === 'seller').every((e) => e.actorId === S1));
  await staffA.dibbsStaff.addNote({ id: R1.id, message: 'Seller was friendly. Internal only.' });
  const sellerTimeline = (await s1.dibbsOffer.byId({ id: R1.id })).timeline;
  const staffTimeline = (await staffA.dibbsStaff.byId({ id: R1.id })).timeline;
  check('internal staff notes are hidden from the seller', !sellerTimeline.some((t) => t.internal || t.kind === 'note') && staffTimeline.some((t) => t.kind === 'note' && t.internal));
  check('the seller never sees which staff member acted; staff do', sellerTimeline.every((t) => t.actorName === null) && staffTimeline.some((t) => t.actorName === 'Staff Ann') && staffTimeline.some((t) => t.actorName === 'Staff Ben'));
  await rejects('acting on a completed request with a very old version is CONFLICT', () => staffA.dibbsStaff.act({ id: R1.id, expectedVersion: 1, action: { type: 'close', outcome: 'other' } }), 'CONFLICT');

  /* ============================== ESTIMATE EXPIRY ============================== */
  console.log('\n# estimate expiry');

  const Rexp = await mkReq(s1, { itemName: 'Mini fridge (expiry)' });
  const offeredExp = await act(staffA, Rexp.id, { type: 'send_estimate', lowCents: 3000, highCents: 4000 });
  check('an estimate from submitted is offered', offeredExp.status === 'offered');
  await db.update(dibbsOfferRequests).set({ estimateExpiresAt: new Date(Date.now() - 60_000) }).where(eq(dibbsOfferRequests.id, Rexp.id));
  const expSeen = await s1.dibbsOffer.byId({ id: Rexp.id });
  check('after the estimate expiry the next read shows expired', expSeen.status === 'expired', expSeen.status);
  const expEvents = await db.select().from(dibbsOfferEvents).where(and(eq(dibbsOfferEvents.requestId, Rexp.id), eq(dibbsOfferEvents.kind, 'estimate_expired')));
  check('a system event records the lapse', expEvents.length === 1 && expEvents[0]!.actorKind === 'system' && expEvents[0]!.actorId === null);
  await rejects('the seller cannot agree to meet on an expired estimate', () => s1.dibbsOffer.proposeMeetup({ id: Rexp.id, estimateVersion: 1, ...spotOk }), 'CONFLICT');
  const renewed = await act(staffB, Rexp.id, { type: 'send_estimate', lowCents: 3500, highCents: 3500 });
  check('staff can send a new estimate from expired', renewed.status === 'offered' && renewed.estimate?.version === 2 && renewed.estimate.kind === 'exact');
  await s1.dibbsOffer.withdraw({ id: Rexp.id });

  /* ============================== LINKED LISTINGS: BOOKING vs HOLD ============================== */
  console.log('\n# linked listings');

  const L1 = await mkListing(S2, 'Linked Desk Lamp');
  const L2 = await mkListing(S2, 'Other Lamp');
  const L3 = await mkListing(S2, 'Third Lamp');
  const L4 = await mkListing(S2, 'Fourth Lamp');
  const L5 = await mkListing(S2, 'Fifth Lamp');
  const SECRET = 'ZZ-Secret-Dibbs-Name';

  await rejects('create with someone else’s listing is NOT_FOUND', () => other.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Not mine', listingId: L1.id }), 'NOT_FOUND');
  const RL1 = await s2.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: SECRET, listingId: L1.id });
  check('create with a listingId and no media works', RL1.status === 'submitted' && RL1.listing?.id === L1.id && RL1.media.length === 0);
  check('forListing finds the open request for the owner only', (await s2.dibbsOffer.forListing({ listingId: L1.id }))?.id === RL1.id && (await other.dibbsOffer.forListing({ listingId: L1.id })) === null);
  await rejects('a second open request for the same listing is CONFLICT', () => s2.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Second try', listingId: L1.id }), 'CONFLICT');
  check('the refused duplicate left exactly one request on the listing', (await db.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.listingId, L1.id))).length === 1);

  // privacy: nothing leaks into public surfaces
  console.log('\n# public surfaces never show requests or their media');
  const needles = [R1.id, RL1.id, 'Walnut Standing Desk', SECRET, 'private-media', photo1.id, photo2.id, okVideo.id, 'Uplift V2'];
  const leak = (label: string, data: unknown) => {
    const text = JSON.stringify(data) ?? '';
    const hit = needles.find((n) => text.includes(n));
    check(label, !hit, hit ? `found "${hit}"` : '');
  };
  __resetExpirySweepForTests();
  for (const [who, viewer] of [['a student', other], ['the seller', s2], ['signed-out', anon]] as const) {
    leak(`listing.feed (live) leaks nothing to ${who}`, await viewer.listing.feed({ campusId: CAMPUS_ID, limit: 50 }));
    leak(`listing.feed (archive) leaks nothing to ${who}`, await viewer.listing.feed({ campusId: CAMPUS_ID, archived: true, limit: 50 }));
    leak(`listing.byId leaks nothing to ${who}`, await viewer.listing.byId({ id: L1.id }));
    leak(`listing.bySeller leaks nothing to ${who}`, await viewer.listing.bySeller({ sellerId: S2, includeSold: true }));
    leak(`user.byId leaks nothing to ${who}`, await viewer.user.byId({ id: S2 }));
    leak(`user.trustSummary leaks nothing to ${who}`, await viewer.user.trustSummary({ id: S2 }));
  }
  leak('user.byId for the media seller leaks nothing', await other.user.byId({ id: S1 }));
  leak('listing.bySeller for the media seller leaks nothing', await other.listing.bySeller({ sellerId: S1, includeSold: true }));
  leak('community.feed (students) leaks nothing', await other.community.feed({ limit: 50 }));
  leak('community.feed (selling) leaks nothing', await other.community.feed({ kind: 'selling', limit: 50 }));
  leak('community.feed (seller view) leaks nothing', await s2.community.feed({ limit: 50 }));
  leak('user.posts of the seller leaks nothing', await other.user.posts({ userId: S2 }));
  leak('user.posts of the media seller leaks nothing', await other.user.posts({ userId: S1 }));
  leak('listing.mine leaks nothing', await s2.listing.mine());

  // path 1: buyer books first
  const estL1 = await act(staffA, RL1.id, { type: 'send_estimate', lowCents: 1000, highCents: 1500 });
  await s2.dibbsOffer.proposeMeetup({ id: RL1.id, estimateVersion: estL1.estimate!.version, spotId: SPOT_A, startsAt: T1 });
  const bookT2 = await buyer.reservation.book({ listingId: L1.id, spotId: SPOT_A, startsAt: T2 });
  check('a buyer booking the listing first reserves it', (await listingStatus(L1.id)) === 'reserved' && bookT2.status === 'accepted');
  await rejects('Dibbs confirm_meetup on the linked request is CONFLICT while a buyer holds the item', () => act(staffB, RL1.id, { type: 'confirm_meetup' }), 'CONFLICT');
  check('the refused confirm left the request proposed and not holding', (await rowOf(RL1.id)).status === 'meetup_proposed' && !(await rowOf(RL1.id)).holdsListing);
  await buyer.reservation.cancel({ id: bookT2.id });
  check('the buyer cancelling puts the listing back to active', (await listingStatus(L1.id)) === 'active');
  const heldL1 = await act(staffB, RL1.id, { type: 'confirm_meetup' });
  check('Dibbs confirm now works: listing reserved and holdsListing true', heldL1.status === 'meetup_confirmed' && (await listingStatus(L1.id)) === 'reserved' && (await rowOf(RL1.id)).holdsListing && (await dibbsHoldsListing(db, L1.id)));
  await rejects('a buyer cannot book a listing Dibbs holds', () => buyer.reservation.book({ listingId: L1.id, spotId: SPOT_A, startsAt: T2 }), 'CONFLICT');

  // seller double-booking
  await rejects('booking another listing of the same seller at the Dibbs meetup time is CONFLICT', () => buyer.reservation.book({ listingId: L2.id, spotId: SPOT_A, startsAt: T1 }), 'CONFLICT');
  check('the refused booking left L2 active', (await listingStatus(L2.id)) === 'active');

  // seller withdraws/cancels releases; staff cancel_meetup releases
  const cancelled = await act(staffA, RL1.id, { type: 'cancel_meetup', message: 'Need to reschedule' });
  check('staff cancel_meetup releases the hold: listing back to active', cancelled.status === 'offered' && (await listingStatus(L1.id)) === 'active' && !(await rowOf(RL1.id)).holdsListing && !cancelled.meetup);
  check('a cancelled meetup restarts the estimate clock', !!cancelled.estimate?.expiresAt && cancelled.estimate.expiresAt.getTime() > Date.now() + 47 * HOUR);
  check('after the release the buyer can book the listing again (then cancel)', await (async () => {
    const b = await buyer.reservation.book({ listingId: L1.id, spotId: SPOT_A, startsAt: T2 });
    await buyer.reservation.cancel({ id: b.id });
    return (await listingStatus(L1.id)) === 'active';
  })());
  await s2.dibbsOffer.proposeMeetup({ id: RL1.id, estimateVersion: cancelled.estimate!.version, spotId: SPOT_A, startsAt: T1 });
  await act(staffB, RL1.id, { type: 'confirm_meetup' });
  check('re-confirming holds the listing again', (await listingStatus(L1.id)) === 'reserved');
  const withdrawn = await s2.dibbsOffer.withdraw({ id: RL1.id });
  check('the seller withdrawing releases the hold: listing back to active', withdrawn.status === 'withdrawn' && (await listingStatus(L1.id)) === 'active' && !(await rowOf(RL1.id)).holdsListing);
  check('forListing no longer returns the withdrawn request', (await s2.dibbsOffer.forListing({ listingId: L1.id })) === null);

  // completing the handoff marks the listing sold
  const RL1b = await s2.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: SECRET, listingId: L1.id });
  check('a new request on the same listing is allowed once the first is closed', RL1b.status === 'submitted');
  const estB = await act(staffA, RL1b.id, { type: 'send_estimate', lowCents: 1500, highCents: 1500 });
  await s2.dibbsOffer.proposeMeetup({ id: RL1b.id, estimateVersion: estB.estimate!.version, spotId: SPOT_B, startsAt: T7 });
  await act(staffB, RL1b.id, { type: 'confirm_meetup' });
  await act(staffA, RL1b.id, { type: 'send_final_offer', amountCents: 1400 });
  await s2.dibbsOffer.respondToFinalOffer({ id: RL1b.id, finalOfferVersion: 1, expectedCents: 1400, decision: 'accept' });
  check('the listing is still held until the handoff is recorded', (await listingStatus(L1.id)) === 'reserved');
  await act(staffA, RL1b.id, { type: 'record_completed' });
  const [soldL1] = await db.select().from(listings).where(eq(listings.id, L1.id));
  check('record_completed on a linked request marks the listing sold', soldL1!.status === 'sold' && !!soldL1!.soldAt && !(await rowOf(RL1b.id)).holdsListing);
  check('a sold listing is not in the live feed or the Archive', !JSON.stringify(await other.listing.feed({ campusId: CAMPUS_ID, limit: 50 })).includes(L1.id) && !JSON.stringify(await other.listing.feed({ campusId: CAMPUS_ID, archived: true, limit: 50 })).includes(L1.id));
  await rejects('a sold listing cannot get a new Dibbs request', () => s2.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Late', listingId: L1.id }), 'CONFLICT');

  // Dibbs proposing a time the seller is already booked
  const RL3 = await s2.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Third Lamp request', listingId: L3.id });
  await act(staffA, RL3.id, { type: 'send_estimate', lowCents: 800, highCents: 1200 });
  const bookL2 = await buyer.reservation.book({ listingId: L2.id, spotId: SPOT_A, startsAt: T4 });
  check('a normal booking of another listing at a free time works', bookL2.status === 'accepted');
  await rejects('Dibbs proposing a time the seller already has a meetup is CONFLICT', () => act(staffA, RL3.id, { type: 'propose_meetup', spotId: SPOT_A, startsAt: T4 }), 'CONFLICT');
  const dibbsProposed = await act(staffA, RL3.id, { type: 'propose_meetup', spotId: SPOT_A, startsAt: T5 });
  check('a free time is accepted as a Dibbs proposal', dibbsProposed.status === 'meetup_proposed' && dibbsProposed.meetup?.proposedBy === 'dibbs');
  await rejects('the seller accepting with a stale expectedVersion is CONFLICT', () => s2.dibbsOffer.acceptMeetup({ id: RL3.id, expectedVersion: dibbsProposed.version - 1 }), 'CONFLICT');
  await rejects('staff cannot confirm their own proposal (seller must accept)', () => act(staffB, RL3.id, { type: 'confirm_meetup' }), 'CONFLICT');
  const acceptedMeetup = await s2.dibbsOffer.acceptMeetup({ id: RL3.id, expectedVersion: dibbsProposed.version });
  check('the seller accepting a Dibbs proposal confirms it and holds the listing', acceptedMeetup.status === 'meetup_confirmed' && (await listingStatus(L3.id)) === 'reserved');
  await rejects('the seller cannot then propose a time that clashes with a booking', () => s2.dibbsOffer.cancelMeetup({ id: RL3.id }).then(() => s2.dibbsOffer.proposeMeetup({ id: RL3.id, estimateVersion: 1, spotId: SPOT_A, startsAt: T4 })), 'CONFLICT');
  check('seller cancelMeetup released the hold before that', (await listingStatus(L3.id)) === 'active');

  // archived listing: declining a buyer's meetup request does not release the Dibbs hold
  const RL4 = await s2.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Fourth Lamp request', listingId: L4.id });
  const estL4 = await act(staffA, RL4.id, { type: 'send_estimate', lowCents: 500, highCents: 900 });
  await s2.dibbsOffer.proposeMeetup({ id: RL4.id, estimateVersion: estL4.estimate!.version, spotId: SPOT_A, startsAt: T6 });
  await act(staffB, RL4.id, { type: 'confirm_meetup' });
  check('L4 is held by Dibbs', (await listingStatus(L4.id)) === 'reserved');
  await db.update(listings).set({ expiresAt: new Date(Date.now() - 2 * HOUR) }).where(eq(listings.id, L4.id));
  const [pendingRes] = await db
    .insert(reservations)
    .values({ listingId: L4.id, buyerId: OTHER, sellerId: S2, status: 'requested', spotId: SPOT_B, startsAt: slotAt(2 * DAY), proposedById: OTHER, priceCents: 2000 })
    .returning();
  const declined = await s2.reservation.decline({ id: pendingRes!.id });
  check('the seller declined the buyer’s meetup request', declined.status === 'declined');
  check('declining it does NOT release the Dibbs hold', (await listingStatus(L4.id)) === 'reserved' && (await rowOf(RL4.id)).holdsListing === true);
  await act(staffA, RL4.id, { type: 'cancel_meetup', message: 'Seller asked to cancel' });
  check('releasing a hold on a listing past its 24 hours goes to expired (the Archive), not active', (await listingStatus(L4.id)) === 'expired');

  // sold elsewhere
  const RL5 = await s2.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Fifth Lamp request', listingId: L5.id });
  await db.update(listings).set({ status: 'sold', soldAt: new Date() }).where(eq(listings.id, L5.id));
  const closedElsewhere = await s2.dibbsOffer.byId({ id: RL5.id });
  check('a request whose listing sold through the marketplace reads closed / sold_elsewhere', closedElsewhere.status === 'closed' && closedElsewhere.closedOutcome === 'sold_elsewhere', `${closedElsewhere.status}/${closedElsewhere.closedOutcome}`);
  const soldEv = await db.select().from(dibbsOfferEvents).where(and(eq(dibbsOfferEvents.requestId, RL5.id), eq(dibbsOfferEvents.kind, 'sold_elsewhere')));
  check('a system event records the sale', soldEv.length === 1 && soldEv[0]!.actorKind === 'system');
  await rejects('a closed request takes no more staff estimates', () => act(staffA, RL5.id, { type: 'close', outcome: 'other' }), 'CONFLICT');

  /* ============================== UNCHANGED MARKETPLACE BEHAVIOUR ============================== */
  console.log('\n# ordinary listings are unchanged');

  const created = await s2.listing.create({
    title: 'Normal listing',
    category: 'dorm',
    condition: 'good',
    priceCents: 2500,
    saleType: 'fixed',
    isSellToday: false,
    photoUrls: ['/api/uploads/normal.jpg'],
    spotIds: [SPOT_A],
    windows: [{ startsAt: slotAt(HOUR), endsAt: slotAt(3 * HOUR) }],
  });
  const [createdRow] = await db.select().from(listings).where(eq(listings.id, created.id));
  check('listing.create still sets expiresAt = createdAt + 24h', Math.abs(createdRow!.expiresAt!.getTime() - createdRow!.createdAt.getTime() - DAY) < 2000, String(createdRow!.expiresAt!.getTime() - createdRow!.createdAt.getTime()));
  __resetExpirySweepForTests();
  check('a fresh listing appears in the live feed and not the Archive', (await other.listing.feed({ campusId: CAMPUS_ID, limit: 50 })).items.some((i) => i.id === created.id) && !(await other.listing.feed({ campusId: CAMPUS_ID, archived: true, limit: 50 })).items.some((i) => i.id === created.id));
  await db.update(listings).set({ expiresAt: new Date(Date.now() - 2 * HOUR), createdAt: new Date(Date.now() - 26 * HOUR) }).where(eq(listings.id, created.id));
  __resetExpirySweepForTests();
  const liveAfter = await other.listing.feed({ campusId: CAMPUS_ID, limit: 50 });
  __resetExpirySweepForTests();
  const archAfter = await other.listing.feed({ campusId: CAMPUS_ID, archived: true, limit: 50 });
  check('after 24 hours it leaves the live feed and appears in the Archive', !liveAfter.items.some((i) => i.id === created.id) && archAfter.items.some((i) => i.id === created.id));

  /* ============================== NOTIFICATIONS ============================== */
  console.log('\n# email notifications');

  const provider = new SimulatedEmailProvider();
  setEmailProviderForTests(provider);
  const drain = async () => {
    for (let i = 0; i < 20; i += 1) {
      await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
      const due = await db.select().from(dibbsOfferNotifications).where(eq(dibbsOfferNotifications.status, 'scheduled'));
      if (due.every((d) => d.sendAfter.getTime() > Date.now() + 1000)) break;
    }
  };
  await drain();
  provider.sent.length = 0;
  const rowsFor = (requestId: string) => db.select().from(dibbsOfferNotifications).where(eq(dibbsOfferNotifications.requestId, requestId));
  const sentFor = (text: string) => provider.sent.filter((m) => m.text.includes(text) || m.subject.includes(text));
  const tokenValues = [...tokens.values()];

  const realPhoto = (await (await upload(await tokenFor(S3), jpeg(), 'image/jpeg', 'cam.jpg')).json()) as UploadJson;
  const cidN = crypto.randomUUID();
  const RN = await s3.dibbsOffer.create({ clientRequestId: cidN, itemName: 'Notif Camera Alpha', mediaIds: [realPhoto.id] });
  let rows = await rowsFor(RN.id);
  check('create queues exactly one team new_request row', rows.filter((r) => r.audience === 'team' && r.kind === 'new_request').length === 1 && rows.length === 1 && rows[0]!.status === 'scheduled');
  await s3.dibbsOffer.create({ clientRequestId: cidN, itemName: 'Notif Camera Alpha', mediaIds: [] });
  check('create again with the same clientRequestId adds no row', (await rowsFor(RN.id)).length === 1);
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  const teamMails = sentFor('Notif Camera Alpha');
  check('dispatch sends exactly one email to the team inbox', teamMails.length === 1 && teamMails[0]!.to === 'team@example.test', `${teamMails.length} to ${teamMails[0]?.to}`);
  const tm = teamMails[0]!;
  check('the team email names the item and links to the staff review page', tm.text.includes('Notif Camera Alpha') && tm.text.includes(`https://dibbs.example.test/staff/dibbs-offers/${RN.id}`) && !!tm.html?.includes(`/staff/dibbs-offers/${RN.id}`));
  const blob = `${tm.subject}\n${tm.text}\n${tm.html ?? ''}`;
  check('the team email link carries no token, signature or query string', !/staff\/dibbs-offers\/[0-9a-f-]{36}[?#&=]/.test(blob) && !/token|secret|signature|[?&]s=|[?&]e=/i.test(blob) && !tokenValues.some((t) => blob.includes(t)));
  check('the team email never links to the private media route', !blob.includes('private-media'));
  check('the team email attaches the cover photo inline', (tm.attachments?.length ?? 0) === 1 && tm.attachments![0]!.contentId === 'dibbs-preview' && !!tm.html?.includes('cid:dibbs-preview'));
  check('the team email carries the seller’s name but not their email address', tm.text.includes('Seller Three') && !blob.includes(emailOf(S3)));
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  check('dispatching twice sends once', sentFor('Notif Camera Alpha').length === 1);
  check('the sent row is marked sent', (await rowsFor(RN.id))[0]!.status === 'sent');

  // delivery failure
  const photoBeta = await dbMedia(S3);
  const RN2 = await s3.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Notif Camera Beta', mediaIds: [photoBeta] });
  provider.failNext = 1;
  const beforeFail = Date.now();
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  const [failedRow] = await rowsFor(RN2.id);
  check('a provider failure keeps the request saved', (await rowOf(RN2.id)).status === 'submitted');
  check('the failed row goes back to scheduled with attempts 1 and a later sendAfter', failedRow!.status === 'scheduled' && failedRow!.attempts === 1 && failedRow!.sendAfter.getTime() > beforeFail + 30_000, `${failedRow!.status} attempts=${failedRow!.attempts}`);
  check('nothing was sent for it yet', sentFor('Notif Camera Beta').length === 0);
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  check('dispatching before sendAfter does not retry early', sentFor('Notif Camera Beta').length === 0);
  await dispatchDibbsEmails(db, new Date(Date.now() + 5 * 60_000));
  check('dispatching after sendAfter sends it', sentFor('Notif Camera Beta').length === 1 && (await rowsFor(RN2.id))[0]!.status === 'sent');

  // no team inbox
  delete process.env.DIBBS_OFFERS_EMAIL;
  const RN3 = await s3.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Notif Camera Gamma', mediaIds: [await dbMedia(S3)] });
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  check('with DIBBS_OFFERS_EMAIL unset the team row is skipped', (await rowsFor(RN3.id))[0]!.status === 'skipped');
  check('the request is unaffected and no email went out', (await rowOf(RN3.id)).status === 'submitted' && sentFor('Notif Camera Gamma').length === 0);
  process.env.DIBBS_OFFERS_EMAIL = 'team@example.test';

  // seller email
  const estAlpha = await act(staffA, RN.id, { type: 'send_estimate', lowCents: 20_000, highCents: 25_000 });
  const sellerRows = (await rowsFor(RN.id)).filter((r) => r.audience === 'seller');
  check('an estimate queues one seller email row keyed to the estimate version', sellerRows.length === 1 && sellerRows[0]!.kind === 'estimate' && sellerRows[0]!.refVersion === estAlpha.estimate!.version);
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  const sellerMails = provider.sent.filter((m) => m.to === emailOf(S3) && m.subject.includes('Notif Camera Alpha'));
  check('dispatch sends one estimate email to the seller’s address', sellerMails.length === 1, String(sellerMails.length));
  const sm = sellerMails[0]!;
  check('the seller email says it is an estimate subject to inspection and links to the request', /estimate/i.test(sm.text) && /inspect/i.test(sm.text) && sm.text.includes(`https://dibbs.example.test/dibbs-offer/${RN.id}`) && !tokenValues.some((t) => sm.text.includes(t)));
  check('the seller email carries the price range', sm.text.includes('$200–$250'), sm.text.slice(0, 160));

  // superseded estimate
  const RN4 = await s3.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Notif Camera Delta', mediaIds: [await dbMedia(S3)] });
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000)); // team alert out of the way
  await act(staffA, RN4.id, { type: 'send_estimate', lowCents: 5000, highCents: 6000 });
  const estDelta2 = await act(staffB, RN4.id, { type: 'send_estimate', lowCents: 7000, highCents: 9000 });
  const deltaRows = (await rowsFor(RN4.id)).filter((r) => r.audience === 'seller').sort((a, b) => a.refVersion - b.refVersion);
  check('two estimates queue two seller rows', deltaRows.length === 2 && deltaRows[1]!.refVersion === estDelta2.estimate!.version);
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  const deltaAfter = (await rowsFor(RN4.id)).filter((r) => r.audience === 'seller').sort((a, b) => a.refVersion - b.refVersion);
  check('the superseded estimate row is skipped and the new one sent', deltaAfter[0]!.status === 'skipped' && deltaAfter[1]!.status === 'sent', deltaAfter.map((r) => r.status).join());
  const deltaMails = provider.sent.filter((m) => m.to === emailOf(S3) && m.subject.includes('Notif Camera Delta'));
  check('only one email reached the seller, with the new range', deltaMails.length === 1 && deltaMails[0]!.text.includes('$70–$90') && !deltaMails[0]!.text.includes('$50'), String(deltaMails.length));

  // an answered state makes a queued seller email stale
  const RN5 = await s3.dibbsOffer.create({ clientRequestId: crypto.randomUUID(), itemName: 'Notif Camera Epsilon', mediaIds: [await dbMedia(S3)] });
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  const estEps = await act(staffA, RN5.id, { type: 'send_estimate', lowCents: 1000, highCents: 2000 });
  await s3.dibbsOffer.declineEstimate({ id: RN5.id, estimateVersion: estEps.estimate!.version });
  await dispatchDibbsEmails(db, new Date(Date.now() + 1000));
  check('a seller email whose request moved on (seller already declined) is skipped', (await rowsFor(RN5.id)).filter((r) => r.audience === 'seller').every((r) => r.status === 'skipped') && !provider.sent.some((m) => m.subject.includes('Notif Camera Epsilon') && m.to === emailOf(S3)));

  await pglite?.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
