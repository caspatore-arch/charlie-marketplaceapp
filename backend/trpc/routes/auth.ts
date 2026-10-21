/**
 * Sign-in. Two ways in, one account model:
 *
 *  - Phone + SMS code (primary). Proves control of a phone number ONLY. A new
 *    phone account picks its campus but is NOT campus-verified until it also
 *    verifies a campus email (`linkEmail*`) — buying, selling and posting are
 *    gated on that (campusVerifiedProcedure).
 *  - Campus email + code (original). Still works; it is also how existing
 *    email accounts sign in and then add a phone (`linkPhone*`).
 *
 * Delivery is SIMULATED unless configured for live sends: SMS via
 * backend/sms/provider.ts (Twilio), email via backend/email/provider.ts
 * (Resend). Email codes share the phone rules for cooldown and hourly cap. Codes are 6 digits,
 * expire in 10 minutes, allow 5 guesses, have a 30-second resend cooldown and
 * at most 5 sends per number per hour. Phone codes are stored only as hashes.
 * Sessions are bearer tokens stored as sha256 hashes.
 */
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import { and, desc, eq, gt, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { env } from '../../env';
import type { Db } from '../../db/client';
import { campuses, emailCodes, phoneCodes, sessions, users, type User } from '../../db/schema';
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
  return { ...user, campus: campus! };
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

async function resolveCampus(db: typeof import('../../db/client').db, email: string) {
  const domain = domainOf(email);
  const all = await db.select().from(campuses);
  const match = all.find((c) => c.emailDomains.map((d) => d.toLowerCase()).includes(domain));
  if (match) return match;
  if (env.allowedEmailDomains.includes(domain) && all[0]) return all[0];
  return null;
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

/**
 * Issues an email code and sends it, with the same cooldown and hourly cap as
 * phone codes. `email_codes` has no created_at, so issue time is derived from
 * expires_at - CODE_TTL_MS. A failed send burns the code.
 */
async function sendEmailCode(db: Db, email: string, purpose: 'sign_in' | 'verify_campus') {
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

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const [row] = await db
    .insert(emailCodes)
    .values({ email, code, expiresAt: new Date(now + CODE_TTL_MS) })
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

export const authRouter = router({
  requestCode: publicProcedure
    .input(z.object({ email: z.email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const campus = await resolveCampus(ctx.db, email);
      if (!campus) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Use your campus email address to sign in.',
        });
      }

      return sendEmailCode(ctx.db, email, 'sign_in');
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

      const [record] = await ctx.db
        .select()
        .from(emailCodes)
        .where(
          and(
            eq(emailCodes.email, email),
            eq(emailCodes.code, input.code),
            isNull(emailCodes.consumedAt),
            gt(emailCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(emailCodes.expiresAt))
        .limit(1);

      if (!record) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That code is wrong or has expired. Request a new one.',
        });
      }
      await ctx.db
        .update(emailCodes)
        .set({ consumedAt: new Date() })
        .where(eq(emailCodes.id, record.id));

      const campus = await resolveCampus(ctx.db, email);
      if (!campus) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Use your campus email address to sign in.',
        });
      }

      let [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
      // Lets the client send a brand-new account to profile setup and a
      // returning one straight into the app.
      const isNewAccount = !user;
      if (!user) {
        [user] = await ctx.db
          .insert(users)
          .values({
            email,
            displayName: input.displayName?.trim() || email.split('@')[0]!,
            campusId: campus.id,
            campusEmailVerifiedAt: new Date(),
          })
          .returning();
      } else if (!user.campusEmailVerifiedAt) {
        [user] = await ctx.db
          .update(users)
          .set({ campusEmailVerifiedAt: new Date() })
          .where(eq(users.id, user.id))
          .returning();
      }

      const token = await issueSession(ctx.db, user!.id);
      // `user` carries its campus so the client can hydrate the same shape
      // `auth.me` returns without a second round trip.
      return { token, isNewAccount, user: { ...user!, campus } };
    }),

  /** Dev-only identity switcher for the demo. Disabled unless DEV_LOGIN=1. */
  devSignIn: publicProcedure
    .input(z.object({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!env.devLogin) {
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
      return { token, user: { ...user, campus: campus! } };
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
      return { status: 'signed_in' as const, token, isNewAccount: true, user: { ...user!, campus } };
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
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use your campus email address.' });
      }
      return sendEmailCode(ctx.db, email, 'verify_campus');
    }),

  /**
   * Verify the campus email for the caller. Safe transition when the email
   * already has an account:
   *  - caller is empty → the caller's phone moves to the email account, the
   *    caller is retired, and a session for the email account is returned
   *    (`switchedAccount: true`) — listings and bookings stay where they are.
   *  - email account is empty → it is retired and the email moves here.
   *  - both have history → CONFLICT, nothing changes.
   */
  confirmEmailLink: protectedProcedure
    .input(z.object({ email: z.email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const [record] = await ctx.db
        .select()
        .from(emailCodes)
        .where(
          and(
            eq(emailCodes.email, email),
            eq(emailCodes.code, input.code),
            isNull(emailCodes.consumedAt),
            gt(emailCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(emailCodes.expiresAt))
        .limit(1);
      if (!record) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That code is wrong or has expired. Request a new one.' });
      }
      const campus = await resolveCampus(ctx.db, email);
      if (!campus) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use your campus email address.' });

      const me = ctx.user;
      const [owner] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
      const now = new Date();

      if (owner && owner.id !== me.id && !owner.deletedAt) {
        const [meBusy, ownerBusy] = await Promise.all([hasActivity(ctx.db, me.id), hasActivity(ctx.db, owner.id)]);
        if (!meBusy) {
          // Fold the empty phone account into the existing email account.
          await ctx.db.update(emailCodes).set({ consumedAt: now }).where(eq(emailCodes.id, record.id));
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

      await ctx.db.update(emailCodes).set({ consumedAt: now }).where(eq(emailCodes.id, record.id));
      const [user] = await ctx.db
        .update(users)
        .set({ email, campusEmailVerifiedAt: now, campusId: campus.id })
        .where(eq(users.id, me.id))
        .returning();
      return { switchedAccount: false as const, token: null, user: { ...user!, campus } };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const [campus] = await ctx.db
      .select()
      .from(campuses)
      .where(eq(campuses.id, ctx.user.campusId))
      .limit(1);
    return { ...ctx.user, campus: campus! };
  }),

  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(sessions).where(eq(sessions.userId, ctx.user.id));
    return { ok: true as const };
  }),
});
