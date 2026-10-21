import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  blocks,
  campuses,
  communityPostVotes,
  emailCodes,
  communityPosts,
  follows,
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
import { normalizePhone, PhoneFormatError } from '../../sms/phone';
import {
  applyExpiryForRead,
  blockedUserIds,
  followCounts,
  followList,
  isBlockedBetween,
  toPublicUser,
  viewerFollows,
  type PublicUser,
} from '../lib';
import { protectedProcedure, publicProcedure, router } from '../trpc';

export type PublicProfile = PublicUser & {
  campus: typeof campuses.$inferSelect;
  bio: string | null;
  activeListingCount: number;
  memberSince: Date;
};

/** `user.byId`: the public profile plus the follow graph, as this viewer may see it. */
export type ProfileWithSocial = PublicProfile & {
  followerCount: number;
  followingCount: number;
  /** False for a signed-out viewer, for yourself, and for a closed account. */
  viewerFollows: boolean;
  /** True for a closed account: no counts, cannot be followed. */
  isClosed: boolean;
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

/**
 * Instagram handle: leading "@" stripped, letters/digits/"."/"_" only, max 30.
 * Returns null for empty input (= clear the field). A pasted URL is rejected
 * with a hint rather than silently parsed.
 */
function parseInstagramHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (/[/:]|instagram\.com/i.test(trimmed)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Enter just your Instagram handle (like campus.kid), not a link.',
    });
  }
  const handle = trimmed.replace(/^@/, '');
  if (handle.length === 0 || handle.length > 30 || !/^[A-Za-z0-9._]+$/.test(handle)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Instagram handles use only letters, numbers, periods and underscores, up to 30 characters.',
    });
  }
  return handle;
}

