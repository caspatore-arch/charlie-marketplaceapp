import { trpcServer } from '@hono/trpc-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { db, dbKind } from './db/client';
import { env } from './env';
import { rateLimit } from './ratelimit';
import { paymentsMode } from './stripe/client';
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
app.use(
  '/api/trpc/auth.requestCode',
  rateLimit('auth.requestCode', env.rateLimitAuthRequestCodePerMinute, 60_000),
);
app.use(
  '/api/trpc/auth.verifyCode',
  rateLimit('auth.verifyCode', env.rateLimitAuthVerifyCodePerMinute, 60_000),
);
app.use(
  '/api/trpc/reservation.checkAddress',
  rateLimit('reservation.checkAddress', env.rateLimitCheckAddressPerMinute, 60_000),
);
app.use('/api/uploads', rateLimit('uploads', env.rateLimitUploadsPerMinute, 60_000));
app.use('/api/uploads/*', rateLimit('uploads', env.rateLimitUploadsPerMinute, 60_000));

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

export default app;
