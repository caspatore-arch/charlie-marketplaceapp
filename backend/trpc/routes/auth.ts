/**
 * Sign-in. Two ways in, one account model:
 *
 *  - Phone + SMS code (primary). Proves control of a phone number ONLY. A new
 *    phone account picks its campus but is NOT campus-verified until it also
 *    verifies a campus email (`linkEmail*`) — buying, selling and posting are
 *    gated on that (campusVerifiedProcedure).
 *  - Email + code. ANY email can sign in or create an account. A campus
 *    email (a campus's emailDomains or ALLOWED_EMAIL_DOMAINS) also marks the
 *    account campus-verified; any other email lands on the default campus,
 *    NOT campus-verified, and must verify a campus email (`linkEmail*`) before
 *    buying, selling or posting. It is also how email accounts sign in and
 *    then add a phone (`linkPhone*`).
 *
 * Delivery is SIMULATED unless configured for live sends: SMS via
 * backend/sms/provider.ts (Twilio), email via backend/email/provider.ts
 * (Resend). Email codes share the phone rules for cooldown and hourly cap. Codes are 6 digits,
 * expire in 10 minutes, allow 5 guesses, have a 30-second resend cooldown and
 * at most 5 sends per number (or address) per hour. Phone and email codes are
 * stored only as hashes. An email code is accepted only for the purpose it was
 * issued for ('sign_in' or 'verify_campus'), and wrong guesses are counted per
 * ADDRESS across all its live codes: the 5th wrong guess burns every live code
 * for that address. Code emails also have durable per-IP (and optional global)
 * daily caps stored in `auth_send_counts`.
 * Sessions are bearer tokens stored as sha256 hashes.
 */
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import { and, asc, desc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { env } from '../../env';
import type { Db } from '../../db/client';
import { authSendCounts, campuses, emailCodes, phoneCodes, sessions, users, type User } from '../../db/schema';
import { postingFields } from '../../auth/posting-access';
import { codesMatch, hasActivity, hashPhoneCode, newPhoneCode, retireEmptyAccount } from '../../auth/accounts';
import { normalizePhone, PhoneFormatError } from '../../sms/phone';
import { resolveSmsMode, smsProvider } from '../../sms/provider';
import { codeEmail, emailProvider, resolveEmailMode } from '../../email/provider';
import { SESSION_TTL_MS, hashToken, newSessionToken } from '../create-context';
import { protectedProcedure, publicProcedure, router } from '../trpc';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
export const PHONE_RESEND_COOLDOWN_MS = 30 * 1000;
export const PHONE_MAX_CODES_PER_HOUR = 5;
export const PHONE_MAX_ATTEMPTS = 5;

function parsePhone(raw: string): string {
  try {
    return normalizePhone(raw);
  } catch (err) {
    if (err instanceof PhoneFormatError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
    throw err;
  }
}

/** Issues and texts a code, enforcing the cooldown and hourly cap. */
async function sendPhoneCode(db: Db, phone: string, purpose: 'sign_in' | 'link', userId: string | null) {
  const now = Date.now();
  const recent = await db
    .select({ createdAt: phoneCodes.createdAt })
    .from(phoneCodes)
    .where(and(eq(phoneCodes.phone, phone), gte(phoneCodes.createdAt, new Date(now - 60 * 60 * 1000))))
    .orderBy(desc(phoneCodes.createdAt));
  const last = recent[0]?.createdAt.getTime();
  if (last && now - last < PHONE_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((PHONE_RESEND_COOLDOWN_MS - (now - last)) / 1000);
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `Wait ${wait}s before requesting another code.` });
  }
  if (recent.length >= PHONE_MAX_CODES_PER_HOUR) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many codes for this number. Try again in an hour.',
    });
  }

  const code = newPhoneCode();
  const [row] = await db
    .insert(phoneCodes)
    .values({
      phone,
      codeHash: hashPhoneCode(phone, code),
      purpose,
      userId,
      expiresAt: new Date(now + PHONE_CODE_TTL_MS),
    })
    .returning({ id: phoneCodes.id });

  try {
    await smsProvider().send(phone, `Your Dibbs code is ${code}. It expires in 10 minutes. Don't share it.`, {
      sensitive: true,
    });
  } catch {
    // Never leave a usable code behind for a text that didn't go out.
    await db.update(phoneCodes).set({ consumedAt: new Date() }).where(eq(phoneCodes.id, row!.id));
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "We couldn't send the code. Try again." });
  }

  return {
    ok: true as const,
    simulated: resolveSmsMode().mode === 'simulated',
    resendAfterSeconds: PHONE_RESEND_COOLDOWN_MS / 1000,
    expiresInSeconds: PHONE_CODE_TTL_MS / 1000,
  };
}

