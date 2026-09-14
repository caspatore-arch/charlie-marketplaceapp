import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../../db/client';
import { conversations, listings, messages, users } from '../../db/schema';
import { applyExpiry, isBlockedBetween, toListingCards, toPublicUser } from '../lib';
import { protectedProcedure, router } from '../trpc';

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

    return rows.map((c) => {
      const mine = allMessages.filter((m) => m.conversationId === c.id);
      const otherId = c.buyerId === ctx.user.id ? c.sellerId : c.buyerId;
      return {
        id: c.id,
        listing: cardById.get(c.listingId)!,
        otherUser: toPublicUser(userById.get(otherId)!),
        lastMessage: mine[0] ?? undefined,
        // No per-user read receipts in the MVP; unread = messages from the other side.
        unreadCount: mine.filter((m) => m.senderId !== ctx.user.id).length,
      };
    });
  }),

  open: protectedProcedure
    .input(z.object({ listingId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [listing] = await ctx.db
        .select()
        .from(listings)
        .where(eq(listings.id, input.listingId))
        .limit(1);
      if (!listing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
      }
      if (listing.sellerId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This is your own listing.',
        });
      }
      if (await isBlockedBetween(ctx.db, ctx.user.id, listing.sellerId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot message this person.',
        });
      }

      const existing = await ctx.db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.listingId, listing.id),
            eq(conversations.buyerId, ctx.user.id),
          ),
        )
        .limit(1);
      if (existing[0]) return existing[0];

      const [created] = await ctx.db
        .insert(conversations)
        .values({ listingId: listing.id, buyerId: ctx.user.id, sellerId: listing.sellerId })
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

      return message!;
    }),
});
