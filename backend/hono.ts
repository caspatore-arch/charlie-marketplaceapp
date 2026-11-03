import { trpcServer } from '@hono/trpc-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { and, eq, gte, sql } from 'drizzle-orm';

import { db, dbKind } from './db/client';
import { dibbsOfferMedia } from './db/schema';
import {
  MAX_UNATTACHED_UPLOADS_PER_DAY,
  PRIVATE_VIDEO_MAX_BYTES,
  PrivateMediaError,
  getPrivate,
  newPrivateKey,
  privateMediaReady,
  putPrivate,
  signedMediaPath,
  validatePrivateMedia,
  verifySignedMedia,
} from './dibbs/media';
import { env } from './env';
import { callerKey, rateLimit } from './ratelimit';
import { paymentsMode } from './stripe/client';
import { handleSmsOptOut } from './sms/webhook';
import { resolveSmsMode } from './sms/provider';
import { resolveEmailMode } from './email/provider';
import {
  processSimulatedEvent,
  processWebhook,
  simulateHookAllowed,
  type SimulatedEventKind,
} from './stripe/webhook';
import {
  MAX_UPLOAD_BYTES,
  UploadError,
  USER_CONTENT_TYPES,
  sanitizeFileName,
  storage,
} from './storage';
import { adminApp } from './admin/routes';
import { parsePlatform, recordVisit } from './admin/visits';
import { appRouter } from './trpc/app-router';
import { createContext, userFromAuthHeader } from './trpc/create-context';

export const app = new Hono();

/**
 * CORS. Local dev keeps today's fully permissive behaviour (origin: '*') so
 * the Expo Go / LAN workflow in docs/HANDOFF.md never breaks — a phone on
 * the Mac's Wi-Fi hits an arbitrary `http://<lan-ip>:3000` origin that can't
 * be known in advance. In production (NODE_ENV=production) only origins
 * listed in ALLOWED_ORIGINS (comma-separated) are accepted; anything else is
 * refused by the cors() middleware (no Access-Control-Allow-Origin header,
 * so the browser blocks the response).
 */
app.use(
  '*',
  cors(
    env.isProduction
      ? {
          origin: (origin) =>
            origin && env.allowedOrigins.includes(origin) ? origin : null,
          allowHeaders: ['Authorization', 'Content-Type'],
        }
      : { origin: '*', allowHeaders: ['Authorization', 'Content-Type'] },
  ),
);

// Visit counter for the founder dashboard (backend/admin/visits.ts). A plain
// POST with a query string and no body, so browsers send it without a CORS
// preflight. Rate limited so one client can't inflate the count.
app.post('/api/visit', rateLimit('visit.ip', 30, 60 * 60_000), async (c) => {
  const platform = parsePlatform(c.req.query('platform'));
  if (!platform) return c.json({ error: 'Unknown platform' }, 400);
  await recordVisit(platform);
  return c.body(null, 204);
});

app.post('/api/sms/inbound', async (c) => {
  if (!c.req.header('content-type')?.includes('application/x-www-form-urlencoded')) return c.text('Unsupported media type', 415);
  const raw = await c.req.text();
  if (raw.length > 16384) return c.text('Request too large', 413);
  const status = await handleSmsOptOut(db, raw, c.req.header('x-twilio-signature') ?? '');
  if (status !== 200) return c.text('Callback refused', status as 400 | 403 | 503);
  return c.body('<Response/>', 200, { 'Content-Type': 'text/xml' });
});

app.get('/api/health', (c) => {
  const { mode, reason, requested } = paymentsMode();
  return c.json({
    ok: true,
    db: dbKind,
    demo: true,
    // The app derives every payment label from this — never hard-code a mode
    // in the client (docs/AUCTIONS.md §3).
    payments: {
      mode,
      requested,
      reason,
      simulated: mode === 'simulated',
      banner: mode === 'simulated' ? 'Simulated — no money moves.' : '',
    },
    sms: { mode: resolveSmsMode().mode, simulated: resolveSmsMode().mode === 'simulated' },
    email: { mode: resolveEmailMode().mode, simulated: resolveEmailMode().mode === 'simulated' },
    // "Get a Dibbs offer" (docs/PROJECT-DIRECTIVES.md, Nov 1): requests are
    // accepted even when none of this is configured, but staff can't review
    // them and sellers may not get an estimate or an alert. Surfaced here so
    // a stuck Render env var shows up without reading logs.
    dibbsOffers: {
      staffConfigured: env.dibbsStaffEmails.length > 0 || env.dibbsStaffUserIds.length > 0,
      teamInboxConfigured: Boolean(env.dibbsOffersEmail),
      privateMediaReady: privateMediaReady(),
    },
  });
});

/**
 * Stripe webhooks. The signature is verified over the RAW body, so this route
 * must read `c.req.text()` and never a parsed/re-serialized object. It is the
 * only thing in this codebase allowed to move a payment to a terminal state.
 */
