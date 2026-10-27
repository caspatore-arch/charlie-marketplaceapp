/**
 * Transactional SMS — durable outbox + dispatcher.
 *
 * Events write rows into `sms_messages`; `dispatchDueSms` sends the ones that
 * are due. Properties the brief asks for, and where they come from:
 *
 *  - Durable scheduling: reminders are rows with a future `send_after`, so a
 *    restart loses nothing. The dispatcher runs on an interval (server.ts).
 *  - Idempotency / dedupe: `dedupe_key` is UNIQUE and every enqueue is
 *    `ON CONFLICT DO NOTHING`. Keys include the meetup time, so a reschedule
 *    produces a new confirmation + reminder while a retry produces nothing.
 *  - Retries: retryable failures back off 1, 2, 4, 8 minutes; the 5th failure
 *    (or a permanent error) marks the row `failed`.
 *  - Never stale: right before sending, the row is re-validated against the
 *    current booking (still accepted, same time, still in the future) and the
 *    recipient's consent. Anything else is `skipped`, never sent.
 *  - Consent: only users with a verified phone AND sms_opt_in get a row.
 *
 * RECIPIENT RULE (for founder review): listing-posted goes to the seller only.
 * Booking-confirmed and the 30-minute reminder go to BOTH buyer and seller,
 * each only if they have a verified, opted-in number. The buyer's text
 * includes the item and price; the seller's names the buyer by display name.
 *
 * BOOKED WITH < 30 MINUTES TO GO: no reminder row is created. The confirmation
 * already says "in N min", so a second near-identical text would be a
 * duplicate.
 *
 * Verification codes do NOT go through here: they contain a secret, are sent
 * synchronously when the user asks, and are never stored (see routes/auth.ts).
 */
import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  campuses,
  listings,
  meetupSpots,
  reservations,
  smsMessages,
  users,
  type User,
} from '../db/schema';
import { env } from '../env';
import { smsProvider, SmsSendError } from './provider';

export const REMINDER_LEAD_MS = 30 * 60 * 1000;
export const MAX_SMS_ATTEMPTS = 5;

function eligible(u: Pick<User, 'phone' | 'phoneVerifiedAt' | 'smsOptIn' | 'deletedAt'> | undefined): boolean {
  return !!u && !!u.phone && !!u.phoneVerifiedAt && u.smsOptIn && !u.deletedAt;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function appLink(path: string): string {
  return env.smsAppLinkBase ? `${env.smsAppLinkBase}${path}` : `dibbs:/${path}`;
}

export function formatMeetupTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* ---------------------------------------------------------------- enqueue */

/** Seller confirmation that their listing is live. Never throws. */
export async function enqueueListingPosted(db: Db, listingId: string): Promise<void> {
  try {
    const [row] = await db
      .select({ listing: listings, seller: users })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.sellerId))
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!row || !eligible(row.seller)) return;
    const { listing } = row;
    await db
      .insert(smsMessages)
      .values({
        userId: row.seller.id,
        kind: 'listing_posted',
        dedupeKey: `listing_posted:${listing.id}:${listing.createdAt.toISOString()}`,
        body:
          `Dibbs: "${truncate(listing.title, 60)}" is live at ${money(listing.priceCents)} for 24 hours. ` +
          `${appLink(`/listing/${listing.id}`)} Reply STOP to opt out.`,
        sendAfter: new Date(),
        listingId: listing.id,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error('[sms] enqueueListingPosted failed', err);
  }
}

type BookingContext = {
  reservation: typeof reservations.$inferSelect;
  listingTitle: string;
  spotLabel: string;
  timeZone: string;
  buyer: User;
  seller: User;
};

async function loadBooking(db: Db, reservationId: string): Promise<BookingContext | null> {
  const [row] = await db
    .select({ reservation: reservations, listing: listings, campus: campuses })
    .from(reservations)
    .innerJoin(listings, eq(listings.id, reservations.listingId))
    .innerJoin(campuses, eq(campuses.id, listings.campusId))
    .where(eq(reservations.id, reservationId))
    .limit(1);
  if (!row) return null;
  const r = row.reservation;
  const [spot] = r.spotId
    ? await db.select().from(meetupSpots).where(eq(meetupSpots.id, r.spotId)).limit(1)
    : [];
  const people = await db.select().from(users).where(inArray(users.id, [r.buyerId, r.sellerId]));
  const buyer = people.find((u) => u.id === r.buyerId);
  const seller = people.find((u) => u.id === r.sellerId);
  if (!buyer || !seller) return null;
  return {
    reservation: r,
    listingTitle: truncate(row.listing.title, 50),
    spotLabel: spot ? spot.name : 'the agreed place (see app)',
    timeZone: row.campus.timezone,
    buyer,
    seller,
  };
}

