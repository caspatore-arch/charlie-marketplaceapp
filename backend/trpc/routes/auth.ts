/**
 * Campus-email sign-in. Delivery is SIMULATED: the six-digit code is printed
 * to the server console, never emailed. Sessions are bearer tokens stored as
 * sha256 hashes.
 */
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { env } from '../../env';
import { campuses, emailCodes, sessions, users } from '../../db/schema';
import { hashToken, newSessionToken } from '../create-context';
import { protectedProcedure, publicProcedure, router } from '../trpc';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await ctx.db.insert(emailCodes).values({
        email,
        code,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });

      // Simulated delivery — this is the only place the code appears.
      console.log(`[SIMULATED EMAIL] code for ${email}: ${code}`);

      return { ok: true as const, simulated: true as const };
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
      return { token, user: { ...user!, campus } };
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