/**
 * Checks a code without consuming it. Wrong guesses count against the code;
 * the 5th wrong guess burns it. Returns the code row on success.
 */
async function checkPhoneCode(db: Db, phone: string, code: string, purpose: 'sign_in' | 'link', userId: string | null) {
  const [row] = await db
    .select()
    .from(phoneCodes)
    .where(
      and(
        eq(phoneCodes.phone, phone),
        eq(phoneCodes.purpose, purpose),
        isNull(phoneCodes.consumedAt),
        gt(phoneCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(phoneCodes.createdAt))
    .limit(1);
  if (!row || (purpose === 'link' && row.userId !== userId)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That code has expired. Request a new one.' });
  }
  if (row.attempts >= PHONE_MAX_ATTEMPTS) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Too many wrong tries. Request a new code.' });
  }
  if (!codesMatch(row.codeHash, hashPhoneCode(phone, code))) {
    const attempts = row.attempts + 1;
    await db
      .update(phoneCodes)
      .set({ attempts, consumedAt: attempts >= PHONE_MAX_ATTEMPTS ? new Date() : null })
      .where(eq(phoneCodes.id, row.id));
    const left = PHONE_MAX_ATTEMPTS - attempts;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: left > 0 ? `That code is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Request a new code.',
    });
  }
  return row;
}

async function consumePhoneCode(db: Db, id: string) {
  await db.update(phoneCodes).set({ consumedAt: new Date() }).where(eq(phoneCodes.id, id));
}

async function withCampus(db: Db, user: User) {
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, user.campusId)).limit(1);
  return { ...user, campus: campus!, ...postingFields(user) };
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/** The campus a campus-domain email belongs to, or null for any other email. */
async function resolveCampus(db: Db, email: string) {
  const domain = domainOf(email);
  const all = await db.select().from(campuses).orderBy(asc(campuses.name));
  const match = all.find((c) => c.emailDomains.map((d) => d.toLowerCase()).includes(domain));
  if (match) return match;
  if (env.allowedEmailDomains.includes(domain) && all[0]) return all[0];
  return null;
}

/**
 * Where a non-campus email account lives: the pilot campus (first by name, the
 * same one the phone flow auto-picks when there is only one).
 */
async function defaultCampus(db: Db) {
  const [first] = await db.select().from(campuses).orderBy(asc(campuses.name)).limit(1);
  if (!first) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No campus is set up yet.' });
  return first;
}

async function issueSession(db: typeof import('../../db/client').db, userId: string) {
  const token = newSessionToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export const EMAIL_RESEND_COOLDOWN_MS = 30 * 1000;
export const EMAIL_MAX_CODES_PER_HOUR = 5;
export const EMAIL_MAX_ATTEMPTS = 5;

type EmailCodePurpose = 'sign_in' | 'verify_campus';

/** Only this hash is stored. The purpose is part of it, so a code only works for what it was issued for. */
export function hashEmailCode(email: string, purpose: EmailCodePurpose, code: string): string {
  return crypto.createHash('sha256').update(`email:${email}:${purpose}:${code}`).digest('hex');
}

/**
 * The caller's IP. backend/hono.ts sets it on the request context from
 * `clientIp`. Direct callers (tests, scripts) have none, and the per-IP daily
 * cap is skipped for them.
 */
function callerIp(ctx: unknown): string | null {
  const ip = (ctx as { ip?: unknown }).ip;
  return typeof ip === 'string' && ip.trim() && ip.trim() !== 'unknown' ? ip.trim() : null;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Atomically adds one to a durable daily counter and returns the new value. */
async function bumpDailyCount(db: Db, bucket: string, now: number): Promise<number> {
  const [row] = await db
    .insert(authSendCounts)
    .values({ bucket, day: utcDay(now), count: 1 })
    .onConflictDoUpdate({
      target: [authSendCounts.bucket, authSendCounts.day],
      set: { count: sql`${authSendCounts.count} + 1` },
    })
    .returning({ count: authSendCounts.count });
  // Keep the table to about two days of rows without a timer.
  if (Math.random() < 0.02) {
    await db.delete(authSendCounts).where(lt(authSendCounts.day, utcDay(now - 2 * 24 * 60 * 60 * 1000)));
  }
  return row!.count;
}

/**
 * Durable daily caps on code emails, checked after the per-address cooldown so
 * refused resends don't count. Per IP (hashed, never stored raw) and an
 * optional global cap that is off by default.
 */
async function enforceDailyEmailCaps(db: Db, ip: string | null, now: number) {
  const perIp = env.emailCodesPerIpPerDay;
  if (ip && perIp > 0) {
    const bucket = `ip:${crypto.createHash('sha256').update(ip).digest('base64url').slice(0, 22)}`;
    if ((await bumpDailyCount(db, bucket, now)) > perIp) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many sign-in codes from this network today. Try again tomorrow or sign in with your phone.',
      });
    }
  }
  const global = env.emailCodesGlobalPerDay;
  if (global > 0 && (await bumpDailyCount(db, 'global', now)) > global) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Sign-in emails are paused for today. Try again tomorrow or sign in with your phone.',
    });
  }
}

/**
 * Issues an email code and sends it, with the same cooldown and hourly cap as
 * phone codes plus the durable daily caps. The hourly cap derives issue time
 * from expires_at - CODE_TTL_MS (tests age codes that way). A new code inherits
 * the address's current wrong-guess count, so requesting another code does not
 * reset it; only the 5th wrong guess (which burns every live code) does.
 * A failed send burns the code.
 */
async function sendEmailCode(
  db: Db,
  email: string,
  purpose: EmailCodePurpose,
  userId: string | null,
  ip: string | null,
) {
  const now = Date.now();
  const recent = await db
    .select({ expiresAt: emailCodes.expiresAt })
    .from(emailCodes)
    .where(and(eq(emailCodes.email, email), gte(emailCodes.expiresAt, new Date(now - 60 * 60 * 1000 + CODE_TTL_MS))))
    .orderBy(desc(emailCodes.expiresAt));
  const lastIssued = recent[0] ? recent[0].expiresAt.getTime() - CODE_TTL_MS : null;
  if (lastIssued && now - lastIssued < EMAIL_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((EMAIL_RESEND_COOLDOWN_MS - (now - lastIssued)) / 1000);
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `Wait ${wait}s before requesting another code.` });
  }
  if (recent.length >= EMAIL_MAX_CODES_PER_HOUR) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many codes for this email. Try again in an hour.' });
  }
  await enforceDailyEmailCaps(db, ip, now);

  const [carried] = await db
    .select({ attempts: sql<number>`coalesce(max(${emailCodes.attempts}), 0)` })
    .from(emailCodes)
    .where(and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt), gt(emailCodes.expiresAt, new Date(now))));

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const [row] = await db
    .insert(emailCodes)
    .values({
      email,
      codeHash: hashEmailCode(email, purpose, code),
      purpose,
      userId,
      attempts: Number(carried?.attempts ?? 0),
      expiresAt: new Date(now + CODE_TTL_MS),
    })
    .returning({ id: emailCodes.id });
  try {
    await emailProvider().send(codeEmail(email, code, purpose));
  } catch (err) {
    await db.update(emailCodes).set({ consumedAt: new Date() }).where(eq(emailCodes.id, row!.id));
    console.error('[email] code send failed:', err instanceof Error ? err.message : err);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "We couldn't send the code. Try again." });
  }
  return {
    ok: true as const,
    simulated: resolveEmailMode().mode === 'simulated',
    resendAfterSeconds: EMAIL_RESEND_COOLDOWN_MS / 1000,
  };
}

const EMAIL_CODE_GONE = 'That code is wrong or has expired. Request a new one.';
const EMAIL_CODE_LOCKED = 'Too many wrong tries. Request a new code.';

async function burnLiveEmailCodes(db: Db, email: string, now: Date) {
  await db
    .update(emailCodes)
    .set({ consumedAt: now })
    .where(and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt)));
}

/**
 * Checks and CONSUMES an email code. Every try is counted against the address
 * before the comparison (an atomic increment on all its live codes), so
 * parallel guesses can't slip past the limit. Only the newest live code issued
 * for `purpose` (and, for 'verify_campus', for this `userId`) is compared. The
 * 5th wrong try burns every live code for the address. Messages never depend on
 * whether the address has an account.
 */
async function useEmailCode(db: Db, email: string, code: string, purpose: EmailCodePurpose, userId: string | null) {
  const now = new Date();
  const live = await db
    .update(emailCodes)
    .set({ attempts: sql`${emailCodes.attempts} + 1` })
    .where(and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt), gt(emailCodes.expiresAt, now)))
    .returning();
  if (live.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: EMAIL_CODE_GONE });

  const tries = Math.max(...live.map((r) => r.attempts));
  if (tries > EMAIL_MAX_ATTEMPTS) {
    await burnLiveEmailCodes(db, email, now);
    throw new TRPCError({ code: 'BAD_REQUEST', message: EMAIL_CODE_LOCKED });
  }

  const candidate = live
    .filter((r) => r.purpose === purpose && (purpose !== 'verify_campus' || r.userId === userId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.expiresAt.getTime() - a.expiresAt.getTime())[0];
  const ok = !!candidate && codesMatch(candidate.codeHash, hashEmailCode(email, purpose, code));
  if (!ok) {
    if (tries >= EMAIL_MAX_ATTEMPTS) {
      await burnLiveEmailCodes(db, email, now);
      throw new TRPCError({ code: 'BAD_REQUEST', message: EMAIL_CODE_LOCKED });
    }
    const left = EMAIL_MAX_ATTEMPTS - tries;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `That code is wrong or has expired. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
    });
  }

  // Consume exactly once, even if the same right code arrives twice at once.
  const [used] = await db
    .update(emailCodes)
    .set({ consumedAt: now })
    .where(and(eq(emailCodes.id, candidate.id), isNull(emailCodes.consumedAt)))
    .returning({ id: emailCodes.id });
  if (!used) throw new TRPCError({ code: 'BAD_REQUEST', message: EMAIL_CODE_GONE });
  // The right code was not a wrong guess: take back the try counted on the others.
  await db
    .update(emailCodes)
    .set({ attempts: sql`greatest(${emailCodes.attempts} - 1, 0)` })
    .where(and(eq(emailCodes.email, email), isNull(emailCodes.consumedAt), gt(emailCodes.expiresAt, now)));
  return candidate;
}