app.post('/api/stripe/webhook', async (c) => {
  const rawBody = await c.req.text();
  const result = await processWebhook(db, rawBody, c.req.header('stripe-signature') ?? null);
  return c.json(result.body, result.status as 200);
});

/**
 * LOCAL TEST HOOK — not Stripe, not reachable in test/live mode.
 *
 * With no Stripe account there is no way for a simulated payment to reach
 * `paid`, so this drives the same webhook handler with a synthesized event.
 * Guarded by DEV_LOGIN=1 AND PAYMENTS_MODE resolving to `simulated`.
 */
app.post('/api/stripe/simulated-test-event', async (c) => {
  if (!simulateHookAllowed()) {
    return c.json({ error: 'Not found' }, 404);
  }
  let body: {
    type?: SimulatedEventKind;
    paymentIntentId?: string;
    accountId?: string;
    eventId?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Send a JSON body with a "type".' }, 400);
  }
  if (!body.type) return c.json({ error: 'Send a JSON body with a "type".' }, 400);

  const result = await processSimulatedEvent(db, {
    type: body.type,
    paymentIntentId: body.paymentIntentId,
    accountId: body.accountId,
    eventId: body.eventId,
  });
  return c.json(result.body, result.status as 200);
});

/**
 * Rate limiting — small in-memory, per-IP limiter (backend/ratelimit.ts).
 * Applied to the paths that can be abused: sign-in code requests and code
 * verification (guessing/spamming codes), reservation.checkAddress (calls a
 * free third-party geocoder — Nominatim — whose usage policy forbids heavy
 * use, see backend/geocode.ts and docs/HANDOFF.md), and photo uploads.
 * tRPC calls go through this app's httpLink (no batching), so each procedure
 * call is its own HTTP request at a predictable, stable path — see
 * lib/trpc.ts. Limits are env-tunable (see .env.example); this does NOT
 * scale to multiple instances — see the docstring in backend/ratelimit.ts
 * and docs/DEPLOY.md.
 */
// Blanket cap on the tRPC surface. Every limiter below it is narrower and
// still applies; this one exists because until now the API that carries all
// real traffic had no ceiling at all, so one client stuck in a retry loop —
// or anyone with curl — could saturate the backend. Keyed by session rather
// than IP so campus NAT does not put a whole building in one bucket.
app.use(
  '/api/trpc/*',
  rateLimit('api', env.rateLimitApiPerMinute, 60_000, callerKey, env.rateLimitApiAnonPerMinute),
);

app.use(
  '/api/trpc/auth.requestCode',
  rateLimit('auth.requestCode', env.rateLimitAuthRequestCodePerMinute, 60_000),
);
app.use(
  '/api/trpc/auth.requestPhoneCode*',
  rateLimit('auth.requestPhoneCode', env.rateLimitPhoneRequestPerMinute, 60_000),
);
app.use(
  '/api/trpc/auth.requestPhoneLinkCode*',
  rateLimit('auth.requestPhoneCode', env.rateLimitPhoneRequestPerMinute, 60_000),
);
app.use(
  '/api/trpc/auth.verifyPhoneCode*',
  rateLimit('auth.verifyPhoneCode', env.rateLimitPhoneVerifyPerMinute, 60_000),
);
app.use(
  '/api/trpc/auth.confirmPhoneLink*',
  rateLimit('auth.verifyPhoneCode', env.rateLimitPhoneVerifyPerMinute, 60_000),
);
app.use(
  '/api/trpc/auth.verifyCode',
  rateLimit('auth.verifyCode', env.rateLimitAuthVerifyCodePerMinute, 60_000),
);
app.use(
  '/api/trpc/reservation.checkAddress',
  rateLimit('reservation.checkAddress', env.rateLimitCheckAddressPerMinute, 60_000),
);
// Uploading needs a sign-in, so each person gets their own bucket. Only POST
// counts: every photo on screen is a GET here, and one shared per-IP bucket
// used to break images for a whole campus wifi after a few dozen. (The old
// '/api/uploads' + '/api/uploads/*' pair also counted each upload twice.)
app.on('POST', '/api/uploads', rateLimit('uploads', env.rateLimitUploadsPerMinute, 60_000, callerKey));
// Viewing photos: a high per-IP ceiling, only to stop a runaway scraper.
app.on('GET', '/api/uploads/:name', rateLimit('uploads.view', env.rateLimitPhotoViewsPerMinute, 60_000));

