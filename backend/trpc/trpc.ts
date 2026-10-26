import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';

import { BLOCKED_MESSAGE, NEEDS_CAMPUS_EMAIL_MESSAGE, postingStatus } from '../auth/posting-access';
import { env } from '../env';
import type { Context } from './create-context';

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

/** Throws UNAUTHORIZED unless a valid bearer session resolved a user. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Basic moderation access: a signed-in user whose id is in MODERATOR_USER_IDS.
 * This is intentionally simple (no roles table) — just enough that reports
 * land in front of a responsible operator instead of nobody.
 */
export const moderatorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!env.moderatorUserIds.includes(ctx.user.id)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Moderator access required.' });
  }
  return next({ ctx });
});

/**
 * Protected + the caller may trade: a verified email (campus or any other
 * address), or a founder override set on /admin
 * (backend/auth/posting-access.ts). Phone verification proves control of a
 * phone number only, so a phone-only account stays behind this gate until it
 * verifies a campus email or is approved. None of these checks is student or
 * identity verification. 'blocked' wins over everything.
 */
export const campusVerifiedProcedure = protectedProcedure.use(({ ctx, next }) => {
  const status = postingStatus(ctx.user);
  if (status === 'blocked') {
    throw new TRPCError({ code: 'FORBIDDEN', message: BLOCKED_MESSAGE });
  }
  if (status === 'needs_campus_email') {
    throw new TRPCError({ code: 'FORBIDDEN', message: NEEDS_CAMPUS_EMAIL_MESSAGE });
  }
  return next({ ctx });
});
