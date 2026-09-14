import { trpcServer } from '@hono/trpc-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { dbKind } from './db/client';
import {
  LocalDiskStorage,
  MAX_UPLOAD_BYTES,
  UploadError,
  USER_CONTENT_TYPES,
  sanitizeFileName,
} from './storage';
import { appRouter } from './trpc/app-router';
import { createContext, userFromAuthHeader } from './trpc/create-context';

const storage = new LocalDiskStorage();

export const app = new Hono();

// Dev-permissive CORS: the Expo app is served from an arbitrary LAN origin.
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }));

app.get('/api/health', (c) =>
  c.json({ ok: true, db: dbKind, demo: true }),
);

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