/** Multipart upload, field name `file`. Same bearer auth as tRPC. */
app.post('/api/uploads', async (c) => {
  const user = await userFromAuthHeader(c.req.header('authorization'));
  if (!user) return c.json({ error: 'Sign in to upload photos.' }, 401);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'That upload was not a valid multipart form.' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'Attach a photo in the "file" field.' }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'That image is larger than 8 MB. Try a smaller one.' }, 413);
  }

  const contentType = (file.type || '').toLowerCase();
  // SVG is storable (seeded demo art) but never accepted from a user.
  if (!(USER_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return c.json(
      { error: 'That file type is not supported. Use a JPEG, PNG, WebP or HEIC.' },
      415,
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { url } = await storage.put(sanitizeFileName(file.name), bytes, contentType);
    return c.json({ url });
  } catch (err) {
    if (err instanceof UploadError) return c.json({ error: err.message }, err.status as 400);
    return c.json({ error: 'That upload could not be saved.' }, 500);
  }
});

app.get('/api/uploads/:name', async (c) => {
  const found = await storage.get(c.req.param('name'));
  if (!found) return c.json({ error: 'Not found' }, 404);
  return c.body(found.bytes as unknown as ArrayBuffer, 200, {
    'Content-Type': found.contentType,
    'Cache-Control': 'public, max-age=86400',
  });
});

/* ------------------------------------------- private media (Dibbs offers) */

app.on('POST', '/api/private-media', rateLimit('uploads', env.rateLimitUploadsPerMinute, 60_000, callerKey));
app.on('GET', '/api/private-media/:id', rateLimit('uploads.view', env.rateLimitPhotoViewsPerMinute, 60_000));

/**
 * Upload a photo or short video for a "Get a Dibbs offer" request. Stored
 * privately and returned as an id; the request claims it on submit. Only the
 * uploader (and, once attached, Dibbs staff) can ever get a link to it.
 */
app.post('/api/private-media', async (c) => {
  const user = await userFromAuthHeader(c.req.header('authorization'));
  if (!user) return c.json({ error: 'Sign in to upload.' }, 401);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > PRIVATE_VIDEO_MAX_BYTES + 1024 * 1024) {
    return c.json({ error: 'That file is too large. Videos can be up to 50 MB and photos up to 8 MB.' }, 413);
  }
  const recent = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dibbsOfferMedia)
    .where(and(eq(dibbsOfferMedia.uploaderId, user.id), gte(dibbsOfferMedia.createdAt, new Date(Date.now() - 86_400_000))));
  if ((recent[0]?.n ?? 0) >= MAX_UNATTACHED_UPLOADS_PER_DAY) {
    return c.json({ error: 'You’ve uploaded a lot today. Try again tomorrow.' }, 429);
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'That upload was not a valid multipart form.' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'Attach a photo or video in the "file" field.' }, 400);
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const media = validatePrivateMedia(bytes, file.type || '');
    const key = newPrivateKey(media.ext);
    await putPrivate(key, bytes, media.contentType);
    const [row] = await db
      .insert(dibbsOfferMedia)
      .values({
        uploaderId: user.id,
        kind: media.kind,
        contentType: media.contentType,
        storageKey: key,
        bytes: bytes.byteLength,
        durationMs: media.durationMs,
      })
      .returning();
    return c.json({ id: row!.id, kind: media.kind, durationMs: media.durationMs, url: signedMediaPath(row!.id) });
  } catch (err) {
    if (err instanceof PrivateMediaError) return c.json({ error: err.message }, err.status);
    console.error('[private-media] upload failed');
    return c.json({ error: 'That upload could not be saved. Try again.' }, 500);
  }
});

/** Serves private media only with a valid, unexpired signature. Supports Range for video playback. */
app.get('/api/private-media/:id', async (c) => {
  const id = c.req.param('id');
  const noStore = { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (!/^[0-9a-f-]{36}$/.test(id) || !verifySignedMedia(id, c.req.query('e'), c.req.query('s'))) {
    return c.json({ error: 'This link has expired. Reopen the request to see it.' }, 403, noStore);
  }
  const [row] = await db.select().from(dibbsOfferMedia).where(eq(dibbsOfferMedia.id, id)).limit(1);
  const bytes = row ? await getPrivate(row.storageKey) : null;
  if (!row || !bytes) return c.json({ error: 'Not found' }, 404, noStore);
  const headers = { ...noStore, 'Content-Type': row.contentType, 'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
  if (range && (range[1] || range[2])) {
    const size = bytes.byteLength;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return c.body(null, 416, { ...headers, 'Content-Range': `bytes */${size}` });
    }
    return c.body(bytes.subarray(start, end + 1) as unknown as ArrayBuffer, 206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
    });
  }
  return c.body(bytes as unknown as ArrayBuffer, 200, headers);
});

app.use(
  '/api/trpc/*',
  trpcServer({
    endpoint: '/api/trpc',
    router: appRouter,
    createContext: (opts) => createContext(opts),
  }),
);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('[api error]', err);
  return c.json({ error: 'Something went wrong on our end.' }, 500);
});

/** Founder dashboard — password-protected, see backend/admin/routes.ts. */
app.route('/admin', adminApp);

export default app;