/** Contact number as typed (spaces, dashes, parens, +) -> E.164. Unverified. */
function parseContactPhone(raw: string): string | null {
  if (raw.trim() === '') return null;
  try {
    return normalizePhone(raw);
  } catch (err) {
    if (err instanceof PhoneFormatError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
    throw err;
  }
}

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

    // A closed account shows no counts and cannot be followed; it must not
    // leak its old graph through the numbers.
    const closed = user.deletedAt != null;
    const viewerId = ctx.user?.id ?? null;
    const counts = closed
      ? { followerCount: 0, followingCount: 0 }
      : await followCounts(ctx.db, user.id, viewerId);

    const profile: ProfileWithSocial = {
      ...toPublicUser(user),
      campus: campus!,
      bio: user.bio,
      activeListingCount: active.length,
      memberSince: user.createdAt,
      ...counts,
      viewerFollows: closed ? false : await viewerFollows(ctx.db, viewerId, user.id),
      isClosed: closed,
    };
    return profile;
  }),

  /**
   * Follow someone. Idempotent: the composite primary key plus ON CONFLICT DO
   * NOTHING means a double-tap leaves exactly one row. Self-follows are refused
   * here AND by the follows_no_self CHECK. A blocked pair (either direction),
   * a missing user and a closed account all read as "no such profile" so the
   * response does not reveal who blocked whom.
   */
  follow: protectedProcedure
    .input(z.object({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot follow yourself.' });
      }
      const [target] = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target || target.deletedAt != null || (await isBlockedBetween(ctx.db, ctx.user.id, target.id))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That profile does not exist.' });
      }
      await ctx.db
        .insert(follows)
        .values({ followerId: ctx.user.id, followeeId: target.id })
        .onConflictDoNothing();
      return {
        ok: true as const,
        viewerFollows: true as const,
        ...(await followCounts(ctx.db, target.id, ctx.user.id)),
      };
    }),

  /** Stop following. Idempotent, and always allowed (even after a block or a closure). */
  unfollow: protectedProcedure
    .input(z.object({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(follows)
        .where(and(eq(follows.followerId, ctx.user.id), eq(follows.followeeId, input.userId)));
      return {
        ok: true as const,
        viewerFollows: false as const,
        ...(await followCounts(ctx.db, input.userId, ctx.user.id)),
      };
    }),

  /** Who follows `userId`, or whom they follow. Blocked people and closed accounts are left out. */
  followList: protectedProcedure
    .input(
      z.object({
        userId: z.uuid(),
        direction: z.enum(['followers', 'following']),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [target] = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target || target.deletedAt != null) return [] as PublicUser[];
      if (input.userId !== ctx.user.id && (await isBlockedBetween(ctx.db, ctx.user.id, input.userId))) {
        return [] as PublicUser[];
      }
      return followList(ctx.db, input.userId, input.direction, ctx.user.id, input.limit);
    }),

  /**
   * A person's live community posts (same 24h / removal / campus / block rules
   * as community.feed; the shape matches a feed item). Posts are campus-only,
   * so this is signed-in only.
   */
  posts: protectedProcedure
    .input(z.object({ userId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (input.userId !== ctx.user.id) {
        const hidden = await blockedUserIds(ctx.db, ctx.user.id);
        if (hidden.includes(input.userId)) return [];
      }
      const rows = await ctx.db
        .select()
        .from(communityPosts)
        .where(
          and(
            eq(communityPosts.authorId, input.userId),
            eq(communityPosts.campusId, ctx.user.campusId),
            gt(communityPosts.expiresAt, new Date()),
            isNull(communityPosts.removedAt),
          ),
        )
        .orderBy(desc(communityPosts.createdAt))
        .limit(50);
      if (rows.length === 0) return [];
      const [author] = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!author || author.deletedAt != null) return [];
      const totals = await ctx.db
        .select({ postId: communityPostVotes.postId, total: count() })
        .from(communityPostVotes)
        .where(inArray(communityPostVotes.postId, rows.map((r) => r.id)))
        .groupBy(communityPostVotes.postId);
      const totalById = new Map(totals.map((t) => [t.postId, Number(t.total)]));
      return rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        body: p.body,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
        author: toPublicUser(author),
        isMine: p.authorId === ctx.user.id,
        /** Popularity only. Never an endorsement, and not a safety signal. */
        voteCount: totalById.get(p.id) ?? 0,
      }));
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
        // Only an image that came from POST /api/uploads (relative path, or the
        // configured public https base). Empty string removes the picture.
        avatarUrl: z
          .string()
          .max(500)
          .refine((v) => v === '' || v.startsWith('/api/uploads/') || /^https:\/\//.test(v), {
            message: 'Use a photo uploaded through Dibbs.',
          })
          .optional(),
        bio: z.string().max(400).optional(),
        // Optional contact details. Empty string clears. Never verified.
        instagramHandle: z.string().max(100).optional(),
        contactPhone: z.string().max(40).optional(),
        // Explicit opt-in to show each field to other students. Off by default.
        shareInstagram: z.boolean().optional(),
        sharePhone: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instagram =
        input.instagramHandle !== undefined ? parseInstagramHandle(input.instagramHandle) : undefined;
      const phone =
        input.contactPhone !== undefined ? parseContactPhone(input.contactPhone) : undefined;

      // Validate the state the row would be in AFTER this save: sharing a
      // field that is empty is a bug, not a state.
      const nextInstagram = instagram !== undefined ? instagram : ctx.user.instagramHandle;
      const nextPhone = phone !== undefined ? phone : ctx.user.contactPhone;
      const nextShareInstagram = input.shareInstagram ?? ctx.user.shareInstagram;
      const nextSharePhone = input.sharePhone ?? ctx.user.sharePhone;
      if (nextShareInstagram && !nextInstagram) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Add your Instagram handle before turning on sharing, or turn sharing off.',
        });
      }
      if (nextSharePhone && !nextPhone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Add your phone number before turning on sharing, or turn sharing off.',
        });
      }

      const [updated] = await ctx.db
        .update(users)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl === '' ? null : input.avatarUrl } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(instagram !== undefined ? { instagramHandle: instagram } : {}),
          ...(phone !== undefined ? { contactPhone: phone } : {}),
          ...(input.shareInstagram !== undefined ? { shareInstagram: input.shareInstagram } : {}),
          ...(input.sharePhone !== undefined ? { sharePhone: input.sharePhone } : {}),
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
      // A block ends any follow between the two, in both directions.
      await ctx.db
        .delete(follows)
        .where(
          or(
            and(eq(follows.followerId, ctx.user.id), eq(follows.followeeId, input.userId)),
            and(eq(follows.followerId, input.userId), eq(follows.followeeId, ctx.user.id)),
          ),
        );
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
    if (rows.length === 0) return [] as ProfileWithSocial[];

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

    // Counts are not shown on this list; zeros keep the shape identical to byId.
    return blockedUsers.map<ProfileWithSocial>((u) => ({
      ...toPublicUser(u),
      campus: campusById.get(u.campusId)!,
      bio: u.bio,
      activeListingCount: 0,
      memberSince: u.createdAt,
      followerCount: 0,
      followingCount: 0,
      viewerFollows: false,
      isClosed: u.deletedAt != null,
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
   *     users            → deletedAt set, displayName/email/avatar/bio and
   *                        instagram/contact phone + share flags wiped
   *     listings (mine)  → active|reserved|expired → removed (sold/removed untouched)
   *     reservations     → requested|countered (mine) → cancelled, 'account_closed'
   *                        (completed reservations are never touched)
   *     sessions, saved_listings, follows + blocks (both directions), email_codes → deleted
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
            // Contact sharing: wipe the values AND the opt-ins.
            instagramHandle: null,
            contactPhone: null,
            shareInstagram: false,
            sharePhone: false,
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

        await tx
          .delete(follows)
          .where(or(eq(follows.followerId, userId), eq(follows.followeeId, userId)));
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
