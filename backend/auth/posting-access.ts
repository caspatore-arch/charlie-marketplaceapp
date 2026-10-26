/**
 * Who may buy, sell, make offers, book and post. One decision, used by
 * campusVerifiedProcedure (backend/trpc/trpc.ts) and by the caller's own
 * shape (auth.me), so the app's gates follow the server.
 *
 *  - 'blocked' (set on /admin) → never, whatever else is verified.
 *  - a verified campus email → yes.
 *  - 'approved' (set on /admin) → yes, shown as "Approved seller" (matches
 *    the public badge). NOT campus, student or identity verified; copy must
 *    never say "Campus email verified". Mostly useful for phone-only accounts.
 *  - any other verified email → yes (owner decision 2026-10-26). `users.email`
 *    is only ever stored after a sign-in or link code proves the inbox, so a
 *    non-null email is a verified email. This is NOT campus, student or
 *    identity verification; copy must never call it "Campus email verified".
 *  - otherwise (a phone-only account) → needs a verified campus email.
 */
import type { User } from '../db/schema';

export type PostingAccess = User['postingAccess'];
export const POSTING_ACCESS_VALUES = ['default', 'approved', 'blocked'] as const satisfies readonly PostingAccess[];

export type PostingStatus = 'campus_verified' | 'email_verified' | 'approved' | 'needs_campus_email' | 'blocked';

type PostingFields = Pick<User, 'postingAccess' | 'campusEmailVerifiedAt' | 'email'>;

export function postingStatus(u: PostingFields): PostingStatus {
  if (u.postingAccess === 'blocked') return 'blocked';
  if (u.campusEmailVerifiedAt) return 'campus_verified';
  if (u.postingAccess === 'approved') return 'approved';
  if (u.email) return 'email_verified';
  return 'needs_campus_email';
}

export function canPost(u: PostingFields): boolean {
  const s = postingStatus(u);
  return s === 'campus_verified' || s === 'email_verified' || s === 'approved';
}

export const BLOCKED_MESSAGE = 'Your account can’t buy, sell or post right now. Contact support.';
export const NEEDS_CAMPUS_EMAIL_MESSAGE =
  'Verify your campus email to buy, sell, or post. A phone number alone isn’t enough.';

/** Fields the caller's own shape (auth.me and sign-in results) adds on top of the row. */
export function postingFields(u: PostingFields) {
  return { canPost: canPost(u), postingStatus: postingStatus(u) };
}
