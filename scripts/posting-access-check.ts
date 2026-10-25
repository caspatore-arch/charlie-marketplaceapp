/**
 * Posting access: the founder override on /admin (Default / Approved /
 * Blocked) and the gate it feeds (campusVerifiedProcedure). Checked against a
 * throwaway PGlite seeded with the demo data.
 *
 *   npx tsx scripts/posting-access-check.ts
 *
 * Covers: a gmail account on 'default' is refused listing.create; 'approved'
 * can create a listing, auth.me says canPost and is NOT campus verified, and
 * the public shape says "approvedSeller", not campusEmailVerified; 'blocked'
 * refuses even an arizona.edu account with the blocked message (and offers,
 * booking and community posts too); back to 'default' works again. The
 * admin endpoints: 404 with ADMIN_PASSWORD unset, 401 without the cookie,
 * search and update with it, cross-site POST refused, no phone fields.
 * Modules load with `await import(...)` after the env block (see save-check).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-access-'));
process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
process.env.SMS_MODE = 'simulated';
delete process.env.ADMIN_PASSWORD;

const ADMIN_PASSWORD = 'posting-access-check-password-123';
const BLOCKED = /can’t buy, sell or post right now\. Contact support\./;

let passes = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) passes += 1;
  else failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
async function rejects(label: string, fn: () => Promise<unknown>, code: string, msg?: RegExp) {
  try {
    await fn();
    check(label, false, 'did not throw');
  } catch (e) {
    const err = e as { code?: string; message?: string };
    check(label, err.code === code && (!msg || msg.test(err.message ?? '')), `got ${err.code}: ${err.message}`);
  }
}

async function main() {
  const { seed } = await import('../backend/db/seed');
  await seed();
  const { and, asc, desc, eq, isNull } = await import('drizzle-orm');
  const { db, pglite } = await import('../backend/db/client');
  const schema = await import('../backend/db/schema');
  const { appRouter } = await import('../backend/trpc/app-router');
  const { userFromAuthHeader } = await import('../backend/trpc/create-context');
  const { SimulatedEmailProvider, setEmailProviderForTests } = await import('../backend/email/provider');
  const { app } = await import('../backend/hono');

  setEmailProviderForTests(new SimulatedEmailProvider());
  const anon = appRouter.createCaller({ db, user: null });
  const callerFor = async (token: string) =>
    appRouter.createCaller({ db, user: await userFromAuthHeader(`Bearer ${token}`) });
  const latestCode = async (email: string) => {
    const [row] = await db
      .select()
      .from(schema.emailCodes)
      .where(and(eq(schema.emailCodes.email, email), isNull(schema.emailCodes.consumedAt)))
      .orderBy(desc(schema.emailCodes.expiresAt))
      .limit(1);
    return row?.code ?? '';
  };
  const signIn = async (email: string, displayName: string) => {
    await anon.auth.requestCode({ email });
    return anon.auth.verifyCode({ email, code: await latestCode(email), displayName });
  };
  const setAccess = (userId: string, postingAccess: 'default' | 'approved' | 'blocked') =>
    db.update(schema.users).set({ postingAccess }).where(eq(schema.users.id, userId));

  const [campus] = await db.select().from(schema.campuses).orderBy(asc(schema.campuses.name)).limit(1);
  const spots = await db.select().from(schema.meetupSpots).where(eq(schema.meetupSpots.campusId, campus!.id));
  const HOUR = 3_600_000;
  const slot = (ms: number) => new Date(Math.ceil((Date.now() + ms) / 900_000) * 900_000);
  const listingInput = () => ({
    title: `Access lamp ${Math.random().toString(36).slice(2, 7)}`,
    category: 'other' as const,
    condition: 'good' as const,
    priceCents: 2500,
    isSellToday: true,
    photoUrls: ['/api/uploads/demo-dorm.svg'],
    spotIds: [spots[0]!.id],
    windows: [{ startsAt: slot(HOUR), endsAt: slot(5 * HOUR) }],
  });

  // --- gmail, default
  const gIn = await signIn('specialized.seller@gmail.com', 'Vintage Vendor');
  const gId = gIn.user.id;
  check('new gmail account starts on default', gIn.user.postingAccess === 'default' && gIn.user.canPost === false && gIn.user.postingStatus === 'needs_campus_email');
  await rejects('default gmail: listing.create FORBIDDEN (campus email)', async () => (await callerFor(gIn.token)).listing.create(listingInput()), 'FORBIDDEN', /campus email/i);

  // --- approved
  await setAccess(gId, 'approved');
  const g = await callerFor(gIn.token);
  const approvedListing = await g.listing.create(listingInput());
  check('approved gmail can create a listing', !!approvedListing.id);
  const gMe = await g.auth.me();
  check('approved: auth.me canPost, status approved', gMe.canPost === true && gMe.postingStatus === 'approved');
  check('approved: NOT campus verified', gMe.campusEmailVerifiedAt == null);
  const gSettings = await g.user.contactSettings();
  check('approved: contactSettings says not campus verified, status approved', gSettings.campusEmailVerified === false && gSettings.postingStatus === 'approved');
  const pub = await anon.user.byId({ id: gId });
  check('approved: public shape is approvedSeller, not campusEmailVerified', pub.approvedSeller === true && pub.campusEmailVerified === false);
  const detail = await anon.listing.byId({ id: approvedListing.id });
  check('approved: listing seller is approvedSeller, not campusEmailVerified', detail.seller.approvedSeller === true && detail.seller.campusEmailVerified === false);
  check('public shape never exposes postingAccess', !('postingAccess' in (pub as object)) && !('postingAccess' in (detail.seller as object)));

  // --- blocked, on a campus-verified account
  const azIn = await signIn('blocked.wildcat@arizona.edu', 'Blocked Wildcat');
  const azId = azIn.user.id;
  check('arizona.edu account is campus verified and can post', azIn.user.campusEmailVerifiedAt != null && azIn.user.canPost === true);
  const az0 = await callerFor(azIn.token);
  const azListing = await az0.listing.create(listingInput());
  check('arizona.edu default can create a listing', !!azListing.id);
  await setAccess(azId, 'blocked');
  const az = await callerFor(azIn.token);
  await rejects('blocked arizona.edu: listing.create FORBIDDEN with blocked message', () => az.listing.create(listingInput()), 'FORBIDDEN', BLOCKED);
  await rejects('blocked: community.create FORBIDDEN', () => az.community.create({ kind: 'buying', body: 'Anyone selling a desk lamp?' }), 'FORBIDDEN', BLOCKED);
  await rejects('blocked: offer.create FORBIDDEN', () => az.offer.create({ listingId: approvedListing.id, amountCents: 2000 } as never), 'FORBIDDEN', BLOCKED);
  try {
    await az.listing.create(listingInput());
  } catch (e) {
    check('blocked message does not mention campus email', !/campus/i.test((e as Error).message));
  }
  const azMe = await az.auth.me();
  check('blocked: auth.me canPost false, status blocked', azMe.canPost === false && azMe.postingStatus === 'blocked');
  const azPub = await anon.user.byId({ id: azId });
  check('blocked is not visible publicly', azPub.approvedSeller === false && !('postingAccess' in (azPub as object)));

  // --- back to default
  await setAccess(azId, 'default');
  const azBack = await (await callerFor(azIn.token)).listing.create(listingInput());
  check('back to default: arizona.edu can create a listing again', !!azBack.id);
  await setAccess(gId, 'default');
  await rejects('back to default: gmail refused again', async () => (await callerFor(gIn.token)).listing.create(listingInput()), 'FORBIDDEN', /campus email/i);

  // --- admin endpoints
  const host = 'admin.test';
  const req = (p: string, init: RequestInit = {}) => app.request(`http://${host}${p}`, init);

  delete process.env.ADMIN_PASSWORD;
  check('admin off: users.json is 404', (await req('/admin/users.json?q=vendor')).status === 404);
  check('admin off: POST users/access is 404', (await req('/admin/users/access', { method: 'POST' })).status === 404);

  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  check('no cookie: users.json is 401', (await req('/admin/users.json?q=vendor')).status === 401);
  const noCookiePost = await req('/admin/users/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `http://${host}` },
    body: JSON.stringify({ userId: gId, access: 'approved' }),
  });
  check('no cookie: POST users/access is 401', noCookiePost.status === 401);

  const login = await req('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: ADMIN_PASSWORD }).toString(),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  check('admin login sets the session cookie', login.status === 303 && cookie.startsWith('dibbs_admin='));

  // Give the gmail user a phone so we can prove it isn't returned.
  await db.update(schema.users).set({ phone: '+15205550199', contactPhone: '+15205550188' }).where(eq(schema.users.id, gId));
  const search = await req('/admin/users.json?q=VENDOR', { headers: { Cookie: cookie } });
  const found = (await search.json()) as { users: Record<string, unknown>[] };
  const hit = found.users.find((u) => u.id === gId);
  check('search is case-insensitive and partial on name', search.status === 200 && !!hit);
  check('search row has name, email, campus status, access, created', !!hit && hit.displayName === 'Vintage Vendor' && hit.email === 'specialized.seller@gmail.com' && hit.campusEmailVerified === false && hit.postingAccess === 'default' && !!hit.createdAt);
  const raw = JSON.stringify(found);
  check('search returns no phone fields', !/phone/i.test(raw) && !raw.includes('5205550'));
  const byEmail = (await (await req('/admin/users.json?q=gmail.c', { headers: { Cookie: cookie } })).json()) as { users: { id: string }[] };
  check('search matches partial email', byEmail.users.some((u) => u.id === gId));
  const wild = (await (await req('/admin/users.json?q=%25', { headers: { Cookie: cookie } })).json()) as { users: unknown[] };
  check('a literal % is not a wildcard', wild.users.length === 0);

  await db.insert(schema.users).values(
    Array.from({ length: 25 }, (_, i) => ({ displayName: `Capper ${i}`, email: `capper${i}@gmail.com`, campusId: campus!.id })),
  );
  const all = (await (await req('/admin/users.json?q=capper', { headers: { Cookie: cookie } })).json()) as { users: unknown[] };
  check('search is capped at 20', all.users.length === 20, `got ${all.users.length}`);

  // Closed accounts are skipped.
  const closedIn = await signIn('closed.vendor@gmail.com', 'Closed Vendor');
  await db.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, closedIn.user.id));
  const closedSearch = (await (await req('/admin/users.json?q=closed.vendor', { headers: { Cookie: cookie } })).json()) as { users: unknown[] };
  check('search skips closed accounts', closedSearch.users.length === 0);

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    req('/admin/users/access', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: `http://${host}`, ...headers },
      body: JSON.stringify(body),
    });

  const foreign = await post({ userId: gId, access: 'approved' }, { Origin: 'https://evil.example' });
  check('POST with a foreign Origin is rejected', foreign.status === 403);
  const noOrigin = await req('/admin/users/access', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: gId, access: 'approved' }),
  });
  check('POST with no Origin or Referer is rejected', noOrigin.status === 403);
  const formPost = await req('/admin/users/access', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: `http://${host}` },
    body: `userId=${gId}&access=approved`,
  });
  check('POST that is not JSON is rejected', formPost.status === 415);
  check('POST with a bad access value is 400', (await post({ userId: gId, access: 'admin' })).status === 400);
  check('POST with a bad user id is 400', (await post({ userId: 'nope', access: 'approved' })).status === 400);
  check('POST for a closed account is 404', (await post({ userId: closedIn.user.id, access: 'approved' })).status === 404);

  const ok = await post({ userId: gId, access: 'approved' });
  const okBody = (await ok.json()) as { user: Record<string, unknown> };
  check('POST with the cookie and same Origin sets access', ok.status === 200 && okBody.user.postingAccess === 'approved');
  check('POST response has no phone fields', !/phone/i.test(JSON.stringify(okBody)));
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, gId));
  check('DB row updated with a change time', row!.postingAccess === 'approved' && row!.postingAccessChangedAt != null);
  const viaAdmin = await (await callerFor(gIn.token)).listing.create(listingInput());
  check('after admin approval the gmail account can sell', !!viaAdmin.id);

  const refererOnly = await req('/admin/users/access', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', Referer: `http://${host}/admin` },
    body: JSON.stringify({ userId: gId, access: 'blocked' }),
  });
  check('POST with a same-site Referer (no Origin) is accepted', refererOnly.status === 200);
  const changed = (await (await req('/admin/users.json', { headers: { Cookie: cookie } })).json()) as { users: { id: string; postingAccess: string }[] };
  check('empty search lists accounts with changed access', changed.users.some((u) => u.id === gId && u.postingAccess === 'blocked'));
  const stats = (await (await req('/admin/stats.json', { headers: { Cookie: cookie } })).json()) as { recent: { id: string; postingAccess: string }[] };
  check('newest accounts list carries posting access', stats.recent.length > 0 && stats.recent.every((u) => ['default', 'approved', 'blocked'].includes(u.postingAccess)));
  const page = await (await req('/admin', { headers: { Cookie: cookie } })).text();
  check('dashboard page has the Posting access card', page.includes('Posting access') && page.includes('/admin/users/access'));

  console.log(`\n${passes} passed, ${failures} failed`);
  await pglite?.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
