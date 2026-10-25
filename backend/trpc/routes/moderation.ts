/**
 * Basic moderation access. Not a roles/permissions system — just enough that
 * a fixed set of user ids (MODERATOR_USER_IDS) can see what's been reported
 * and act on it, so reports land in front of a responsible operator instead
 * of sitting unread in the `reports` table forever.
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { env } from '../../env';
import { communityPosts, listings, reports, reservations, users } from '../../db/schema';
import { toListingCards, toPublicUser, type ListingCard, type PublicUser } from '../lib';
import { moderatorProcedure, protectedProcedure, router } from '../trpc';

export type ModerationReport = typeof reports.$inferSelect & {
  reporter: PublicUser;
  targetUser: PublicUser | null;
  targetListing: ListingCard | null;
  /** Community post a report names (kept visible to moderators even after expiry/removal). */
  targetPost: { id: string; kind: 'buying' | 'selling'; body: string; createdAt: Date; removedAt: Date | null } | null;
};

export const moderationRouter = router({
  /** Lets the client know whether to show any moderation UI at all. */
  isModerator: protectedProcedure.query(({ ctx }) => env.moderatorUserIds.includes(ctx.user.id)),

  reports: moderatorProcedure
    .input(z.object({ status: z.enum(['open', 'reviewed']).optional() }).default({}))
    .query(async ({ ctx, input }): Promise<ModerationReport[]> => {
      const rows = await ctx.db
        .select()
        .from(reports)
        .where(input.status ? eq(reports.status, input.status) : undefined)
        .orderBy(desc(reports.createdAt));

      if (rows.length === 0) return [];

      const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
      const targetUserIds = [
        ...new Set(rows.map((r) => r.targetUserId).filter((id): id is string => id != null)),
      ];
      const targetListingIds = [
        ...new Set(rows.map((r) => r.targetListingId).filter((id): id is string => id != null)),
      ];

      const [reporters, targetUsers, targetListingRows] = await Promise.all([
        ctx.db.select().from(users).where(inArray(users.id, reporterIds)),
        targetUserIds.length
          ? ctx.db.select().from(users).where(inArray(users.id, targetUserIds))
          : Promise.resolve([]),
        targetListingIds.length
          ? ctx.db.select().from(listings).where(inArray(listings.id, targetListingIds))
          : Promise.resolve([]),
      ]);

      const reporterById = new Map(reporters.map((u) => [u.id, u]));
      const targetUserById = new Map(targetUsers.map((u) => [u.id, u]));
      const listingCards = await toListingCards(ctx.db, targetListingRows);
      const postIds = [...new Set(rows.map((r) => r.targetPostId).filter((id): id is string => id != null))];
      const postRows = postIds.length
        ? await ctx.db.select().from(communityPosts).where(inArray(communityPosts.id, postIds))
        : [];
      const postById = new Map(postRows.map((p) => [p.id, p]));
      const listingCardById = new Map(listingCards.map((l) => [l.id, l]));

      return rows.map((r) => ({
        ...r,
        reporter: toPublicUser(reporterById.get(r.reporterId)!),
        targetUser: r.targetUserId ? toPublicUser(targetUserById.get(r.targetUserId)!) : null,
        targetListing: r.targetListingId ? (listingCardById.get(r.targetListingId) ?? null) : null,
        targetPost: (() => {
          const p = r.targetPostId ? postById.get(r.targetPostId) : undefined;
          return p
            ? { id: p.id, kind: p.kind, body: p.body, createdAt: p.createdAt, removedAt: p.removedAt }
            : null;
        })(),
      }));
    }),

  reviewReport: moderatorProcedure
    .input(
      z.object({
        id: z.uuid(),
        action: z.enum(['dismiss', 'remove_listing', 'note']),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [report] = await ctx.db.select().from(reports).where(eq(reports.id, input.id)).limit(1);
      if (!report) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That report no longer exists.' });
      }

      const now = new Date();

      if (input.action === 'remove_listing') {
        if (!report.targetListingId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This report has no listing to remove.',
          });
        }

        const [listing] = await ctx.db
          .select()
          .from(listings)
          .where(eq(listings.id, report.targetListingId))
          .limit(1);

        if (listing && listing.status !== 'removed') {
          await ctx.db
            .update(listings)
            .set({ status: 'removed', updatedAt: now })
            .where(eq(listings.id, listing.id));

          // An accepted hold on a listing that just got pulled is cancelled —
          // never a completed sale, which is left alone.
          const [acceptedReservation] = await ctx.db
            .select()
            .from(reservations)
            .where(and(eq(reservations.listingId, listing.id), eq(reservations.status, 'accepted')))
            .limit(1);

          if (acceptedReservation) {
            await ctx.db
              .update(reservations)
              .set({
                status: 'cancelled',
                cancelledById: ctx.user.id,
                cancelReason: 'listing_removed',
                handoffCode: null,
                updatedAt: now,
              })
              .where(eq(reservations.id, acceptedReservation.id));
          }
        }
      }

      const [updated] = await ctx.db
        .update(reports)
        .set({
          status: 'reviewed',
          reviewedById: ctx.user.id,
          reviewedAt: now,
          moderatorNote: input.note ?? null,
        })
        .where(eq(reports.id, input.id))
        .returning();

      return updated!;
    }),
});
