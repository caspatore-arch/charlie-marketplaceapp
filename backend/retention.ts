/**
 * Closed-account cleanup, the promise in the Privacy Policy (constants/legal.ts,
 * DATA_RETENTION_PERIOD): 30 days after someone closes their account, delete
 * what they left behind.
 *
 * Closing an account (user.deleteAccount) only anonymizes it. Once the account
 * has been closed for CLOSED_ACCOUNT_RETENTION_DAYS, this deletes:
 *   - messages they sent
 *   - offers and meetup/sale records (reservations) they were part of
 *   - their listings (with photos rows, likes, comments and threads on them)
 *   - their Community posts
 * Kept: the anonymized "Deleted user" row (other records point at it), reports
 * (safety) and the listings or posts they are about (reports cascade on
 * delete), and anything tied to a payment record, so real payments, once
 * switched on, are never erased by this job.
 *
 * Idempotent: running it again finds nothing left to delete.
 */
import { and, eq, isNotNull, lt, ne, or, sql } from 'drizzle-orm';

import type { Db } from './db/client';
import { communityPosts, listings, messages, offers, reservations, users } from './db/schema';
import { env } from './env';

export const CLOSED_ACCOUNT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

export async function purgeClosedAccounts(db: Db, now = new Date()): Promise<{ accounts: number }> {
  const cutoff = new Date(now.getTime() - CLOSED_ACCOUNT_RETENTION_DAYS * DAY_MS);
  const closed = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, cutoff)));

  for (const { id: userId } of closed) {
    await db.transaction(async (tx) => {
      const hasPayment = sql`exists (select 1 from payments p where p.reservation_id = ${reservations.id})`;

      await tx.delete(messages).where(eq(messages.senderId, userId));

      // Offers point at reservations without a cascade, so they go first.
      await tx
        .delete(offers)
        .where(
          and(
            or(eq(offers.buyerId, userId), eq(offers.sellerId, userId)),
            sql`(${offers.reservationId} is null or not exists (select 1 from payments p where p.reservation_id = ${offers.reservationId}))`,
          ),
        );

      await tx
        .delete(reservations)
        .where(
          and(
            or(eq(reservations.buyerId, userId), eq(reservations.sellerId, userId)),
            // Closure refuses while a meetup is accepted; never touch one anyway.
            ne(reservations.status, 'accepted'),
            sql`not ${hasPayment}`,
          ),
        );

      // Cascades photos rows, likes, shares, comments, threads and any
      // remaining offers/reservations on these listings.
      await tx
        .delete(listings)
        .where(
          and(
            eq(listings.sellerId, userId),
            sql`not exists (select 1 from reservations r join payments p on p.reservation_id = r.id where r.listing_id = ${listings.id})`,
            sql`not exists (select 1 from reports rp where rp.target_listing_id = ${listings.id})`,
          ),
        );

      await tx
        .delete(communityPosts)
        .where(
          and(
            eq(communityPosts.authorId, userId),
            sql`not exists (select 1 from reports rp where rp.target_post_id = ${communityPosts.id})`,
          ),
        );
    });
  }
  return { accounts: closed.length };
}

/** Runs the cleanup at start and every 6 hours (rare enough to let the database sleep). */
export function startRetentionSweeper(db: Db) {
  if (env.nodeEnv === 'test') return;
  const run = () => {
    void purgeClosedAccounts(db).catch(() => console.error('[retention] closed-account cleanup failed'));
  };
  setTimeout(run, 60_000).unref?.();
  setInterval(run, SWEEP_EVERY_MS).unref?.();
}
