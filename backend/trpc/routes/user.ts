import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { blocks, campuses, listings, reports, users } from '../../db/schema';
import { applyExpiry, toPublicUser, type PublicUser } from '../lib';
import { protectedProcedure, publicProcedure, router } from '../trpc';

export type PublicProfile = PublicUser & {
  campus: typeof campuses.$inferSelect;
  bio: string | null;
  activeListingCount: number;
  memberSince: Date;
};

export const userRouter = router({
  byId: publicProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await applyExpiry(ctx.db);

    const [user] = await ctx.db.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'That profile does not exist.' });

    const [campus] = await ctx.db
      .select()
      .from(campuses)
      .where(eq(campuses.id, user.campusId))
      .limit(1);

    const active = await ctx.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.sellerId, user.id), eq(listings.status, 'active')));

    const profile: PublicProfile = {
      ...toPublicUser(user),
      campus: campus!,
      bio: user.bio,
      activeListingCount: active.length,
      memberSince: user.createdAt,
    };
    return profile;
  }),

  updateMe: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(60).optional(),
        avatarUrl: z.string().max(500).optional(),
        bio: z.string().max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
        })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated!;
    }),

  block: protectedProcedure
    .input(z.object({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot block yourself.' });
      }
      await ctx.db
        .insert(blocks)
        .values({ blockerId: ctx.user.id, blockedId: input.userId })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  unblock: protectedProcedure
    .input(z.object({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(blocks)
        .where(and(eq(blocks.blockerId, ctx.user.id), eq(blocks.blockedId, input.userId)));
      return { ok: true as const };
    }),

  blocked: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ blockedId: blocks.blockedId })
      .from(blocks)
      .where(eq(blocks.blockerId, ctx.user.id));
    if (rows.length === 0) return [] as PublicProfile[];

    const blockedUsers = await ctx.db
      .select()
      .from(users)
      .where(
        inArray(
          users.id,
          rows.map((r) => r.blockedId),
        ),
      );
    const campusRows = await ctx.db.select().from(campuses);
    const campusById = new Map(campusRows.map((c) => [c.id, c]));

    return blockedUsers.map<PublicProfile>((u) => ({
      ...toPublicUser(u),
      campus: campusById.get(u.campusId)!,
      bio: u.bio,
      activeListingCount: 0,
      memberSince: u.createdAt,
    }));
  }),

  report: protectedProcedure
    .input(
      z.object({
        targetUserId: z.uuid().optional(),
        targetListingId: z.uuid().optional(),
        reason: z.enum(['prohibited_item', 'scam', 'harassment', 'no_show', 'other']),
        details: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.targetUserId && !input.targetListingId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tell us what you are reporting.',
        });
      }
      await ctx.db.insert(reports).values({
        reporterId: ctx.user.id,
        targetUserId: input.targetUserId ?? null,
        targetListingId: input.targetListingId ?? null,
        reason: input.reason,
        details: input.details ?? null,
      });
      return { ok: true as const };
    }),
});