/**
 * Called after a booking reaches its FINAL state (accepted). Writes the
 * confirmation for both participants and, when the meetup is more than 30
 * minutes away, the reminder. Idempotent. Never throws.
 */
export async function enqueueBookingSms(db: Db, reservationId: string, now = new Date()): Promise<void> {
  try {
    const ctx = await loadBooking(db, reservationId);
    if (!ctx || ctx.reservation.status !== 'accepted') return;
    const r = ctx.reservation;
    const when = formatMeetupTime(r.startsAt, ctx.timeZone);
    const minutesAway = Math.round((r.startsAt.getTime() - now.getTime()) / 60_000);
    const soon = minutesAway <= 30 ? ` (in ${Math.max(minutesAway, 0)} min)` : '';
    const link = appLink(`/reservation/${r.id}`);
    const key = r.startsAt.toISOString();
    const reminderAt = new Date(r.startsAt.getTime() - REMINDER_LEAD_MS);
    const wantReminder = reminderAt.getTime() > now.getTime();

    const rows: (typeof smsMessages.$inferInsert)[] = [];
    for (const [who, other, role] of [
      [ctx.buyer, ctx.seller, 'buyer'],
      [ctx.seller, ctx.buyer, 'seller'],
    ] as const) {
      if (!eligible(who)) continue;
      const confirm =
        role === 'buyer'
          ? `Dibbs: Booked! "${ctx.listingTitle}" for ${money(r.priceCents)}. Meet ${other.displayName} ${when}${soon} at ${ctx.spotLabel}. ${link}`
          : `Dibbs: ${other.displayName} booked "${ctx.listingTitle}" (${money(r.priceCents)}). Meet ${when}${soon} at ${ctx.spotLabel}. ${link}`;
      rows.push({
        userId: who.id,
        kind: 'booking_confirmed',
        dedupeKey: `booking_confirmed:${r.id}:${who.id}:${key}`,
        body: `${confirm} Reply STOP to opt out.`,
        sendAfter: now,
        reservationId: r.id,
        meetupStartsAt: r.startsAt,
      });
      if (wantReminder) {
        rows.push({
          userId: who.id,
          kind: 'meetup_reminder',
          dedupeKey: `meetup_reminder:${r.id}:${who.id}:${key}`,
          body: `Dibbs reminder: meet ${other.displayName} in 30 min (${when}) at ${ctx.spotLabel} for "${ctx.listingTitle}". ${link}`,
          sendAfter: reminderAt,
          reservationId: r.id,
          meetupStartsAt: r.startsAt,
        });
      }
    }
    if (rows.length > 0) await db.insert(smsMessages).values(rows).onConflictDoNothing();
  } catch (err) {
    console.error('[sms] enqueueBookingSms failed', err);
  }
}

/**
 * Booking cancelled, declined, expired, or moved: every not-yet-sent text
 * about it is cancelled. On a reschedule the caller then calls
 * enqueueBookingSms again once the new time is agreed. Never throws.
 */
export async function cancelBookingSms(db: Db, reservationId: string): Promise<number> {
  try {
    const rows = await db
      .update(smsMessages)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(smsMessages.reservationId, reservationId), eq(smsMessages.status, 'scheduled')))
      .returning({ id: smsMessages.id });
    return rows.length;
  } catch (err) {
    console.error('[sms] cancelBookingSms failed', err);
    return 0;
  }
}

/** User opted out or closed their account: drop everything still queued for them. */
export async function cancelUserSms(db: Db, userId: string): Promise<void> {
  await db
    .update(smsMessages)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(smsMessages.userId, userId), eq(smsMessages.status, 'scheduled')));
}

/* --------------------------------------------------------------- dispatch */

export type DispatchResult = { sent: number; failed: number; retried: number; skipped: number };

