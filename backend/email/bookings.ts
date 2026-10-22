import { and, eq, inArray, lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { bookingEmails, campuses, listings, meetupSpots, reservations, users } from '../db/schema';
import { emailProvider } from './provider';
import { env } from '../env';

/** Run inside the booking transaction, so a committed booking always has its queue rows. */
export async function enqueueBookingEmails(db: Db, reservation: typeof reservations.$inferSelect) {
  await db.insert(bookingEmails).values([reservation.buyerId, reservation.sellerId].map((userId) => ({
    reservationId: reservation.id, userId, meetupStartsAt: reservation.startsAt,
    dedupeKey: `booking:${reservation.id}:${userId}:${reservation.startsAt.toISOString()}`,
  }))).onConflictDoNothing();
}

export async function dispatchBookingEmails(db: Db, now = new Date()) {
  await db.update(bookingEmails).set({ status: 'scheduled', updatedAt: now })
    .where(and(eq(bookingEmails.status, 'sending'), lt(bookingEmails.updatedAt, new Date(now.getTime() - 300_000))));
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.select().from(bookingEmails)
      .where(and(eq(bookingEmails.status, 'scheduled'), lte(bookingEmails.sendAfter, now)))
      .orderBy(bookingEmails.sendAfter).limit(20).for('update', { skipLocked: true });
    if (rows.length) await tx.update(bookingEmails).set({ status: 'sending', updatedAt: now })
      .where(inArray(bookingEmails.id, rows.map((r) => r.id)));
    return rows;
  });
  for (const message of claimed) {
    try {
      const [row] = await db.select({ reservation: reservations, listing: listings, campus: campuses, user: users })
        .from(reservations).innerJoin(listings, eq(listings.id, reservations.listingId))
        .innerJoin(campuses, eq(campuses.id, listings.campusId))
        .innerJoin(users, eq(users.id, message.userId)).where(eq(reservations.id, message.reservationId));
      if (!row || row.reservation.status !== 'accepted' || row.reservation.startsAt.getTime() !== message.meetupStartsAt.getTime()
        || row.reservation.startsAt <= now || row.user.deletedAt || !row.user.email || !row.user.campusEmailVerifiedAt) {
        await db.update(bookingEmails).set({ status: 'skipped', updatedAt: now }).where(eq(bookingEmails.id, message.id));
        continue;
      }
      const [spot] = row.reservation.spotId ? await db.select().from(meetupSpots).where(eq(meetupSpots.id, row.reservation.spotId)) : [];
      const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: row.campus.timezone }).format(row.reservation.startsAt);
      const link = `${process.env.EXPO_PUBLIC_WEB_BASE_URL?.replace(/\/$/, '') || 'https://trydibbs.com'}/reservation/${row.reservation.id}`;
      await emailProvider().send({
        to: row.user.email, subject: 'Your Dibbs meetup is confirmed', idempotencyKey: message.id,
        text: `Your meetup for "${row.listing.title}" is booked.\n\nWhen: ${when} (${row.campus.timezone})\nWhere: ${spot?.name ?? 'See the agreed place in Dibbs'}${spot?.description ? ` — ${spot.description}` : ''}\nAgreed price: $${(row.reservation.priceCents / 100).toFixed(2)}\n\nView current details: ${link}\n\nMeet in public and inspect the item before paying. Pay the seller in person when you meet. Dibbs never handles money.`,
      });
      await db.update(bookingEmails).set({ status: 'sent', updatedAt: now }).where(eq(bookingEmails.id, message.id));
    } catch {
      const attempts = message.attempts + 1;
      await db.update(bookingEmails).set({ status: attempts >= 5 ? 'failed' : 'scheduled', attempts,
        sendAfter: new Date(now.getTime() + 2 ** (attempts - 1) * 60_000), updatedAt: now }).where(eq(bookingEmails.id, message.id));
      // Do not log provider responses or recipient details.
      console.error('[email] booking confirmation delivery failed', message.id);
    }
  }
}

export function startBookingEmailDispatcher(db: Db) {
  if (env.nodeEnv === 'test') return;
  const timer = setInterval(() => { void dispatchBookingEmails(db).catch(() => console.error('[email] dispatcher failed')); }, 30_000);
  timer.unref?.();
}
