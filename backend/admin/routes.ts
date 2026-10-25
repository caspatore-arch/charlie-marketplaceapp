/**
 * Founder dashboard at /admin, separate from the app and its accounts.
 *
 * One password, ADMIN_PASSWORD, set only on the server host. Unset (or
 * shorter than 16 characters) means the whole /admin area answers 404.
 *
 * Signing in sets a cookie that keeps you signed in indefinitely: it is
 * re-issued on every visit, so it never runs out while you keep using it
 * (browsers cap a single cookie at about 400 days). The cookie value is an
 * HMAC of the password, so CHANGING ADMIN_PASSWORD SIGNS OUT EVERY BROWSER —
 * that is the way to revoke access if a device is lost.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { rateLimit } from '../ratelimit';
import { searchAccessUsers, searchQuery, setAccessInput, setPostingAccess } from './access';
import { getAdminStats } from './stats';
import { dashboardPage, loginPage } from './page';

const COOKIE = 'dibbs_admin';
const MIN_PASSWORD_LENGTH = 16;
/** Browsers clamp Max-Age to ~400 days; refreshed on every visit. */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

function adminPassword(): string | null {
  const v = process.env.ADMIN_PASSWORD?.trim();
  return v && v.length >= MIN_PASSWORD_LENGTH ? v : null;
}

function sessionValue(password: string): string {
  return createHmac('sha256', password).update('dibbs-admin-session-v1').digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isHttps(c: Context): boolean {
  return c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
}

function signedIn(c: Context, password: string): boolean {
  const cookie = getCookie(c, COOKIE);
  return !!cookie && safeEqual(cookie, sessionValue(password));
}

/**
 * Cross-site request check for state-changing calls. The cookie is already
 * SameSite=Strict; on top of that a POST must carry an Origin (or, failing
 * that, a Referer) whose host is this server's host. Missing both = refused.
 */
function sameOrigin(c: Context): boolean {
  const source = c.req.header('origin') || c.req.header('referer');
  if (!source) return false;
  let host: string;
  try {
    host = new URL(source).host;
  } catch {
    return false;
  }
  const own = [c.req.header('x-forwarded-host'), c.req.header('host'), new URL(c.req.url).host];
  return own.some((h) => !!h && h.split(',')[0]!.trim() === host);
}

function setSession(c: Context, password: string) {
  setCookie(c, COOKIE, sessionValue(password), {
    path: '/admin',
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    maxAge: COOKIE_MAX_AGE,
  });
}

export const adminApp = new Hono();

// Never cache, never index, never frame.
adminApp.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
});

// Disabled entirely until a strong password is configured.
adminApp.use('*', async (c, next) => {
  if (!adminPassword()) return c.notFound();
  return next();
});

// Guessing limits: 5 tries per 15 min per address, and 20 per 15 min in total
// (the per-address one can be dodged by faking proxy headers; the total can't).
adminApp.post('/login', rateLimit('admin.login.ip', 5, 15 * 60_000));
adminApp.post('/login', rateLimit('admin.login.all', 20, 15 * 60_000, () => 'all'));

adminApp.get('/', (c) => {
  const password = adminPassword()!;
  if (!signedIn(c, password)) return c.html(loginPage());
  setSession(c, password); // slide the expiry forward on every visit
  return c.html(dashboardPage());
});

adminApp.post('/login', async (c) => {
  const password = adminPassword()!;
  const body = await c.req.parseBody();
  const attempt = typeof body.password === 'string' ? body.password : '';
  if (!safeEqual(sessionValue(attempt), sessionValue(password))) {
    return c.html(loginPage('That password is not right.'), 401);
  }
  setSession(c, password);
  return c.redirect('/admin', 303);
});

adminApp.post('/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/admin' });
  return c.redirect('/admin', 303);
});

adminApp.get('/stats.json', async (c) => {
  const password = adminPassword()!;
  if (!signedIn(c, password)) return c.json({ error: 'Signed out' }, 401);
  return c.json(await getAdminStats());
});

// Posting access (who may buy, sell, offer, book and post). Same sign-in
// check as stats, limited like login (per address and in total), and the
// POST also has to pass the same-origin check.
adminApp.get('/users.json', rateLimit('admin.users.ip', 60, 60_000));
adminApp.get('/users.json', rateLimit('admin.users.all', 240, 60_000, () => 'all'));
adminApp.post('/users/access', rateLimit('admin.access.ip', 30, 60_000));
adminApp.post('/users/access', rateLimit('admin.access.all', 120, 60_000, () => 'all'));

adminApp.get('/users.json', async (c) => {
  const password = adminPassword()!;
  if (!signedIn(c, password)) return c.json({ error: 'Signed out' }, 401);
  const parsed = searchQuery.safeParse({ q: c.req.query('q') ?? '' });
  if (!parsed.success) return c.json({ error: 'Search is too long.' }, 400);
  return c.json({ users: await searchAccessUsers(parsed.data.q) });
});

adminApp.post('/users/access', async (c) => {
  const password = adminPassword()!;
  if (!signedIn(c, password)) return c.json({ error: 'Signed out' }, 401);
  if (!sameOrigin(c)) return c.json({ error: 'Cross-site request refused.' }, 403);
  // JSON only: a plain cross-site form can't send this content type.
  if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'Send JSON.' }, 415);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Send JSON.' }, 400);
  }
  const parsed = setAccessInput.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Pick an account and Default, Approved or Blocked.' }, 400);
  const user = await setPostingAccess(parsed.data);
  if (!user) return c.json({ error: 'No open account with that id.' }, 404);
  return c.json({ user });
});
