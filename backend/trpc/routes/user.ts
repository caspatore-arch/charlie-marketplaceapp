import { TRPCError } from '@trpc/server';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  blocks,
  campuses,
  emailCodes,
  communityPosts,
  listings,
  offers,
  phoneCodes,
  reports,
  reservations,
  savedListings,
  sessions,
  users,
} from '../../db/schema';
import { cancelUserSms } from '../../sms/outbox';
import { applyExpiry,
  applyExpiryForRead, toPublicUser, type PublicUser } from '../lib';
import { protectedProcedure, publicProcedure, router } from '../trpc';

export type PublicProfile = PublicUser & {
  campus: typeof campuses.$inferSelect;
  bio: string | null;
  activeListingCount: number;
  memberSince: Date;
};

/**
 * Derived reputation summary for `user.trustSummary` — built ONLY from
 * reservations that actually reached a terminal state, never from a
 * user-submitted score. See docs/CONTRACT.md "Trust summary" for the full
 * contract and honesty rules (zeros are a real, displayed state; a closed
 * account returns all zeros with `isClosed: true` rather than leaking
 * history).
 *
 * Deliberately excluded, and why:
 *  - No-shows: the schema has no state that means "the other person
 *    confirmed you didn't show up." `reports.reason = 'no_show'` is an
 *    unmoderated accusation one user files about another — surfacing it as
 *    a number on a stranger's profile would present an unverified claim as
 *    fact, which is worse than not having the signal. Left out entirely.
 *  - "Cancelled after accepting" specifically: `reservations` overwrites
 *    `status` in place and always nulls `handoffCode` on cancel, so nothing
 *    on the row (or anywhere else) records whether a since-cancelled
 *    reservation had ever reached `accepted`. `cancelledByUser` below is the
 *    closest honest substitute: every reservation this user cancelled, at
 *    any stage. Getting the stricter "after accepting" figure would need a
 *    schema change (e.g. a status-history table, or a
 *    `reachedAcceptedAt` timestamp) — flagged to the founder rather than
 *    approximated.
 */
export type TrustSummary = {
  userId: string;
  isDemo: boolean;
  /** True when this account has been closed (user.deleteAccount). Every count below is 0 when true. */
  isClosed: boolean;
  memberSince: Date;
  activeListingCount: number;
  completedAsSeller: number;
  completedAsBuyer: number;
  completedTotal: number;
  /** Reservations this user cancelled, at any stage — see the note above. */
  cancelledByUser: number;
};