/** Why a due row must not be sent any more, or null if it is still valid. */
async function staleReason(db: Db, msg: typeof smsMessages.$inferSelect, now: Date): Promise<string | null> {
  if (!msg.userId) return 'recipient deleted';
  const [user] = await db.select().from(users).where(eq(users.id, msg.userId)).limit(1);
  if (!eligible(user)) return 'recipient not opted in';
  if (msg.kind === 'listing_posted') return null;
  if (!msg.reservationId) return 'no booking';
  const [r] = await db.select().from(reservations).where(eq(reservations.id, msg.reservationId)).limit(1);
  if (!r || r.status !== 'accepted') return `booking is ${r?.status ?? 'gone'}`;
  if (msg.meetupStartsAt && r.startsAt.getTime() !== msg.meetupStartsAt.getTime()) return 'booking was moved';
  if (msg.kind === 'meetup_reminder' && r.startsAt.getTime() <= now.getTime()) return 'meetup already started';
  return null;
}

/**
 * Sends every due `scheduled` row. Safe to call concurrently and repeatedly:
 * rows are claimed with FOR UPDATE SKIP LOCKED before sending.
 */
export async function dispatchDueSms(db: Db, opts: { now?: Date; limit?: number } = {}): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const result: DispatchResult = { sent: 0, failed: 0, retried: 0, skipped: 0 };

  // A row stuck in 'sending' (process died mid-send) goes back to the queue.
  await db
    .update(smsMessages)
    .set({ status: 'scheduled', updatedAt: now })
    .where(
      and(
        eq(smsMessages.status, 'sending'),
        lt(smsMessages.updatedAt, new Date(now.getTime() - 5 * 60_000)),
      ),
    );

  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .where(and(eq(smsMessages.status, 'scheduled'), lte(smsMessages.sendAfter, now)))
      .orderBy(smsMessages.sendAfter)
      .limit(opts.limit ?? 50)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(smsMessages)
      .set({ status: 'sending', updatedAt: now })
      .where(inArray(smsMessages.id, due.map((d) => d.id)))
      .returning();
  });

  const provider = smsProvider();
  for (const msg of claimed) {
    const stale = await staleReason(db, msg, now);
    if (stale) {
      await db
        .update(smsMessages)
        .set({ status: 'skipped', lastError: stale, updatedAt: now })
        .where(eq(smsMessages.id, msg.id));
      result.skipped += 1;
      continue;
    }
    const [user] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, msg.userId!)).limit(1);
    try {
      const { providerMessageId } = await provider.send(user!.phone!, msg.body);
      await db
        .update(smsMessages)
        .set({
          status: 'sent',
          providerMessageId,
          attempts: msg.attempts + 1,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(smsMessages.id, msg.id));
      result.sent += 1;
    } catch (err) {
      const attempts = msg.attempts + 1;
      const retryable = err instanceof SmsSendError ? err.retryable : true;
      const giveUp = !retryable || attempts >= MAX_SMS_ATTEMPTS;
      await db
        .update(smsMessages)
        .set({
          status: giveUp ? 'failed' : 'scheduled',
          attempts,
          lastError: err instanceof Error ? err.message.slice(0, 300) : String(err),
          // 1, 2, 4, 8 minutes.
          sendAfter: giveUp ? msg.sendAfter : new Date(now.getTime() + 2 ** (attempts - 1) * 60_000),
          updatedAt: new Date(),
        })
        .where(eq(smsMessages.id, msg.id));
      if (giveUp) result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}

let timer: NodeJS.Timeout | null = null;

/** Starts the background dispatcher (backend/server.ts). No-op if interval is 0. */
export function startSmsDispatcher(db: Db): void {
  if (timer || env.smsDispatchIntervalMs === 0) return;
  // This repo's tsconfig pulls in the DOM lib (for the Expo app side), which
  // makes the ambient global `setInterval` type-resolve to the browser
  // overload (returns `number`, no `.unref`) even on this Node-only backend
  // file, where it actually returns a Timeout at runtime. The cast below is
  // required to match that reality — it does not change behavior, only the
  // type this file treats it as.
  timer = setInterval(() => {
    dispatchDueSms(db).catch((err) => console.error('[sms] dispatch failed', err));
  }, env.smsDispatchIntervalMs) as unknown as NodeJS.Timeout;
  timer.unref?.();
}

/** Count of queued texts — used by tests and the health endpoint. */
export async function pendingSmsCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(smsMessages)
    .where(eq(smsMessages.status, 'scheduled'));
  return Number(row?.n ?? 0);
}
