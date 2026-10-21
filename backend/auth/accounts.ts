/**
 * Account-linking helpers for phone sign-in.
 *
 * The safe transition rule: two accounts are never merged automatically when
 * BOTH have history (listings, bookings, offers, messages, posts). Linking only
 * ever moves a phone number or an email onto the account that has the
 * history, and retires the other account only when it is empty. Anything else
 * is refused with a message that sends the person to support.
 */
import crypto from 'node:crypto';
import { eq, or } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  communityPosts,
  conversations,
  listings,
  offers,
  phoneCodes,
  reservations,
  sessions,
  users,
  type User,
} from '../db/schema';

/** True when the account has anything another person could depend on. */
export async function hasActivity(db: Db, userId: string): Promise<boolean> {
  const checks = await Promise.all([
    db.select({ id: listings.id }).from(listings).where(eq(listings.sellerId, userId)).limit(1),
    db
      .select({ id: reservations.id })
      .from(reservations)
      .where(or(eq(reservations.buyerId, userId), eq(reservations.sellerId, userId)))
      .limit(1),
    db
      .select({ id: offers.id })
      .from(offers)
      .where(or(eq(offers.buyerId, userId), eq(offers.sellerId, userId)))
      .limit(1),
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(or(eq(conversations.buyerId, userId), eq(conversations.sellerId, userId)))
      .limit(1),
    db.select({ id: communityPosts.id }).from(communityPosts).where(eq(communityPosts.authorId, userId)).limit(1),
  ]);
  return checks.some((rows) => rows.length > 0);
}

/**
 * Retires an EMPTY account that is being folded into another one. Same
 * anonymization as account closure, minus the checks (the caller has proven
 * it has no activity). Frees its email and phone for the surviving account.
 */
export async function retireEmptyAccount(db: Db, user: User, intoUserId: string): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set({
      deletedAt: now,
      displayName: 'Deleted user',
      email: `merged+${user.id}@account.invalid`,
      phone: null,
      phoneVerifiedAt: null,
      smsOptIn: false,
      avatarUrl: null,
      bio: `Linked into another account (${intoUserId.slice(0, 8)}).`,
    })
    .where(eq(users.id, user.id));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await db.delete(phoneCodes).where(eq(phoneCodes.userId, user.id));
}

/** sha256 of phone + code. The code itself is never stored or logged in production. */
export function hashPhoneCode(phone: string, code: string): string {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

export function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function newPhoneCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
