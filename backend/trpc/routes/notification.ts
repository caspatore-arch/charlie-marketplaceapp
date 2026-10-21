/**
 * Device registration + per-category notification preferences.
 * See docs/CONTRACT.md "notification" for the contract this mirrors.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { deviceTokens, devicePlatformEnum, notificationPreferences } from '../../db/schema';
import { protectedProcedure, router } from '../trpc';

const platformInput = z.enum(devicePlatformEnum.enumValues).default('unknown');

export const notificationRouter = router({
  /**
   * Registers (or re-registers) an Expo push token for the signed-in user.
   * `expoPushToken` is globally unique — registering a token that already
   * belongs to someone else's device moves it to the caller instead of
   * duplicating it, so a shared/reinstalled device always ends up owned by
   * whoever is currently signed in.
   */
  register: protectedProcedure
    .input(
      z.object({
        expoPushToken: z.string().trim().min(10).max(500),
        platform: platformInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      await ctx.db
        .insert(deviceTokens)
        .values({
          userId: ctx.user.id,
          expoPushToken: input.expoPushToken,
          platform: input.platform,
          createdAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: deviceTokens.expoPushToken,
          set: { userId: ctx.user.id, platform: input.platform, lastSeenAt: now },
        });
      return { ok: true as const };
    }),

  /** Removes one device token, e.g. on sign-out. Silently a no-op if it's not the caller's. */
  unregister: protectedProcedure
    .input(z.object({ expoPushToken: z.string().trim().min(10).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(deviceTokens)
        .where(
          and(eq(deviceTokens.expoPushToken, input.expoPushToken), eq(deviceTokens.userId, ctx.user.id)),
        );
      return { ok: true as const };
    }),

  /** Current preferences. A missing row (never written) means everything defaults to on. */
  preferences: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.user.id))
      .limit(1);
    return (
      row ?? {
        userId: ctx.user.id,
        messages: true,
        meetups: true,
        auctions: true,
        offers: true,
        updatedAt: null as Date | null,
      }
    );
  }),

  /** Partial update — omitted categories keep their current (or default) value. */
  updatePreferences: protectedProcedure
    .input(
      z.object({
        messages: z.boolean().optional(),
        meetups: z.boolean().optional(),
        /** Legacy — auctions were retired. Accepted so old clients don't break. */
        auctions: z.boolean().optional(),
        offers: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, ctx.user.id))
        .limit(1);

      const now = new Date();
      const merged = {
        userId: ctx.user.id,
        messages: input.messages ?? existing?.messages ?? true,
        meetups: input.meetups ?? existing?.meetups ?? true,
        auctions: input.auctions ?? existing?.auctions ?? true,
        offers: input.offers ?? existing?.offers ?? true,
        updatedAt: now,
      };

      const [row] = await ctx.db
        .insert(notificationPreferences)
        .values(merged)
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: {
            messages: merged.messages,
            meetups: merged.meetups,
            auctions: merged.auctions,
            offers: merged.offers,
            updatedAt: now,
          },
        })
        .returning();
      return row!;
    }),
});