export const userRouter = router({
  byId: publicProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    await applyExpiryForRead(ctx.db);

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

  /**
   * Derived reputation summary (docs/CONTRACT.md "Trust summary"). Public,
   * same visibility as `user.byId` — no extra block-based hiding here,
   * because a viewer's profile page is not block-gated anywhere else either
   * (only the feed, messaging and requests are); adding a special case here
   * would be inconsistent with the rest of the app, not more correct.
   *
   * Aggregates in one query (no per-listing/per-reservation loop) and
   * returns real zeros for a brand-new user rather than omitting fields. A
   * closed/anonymized account (`deletedAt` set) returns every count as 0
   * with `isClosed: true` so its history never leaks through this endpoint,
   * even though the underlying `completed` reservations are kept per the
   * account-closure contract.
   */
  trustSummary: publicProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }): Promise<TrustSummary> => {
      await applyExpiryForRead(ctx.db);

      const [user] = await ctx.db.select().from(users).where(eq(users.id, input.id)).limit(1);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'That profile does not exist.' });

      const isClosed = user.deletedAt != null;

      if (isClosed) {
        return {
          userId: user.id,
          isDemo: user.isDemo,
          isClosed: true,
          memberSince: user.createdAt,
          activeListingCount: 0,
          completedAsSeller: 0,
          completedAsBuyer: 0,
          completedTotal: 0,
          cancelledByUser: 0,
        };
      }

      const [active] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(listings)
        .where(and(eq(listings.sellerId, user.id), eq(listings.status, 'active')));

      // Single aggregate query: three filtered counts in one pass over the
      // rows where this user is a participant, rather than one query per
      // count or (worse) one per reservation.
      const [counts] = await ctx.db
        .select({
          completedAsSeller: sql<number>`count(*) filter (where ${reservations.sellerId} = ${user.id} and ${reservations.status} = 'completed')`,
          completedAsBuyer: sql<number>`count(*) filter (where ${reservations.buyerId} = ${user.id} and ${reservations.status} = 'completed')`,
          cancelledByUser: sql<number>`count(*) filter (where ${reservations.cancelledById} = ${user.id} and ${reservations.status} = 'cancelled')`,
        })
        .from(reservations)
        .where(or(eq(reservations.sellerId, user.id), eq(reservations.buyerId, user.id)));

      const completedAsSeller = Number(counts?.completedAsSeller ?? 0);
      const completedAsBuyer = Number(counts?.completedAsBuyer ?? 0);

      return {
        userId: user.id,
        isDemo: user.isDemo,
        isClosed: false,
        memberSince: user.createdAt,
        activeListingCount: Number(active?.count ?? 0),
        completedAsSeller,
        completedAsBuyer,
        completedTotal: completedAsSeller + completedAsBuyer,
        cancelledByUser: Number(counts?.cancelledByUser ?? 0),
      };
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

  /** Private contact + SMS consent for the caller. Never public. */
  contactSettings: protectedProcedure.query(({ ctx }) => ({
    phone: ctx.user.phone,
    phoneVerified: ctx.user.phoneVerifiedAt != null,
    email: ctx.user.email,
    campusEmailVerified: ctx.user.campusEmailVerifiedAt != null,
    smsOptIn: ctx.user.smsOptIn,
    smsOptInAt: ctx.user.smsOptInAt,
    smsOptOutAt: ctx.user.smsOptOutAt,
  })),

  /**
   * Transactional SMS consent. Opting in needs a verified phone. Opting out
   * cancels every text still queued for the caller. Verification codes are
   * unaffected — they are only ever sent when the user asks for one.
   */
  updateSmsPreferences: protectedProcedure
    .input(z.object({ smsOptIn: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.smsOptIn && !ctx.user.phoneVerifiedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add and verify a phone number first.' });
      }
      const now = new Date();
      const [row] = await ctx.db
        .update(users)
        .set(input.smsOptIn ? { smsOptIn: true, smsOptInAt: now } : { smsOptIn: false, smsOptOutAt: now })
        .where(eq(users.id, ctx.user.id))
        .returning();
      if (!input.smsOptIn) await cancelUserSms(ctx.db, ctx.user.id);
      return { smsOptIn: row!.smsOptIn };
    }),

  /**
   * Account closure (docs/CONTRACT.md "Account closure"). This is
   * anonymization, not erasure: the user row stays so existing threads,
   * reservations and reports still resolve, but it is stripped of anything
   * identifying and the caller can no longer sign in as this account.
   *
   *   any accepted reservation (buyer or seller) ──▶ CONFLICT, nothing changes
   *   otherwise, in one transaction:
   *     users            → deletedAt set, displayName/email/avatar/bio wiped
   *     listings (mine)  → active|reserved|expired → removed (sold/removed untouched)
   *     reservations     → requested|countered (mine) → cancelled, 'account_closed'
   *                        (completed reservations are never touched)
   *     sessions, saved_listings, blocks (both directions), email_codes → deleted
   *     messages, reports, completed reservations → kept as-is
   */
  deleteAccount: protectedProcedure
    .input(z.object({ confirmText: z.literal('DELETE') }))
    .mutation(async ({ ctx }) => {
      const userId = ctx.user.id;
      const oldEmail = ctx.user.email;

      await ctx.db.transaction(async (tx) => {
        // Refused while either side of an accepted meetup is still open —
        // closing the account mid-handoff would strand the other party.
        const [openAccepted] = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.status, 'accepted'),
              or(eq(reservations.buyerId, userId), eq(reservations.sellerId, userId)),
            ),
          )
          .limit(1);
        if (openAccepted) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Finish or cancel your open meetups before closing your account.',
          });
        }

        const now = new Date();

        await tx
          .update(users)
          .set({
            deletedAt: now,
            displayName: 'Deleted user',
            email: `deleted+${userId}@account.invalid`,
            avatarUrl: null,
            bio: null,
            // Frees the number so the person can sign up again with it.
            phone: null,
            phoneVerifiedAt: null,
            smsOptIn: false,
            smsOptOutAt: now,
          })
          .where(eq(users.id, userId));

        await tx
          .update(offers)
          .set({ status: 'withdrawn', closeReason: 'account_closed', updatedAt: now })
          .where(
            and(
              or(eq(offers.buyerId, userId), eq(offers.sellerId, userId)),
              inArray(offers.status, ['pending', 'accepted']),
            ),
          );
        await tx
          .update(communityPosts)
          .set({ removedAt: now, removedById: userId })
          .where(and(eq(communityPosts.authorId, userId), sql`${communityPosts.removedAt} is null`));
        await tx.delete(phoneCodes).where(eq(phoneCodes.userId, userId));

        await tx
          .update(listings)
          .set({ status: 'removed', updatedAt: now })
          .where(
            and(eq(listings.sellerId, userId), inArray(listings.status, ['active', 'reserved', 'expired'])),
          );

        await tx
          .update(reservations)
          .set({
            status: 'cancelled',
            cancelledById: userId,
            cancelReason: 'account_closed',
            handoffCode: null,
            updatedAt: now,
          })
          .where(
            and(
              or(eq(reservations.buyerId, userId), eq(reservations.sellerId, userId)),
              inArray(reservations.status, ['requested', 'countered']),
            ),
          );

        await tx.delete(sessions).where(eq(sessions.userId, userId));
        await tx.delete(savedListings).where(eq(savedListings.userId, userId));
        await tx
          .delete(blocks)
          .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
        if (oldEmail) await tx.delete(emailCodes).where(eq(emailCodes.email, oldEmail));
      });
      await cancelUserSms(ctx.db, userId);

      return { ok: true as const };
    }),
});