export const authRouter = router({
  requestCode: publicProcedure
    .input(z.object({ email: z.email() }))
    .mutation(async ({ ctx, input }) => {
      // Any email can sign in; the cooldown and hourly cap apply to all of them.
      const email = input.email.trim().toLowerCase();
      return sendEmailCode(ctx.db, email, 'sign_in', null, callerIp(ctx));
    }),

  /**
   * Which sign-in methods actually deliver codes right now. The client leads
   * with email until SMS is live (carrier registration takes weeks); phone
   * stays available as a secondary option. Simulated flags let the UI show
   * the "development: code is in the server log" note honestly.
   */
  methods: publicProcedure.query(() => {
    const sms = resolveSmsMode().mode;
    const email = resolveEmailMode().mode;
    return {
      primary: sms === 'live' ? ('phone' as const) : ('email' as const),
      phone: { available: true, simulated: sms === 'simulated' },
      email: { available: true, simulated: email === 'simulated' },
    };
  }),

  verifyCode: publicProcedure
    .input(
      z.object({
        email: z.email(),
        code: z.string().length(6),
        displayName: z.string().min(1).max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      // Checks, counts and consumes; only a code issued for sign-in works here.
      await useEmailCode(ctx.db, email, input.code, 'sign_in', null);

      // A campus-domain email verifies campus membership; any other email
      // signs in but leaves the account NOT campus-verified (default campus).
      const campusMatch = await resolveCampus(ctx.db, email);

      let [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
      // Lets the client send a brand-new account to profile setup and a
      // returning one straight into the app.
      const isNewAccount = !user;
      if (!user) {
        const campus = campusMatch ?? (await defaultCampus(ctx.db));
        [user] = await ctx.db
          .insert(users)
          .values({
            email,
            displayName: input.displayName?.trim() || email.split('@')[0]!,
            campusId: campus.id,
            campusEmailVerifiedAt: campusMatch ? new Date() : null,
          })
          .returning();
      } else if (campusMatch && !user.campusEmailVerifiedAt) {
        [user] = await ctx.db
          .update(users)
          .set({ campusEmailVerifiedAt: new Date() })
          .where(eq(users.id, user.id))
          .returning();
      }

      const token = await issueSession(ctx.db, user!.id);
      // `user` carries its campus so the client can hydrate the same shape
      // `auth.me` returns without a second round trip.
      return { token, isNewAccount, user: await withCampus(ctx.db, user!) };
    }),

  /**
   * Dev-only identity switcher for the demo. Needs DEV_LOGIN=1 AND a
   * non-production NODE_ENV (env.devLogin checks both; the server also refuses
   * to start with DEV_LOGIN=1 in production).
   */
  devSignIn: publicProcedure
    .input(z.object({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!env.devLogin || env.isProduction) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Dev sign-in is disabled.' });
      }
      const [user] = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'That test user does not exist.' });

      const [campus] = await ctx.db
        .select()
        .from(campuses)
        .where(eq(campuses.id, user.campusId))
        .limit(1);

      const token = await issueSession(ctx.db, user.id);
      return { token, user: { ...user, campus: campus!, ...postingFields(user) } };
    }),

  /* ------------------------------------------------------------ phone */

  /** Step 1 of phone sign-in: text a 6-digit code. */
  requestPhoneCode: publicProcedure
    .input(z.object({ phone: z.string().min(7).max(25) }))
    .mutation(async ({ ctx, input }) => sendPhoneCode(ctx.db, parsePhone(input.phone), 'sign_in', null)),

  /**
   * Step 2. Existing number → signed in. New number → `needs_profile` (the
   * code is NOT consumed) until the client sends displayName + campusId, then
   * a new, NOT campus-verified account is created.
   */
  verifyPhoneCode: publicProcedure
    .input(
      z.object({
        phone: z.string().min(7).max(25),
        code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
        displayName: z.string().trim().min(1).max(60).optional(),
        campusId: z.uuid().optional(),
        /** Explicit consent to transactional texts (unchecked by default). */
        smsOptIn: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const phone = parsePhone(input.phone);
      const code = await checkPhoneCode(ctx.db, phone, input.code, 'sign_in', null);

      const [existing] = await ctx.db.select().from(users).where(eq(users.phone, phone)).limit(1);
      if (existing && !existing.deletedAt) {
        await consumePhoneCode(ctx.db, code.id);
        const token = await issueSession(ctx.db, existing.id);
        return { status: 'signed_in' as const, token, isNewAccount: false, user: await withCampus(ctx.db, existing) };
      }

      if (!input.displayName || !input.campusId) {
        return { status: 'needs_profile' as const };
      }
      const [campus] = await ctx.db.select().from(campuses).where(eq(campuses.id, input.campusId)).limit(1);
      if (!campus) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick your campus.' });

      await consumePhoneCode(ctx.db, code.id);
      const now = new Date();
      const [user] = await ctx.db
        .insert(users)
        .values({
          email: null,
          phone,
          phoneVerifiedAt: now,
          displayName: input.displayName,
          campusId: campus.id,
          // Deliberately null: a phone is not proof of being a student here.
          campusEmailVerifiedAt: null,
          smsOptIn: input.smsOptIn ?? false,
          smsOptInAt: input.smsOptIn ? now : null,
        })
        .returning();
      const token = await issueSession(ctx.db, user!.id);
      return { status: 'signed_in' as const, token, isNewAccount: true, user: { ...user!, campus, ...postingFields(user!) } };
    }),

  /** Signed in (e.g. by email): text a code to attach a phone to THIS account. */
  requestPhoneLinkCode: protectedProcedure
    .input(z.object({ phone: z.string().min(7).max(25) }))
    .mutation(async ({ ctx, input }) => {
      const phone = parsePhone(input.phone);
      if (ctx.user.phone === phone && ctx.user.phoneVerifiedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That number is already on your account.' });
      }
      return sendPhoneCode(ctx.db, phone, 'link', ctx.user.id);
    }),

  /**
   * Attach a verified phone to the caller. If another account already uses
   * the number, it is moved here only when that account is empty (it is then
   * retired); otherwise CONFLICT — accounts with history are never merged.
   */
  confirmPhoneLink: protectedProcedure
    .input(
      z.object({
        phone: z.string().min(7).max(25),
        code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
        smsOptIn: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const phone = parsePhone(input.phone);
      const code = await checkPhoneCode(ctx.db, phone, input.code, 'link', ctx.user.id);
      const [owner] = await ctx.db.select().from(users).where(eq(users.phone, phone)).limit(1);
      if (owner && owner.id !== ctx.user.id) {
        if (await hasActivity(ctx.db, owner.id)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'That number belongs to another Dibbs account with listings or meetups. Sign in with the phone to use that account, or contact support to combine them.',
          });
        }
        await retireEmptyAccount(ctx.db, owner, ctx.user.id);
      }
      await consumePhoneCode(ctx.db, code.id);
      const now = new Date();
      const [user] = await ctx.db
        .update(users)
        .set({
          phone,
          phoneVerifiedAt: now,
          ...(input.smsOptIn === undefined
            ? {}
            : input.smsOptIn
              ? { smsOptIn: true, smsOptInAt: now }
              : { smsOptIn: false, smsOptOutAt: now }),
        })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return { ok: true as const, user: await withCampus(ctx.db, user!) };
    }),

  /** Signed in by phone: send a campus-email code to verify campus membership. */
  requestEmailLinkCode: protectedProcedure
    .input(z.object({ email: z.email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const campus = await resolveCampus(ctx.db, email);
      if (!campus) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That isn’t a campus email address. Use your school email to verify.' });
      }
      return sendEmailCode(ctx.db, email, 'verify_campus', ctx.user.id, callerIp(ctx));
    }),

  /**
   * Verify the campus email for the caller. Safe transition when the email
   * already has an account:
   *  - caller is empty → the caller's phone moves to the email account, the
   *    caller is retired, and a session for the email account is returned
   *    (`switchedAccount: true`) — listings and bookings stay where they are.
   *  - email account is empty → it is retired and the email moves here.
   *  - both have history → CONFLICT, nothing changes.
   *
   * The code must have been issued for 'verify_campus' to THIS caller, and it
   * shares the address's 5-wrong-guess limit with sign-in codes. Knowing it
   * proves control of the inbox, which already lets anyone sign in to the
   * email account with a sign-in code, so the switch grants nothing more. The
   * code is consumed by the check, so a CONFLICT means requesting a new one.
   */
  confirmEmailLink: protectedProcedure
    .input(z.object({ email: z.email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const campus = await resolveCampus(ctx.db, email);
      if (!campus) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That isn’t a campus email address. Use your school email to verify.' });

      // Checks, counts and consumes; only a campus code issued to this caller works.
      await useEmailCode(ctx.db, email, input.code, 'verify_campus', ctx.user.id);

      const me = ctx.user;
      const [owner] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
      const now = new Date();

      if (owner && owner.id !== me.id && !owner.deletedAt) {
        const [meBusy, ownerBusy] = await Promise.all([hasActivity(ctx.db, me.id), hasActivity(ctx.db, owner.id)]);
        if (!meBusy) {
          // Fold the empty phone account into the existing email account.
          await retireEmptyAccount(ctx.db, me, owner.id);
          const [merged] = await ctx.db
            .update(users)
            .set({
              campusEmailVerifiedAt: owner.campusEmailVerifiedAt ?? now,
              ...(me.phone && me.phoneVerifiedAt && !owner.phone
                ? { phone: me.phone, phoneVerifiedAt: me.phoneVerifiedAt, smsOptIn: me.smsOptIn, smsOptInAt: me.smsOptInAt }
                : {}),
            })
            .where(eq(users.id, owner.id))
            .returning();
          const token = await issueSession(ctx.db, owner.id);
          return { switchedAccount: true as const, token, user: await withCampus(ctx.db, merged!) };
        }
        if (ownerBusy) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'That campus email already has a Dibbs account with listings or meetups. Sign in with the email instead, or contact support to combine accounts.',
          });
        }
        await retireEmptyAccount(ctx.db, owner, me.id);
      }

      const [user] = await ctx.db
        .update(users)
        .set({ email, campusEmailVerifiedAt: now, campusId: campus.id })
        .where(eq(users.id, me.id))
        .returning();
      return { switchedAccount: false as const, token: null, user: { ...user!, campus, ...postingFields(user!) } };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const [campus] = await ctx.db
      .select()
      .from(campuses)
      .where(eq(campuses.id, ctx.user.campusId))
      .limit(1);
    // canPost / postingStatus: what the app's sell, offer, booking and post gates follow.
    return { ...ctx.user, campus: campus!, ...postingFields(ctx.user) };
  }),

  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(sessions).where(eq(sessions.userId, ctx.user.id));
    return { ok: true as const };
  }),
});
