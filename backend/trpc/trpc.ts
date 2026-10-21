import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';

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
 * Protected + the caller has verified a campus email. Phone verification
 * proves control of a phone number only — it is NOT campus or student
 * verification — so buying, selling and posting stay behind this gate.
 */
export const campusVerifiedProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.campusEmailVerifiedAt) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Verify your campus email to buy, sell, or post. Phone sign-in alone does not confirm you are a student.',
    });
  }
  return next({ ctx });
});
