import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import { conversationReads, conversations, listings, messages, reservations, users } from '../../db/schema';
import { notifyNewMessage } from '../../notifications/events';
import { applyExpiry, isBlockedBetween, toListingCards, toPublicUser } from '../lib';
import { protectedProcedure, publicProcedure, router } from '../trpc';

/** Loads a conversation the caller takes part in, or throws. */
async function loadParticipantConversation(db: Db, id: string, userId: string) {
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!convo) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That conversation no longer exists.' });
  }
  if (convo.buyerId !== userId && convo.sellerId !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This conversation is not yours.' });
  }
  return convo;
}

export const conversationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await applyExpiry(ctx.db);

    const rows = await ctx.db
      .select()
      .from(conversations)
      .where(
        or(eq(conversations.buyerId, ctx.user.id), eq(conversations.sellerId, ctx.user.id)),
      )
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt));
    if (rows.length === 0) return [];

    const listingRows = await ctx.db
      .select()
      .from(listings)
      .where(inArray(listings.id, [...new Set(rows.map((c) => c.listingId))]));
    const cards = await toListingCards(ctx.db, listingRows);
    const cardById = new Map(cards.map((c) => [c.id, c]));

    const otherIds = rows.map((c) => (c.buyerId === ctx.user.id ? c.sellerId : c.buyerId));
    const otherUsers = await ctx.db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(otherIds)]));
    const userById = new Map(otherUsers.map((u) => [u.id, u]));

    const allMessages = await ctx.db
      .select()
      .from(messages)
      .where(
        inArray(
          messages.conversationId,
          rows.map((c) => c.id),
        ),
      )
      .orderBy(desc(messages.createdAt));

    const reads = await ctx.db
      .select()
      .from(conversationReads)
      .where(
        and(
          inArray(
            conversationReads.conversationId,
            rows.map((c) => c.id),
          ),
          eq(conversationReads.userId, ctx.user.id),
        ),
      );
    const lastReadById = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

    return rows.map((c) => {
      const mine = allMessages.filter((m) => m.conversationId === c.id);
      const otherId = c.buyerId === ctx.user.id ? c.sellerId : c.buyerId;
      const lastReadAt = lastReadById.get(c.id) ?? null;
      return {
        id: c.id,
        listing: cardById.get(c.listingId)!,
        otherUser: toPublicUser(userById.get(otherId)!),
        lastMessage: mine[0] ?? undefined,
        // Messages from the other participant sent after our lastReadAt (all of
        // them if we've never read this thread).
        unreadCount: mine.filter(
          (m) => m.senderId !== ctx.user.id && (lastReadAt == null || m.createdAt > lastReadAt),
        ).length,
      };
    });
  }),

  /** One cheap call for the Inbox tab badge. Returns zeroes when signed out. */
  unreadTotal: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return { conversations: 0, actionableReservations: 0 };
    await applyExpiry(ctx.db);
    const userId = ctx.user.id;

    const convoRows = await ctx.db
      .select()
      .from(conversations)
      .where(or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)));

    let unreadConversations = 0;
    if (convoRows.length > 0) {
      const reads = await ctx.db
        .select()
        .from(conversationReads)
        .where(
          and(
            inArray(
              conversationReads.conversationId,
              convoRows.map((c) => c.id),
            ),
            eq(conversationReads.userId, userId),
          ),
        );
      const lastReadById = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

      const allMessages = await ctx.db
        .select()
        .from(messages)
        .where(
          inArray(
            messages.conversationId,
            convoRows.map((c) => c.id),
          ),
        );

      for (const c of convoRows) {
        const lastReadAt = lastReadById.get(c.id) ?? null;
        const hasUnread = allMessages.some(
          (m) =>
            m.conversationId === c.id &&
            m.senderId !== userId &&
            (lastReadAt == null || m.createdAt > lastReadAt),
        );
        if (hasUnread) unreadConversations += 1;
      }
    }

    const actionableRows = await ctx.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          or(eq(reservations.buyerId, userId), eq(reservations.sellerId, userId)),
          inArray(reservations.status, ['requested', 'countered']),
          ne(reservations.proposedById, userId),
        ),
      );

    return { conversations: unreadConversations, actionableReservations: actionableRows.length };
  }),

  markRead: protectedProcedure
    .input(z.object({ conversationId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const convo = await loadParticipantConversation(ctx.db, input.conversationId, ctx.user.id);
      const now = new Date();

      await ctx.db
        .insert(conversationReads)
        .values({ conversationId: convo.id, userId: ctx.user.id, lastReadAt: now })
        .onConflictDoUpdate({
          target: [conversationReads.conversationId, conversationReads.userId],
          set: { lastReadAt: now },
        });

      return { ok: true as const };
    }),

  open: protectedProcedure
    .input(z.object({ listingId: z.uuid(), buyerId: z.uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [listing] = await ctx.db
        .select()
        .from(listings)
        .where(eq(listings.id, input.listingId))
        .limit(1);
      if (!listing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
      }

      const isSeller = listing.sellerId === ctx.user.id;
      let buyerId: string;

      if (isSeller) {
        // The seller is opening (or resuming) a thread with a specific requester.
        if (!input.buyerId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Choose who to message.',
          });
        }
        if (input.buyerId === ctx.user.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This is your own listing.',
          });
        }
        const [buyer] = await ctx.db
          .select()
          .from(users)
          .where(eq(users.id, input.buyerId))
          .limit(1);
        if (!buyer) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That user no longer exists.' });
        }
        buyerId = input.buyerId;
      } else {
        // Anyone else opening this listing's thread is the buyer, regardless of buyerId.
        buyerId = ctx.user.id;
      }

      const otherPartyId = isSeller ? buyerId : listing.sellerId;
      if (await isBlockedBetween(ctx.db, ctx.user.id, otherPartyId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot message this person.',
        });
      }

      const existing = await ctx.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.listingId, listing.id), eq(conversations.buyerId, buyerId)))
        .limit(1);
      if (existing[0]) return existing[0];

      const [created] = await ctx.db
        .insert(conversations)
        .values({ listingId: listing.id, buyerId, sellerId: listing.sellerId })
        .returning();
      return created!;
    }),

  messages: protectedProcedure
    .input(z.object({ conversationId: z.uuid(), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const convo = await loadParticipantConversation(ctx.db, input.conversationId, ctx.user.id);

      const conditions = [eq(messages.conversationId, convo.id)];
      if (input.cursor) conditions.push(lt(messages.createdAt, new Date(input.cursor)));

      const rows = await ctx.db
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt))
        .limit(51);

      const page = rows.slice(0, 50);
      const next = rows.length > 50 ? page[page.length - 1] : undefined;
      return {
        // Oldest first — the UI renders a normal top-to-bottom transcript.
        items: page.slice().reverse(),
        nextCursor: next ? next.createdAt.toISOString() : undefined,
      };
    }),

  send: protectedProcedure
    .input(z.object({ conversationId: z.uuid(), body: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const convo = await loadParticipantConversation(ctx.db, input.conversationId, ctx.user.id);
      const other = convo.buyerId === ctx.user.id ? convo.sellerId : convo.buyerId;

      if (await isBlockedBetween(ctx.db, ctx.user.id, other)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot message this person.' });
      }

      const now = new Date();
      const [message] = await ctx.db
        .insert(messages)
        .values({
          conversationId: convo.id,
          senderId: ctx.user.id,
          body: input.body,
          createdAt: now,
        })
        .returning();

      await ctx.db
        .update(conversations)
        .set({ lastMessageAt: now })
        .where(eq(conversations.id, convo.id));

      // Fire-and-forget: a push failure must never fail sending the message.
      // `notifyUsers` never throws, but this call is not awaited on purpose.
      void (async () => {
        const [[sender], [listing]] = await Promise.all([
          ctx.db.select({ displayName: users.displayName }).from(users).where(eq(users.id, ctx.user.id)).limit(1),
          ctx.db.select({ title: listings.title }).from(listings).where(eq(listings.id, convo.listingId)).limit(1),
        ]);
        await notifyNewMessage(ctx.db, {
          recipientId: other,
          senderId: ctx.user.id,
          senderName: sender?.displayName ?? 'Someone',
          conversationId: convo.id,
          listingTitle: listing?.title ?? 'your item',
          body: input.body,
        });
      })();

      return message!;
    }),
});
