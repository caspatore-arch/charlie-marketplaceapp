/**
 * Who may buy, sell, make offers, book and post. One decision, used by
 * campusVerifiedProcedure (backend/trpc/trpc.ts) and by the caller's own
 * shape (auth.me), so the app's gates follow the server.
 *
 *  - 'blocked' (set on /admin) → never, whatever else is verified.
 *  - a verified campus email → yes.
 *  - 'approved' (set on /admin) → yes without a campus email. An approved
 *    seller is NOT campus, student or identity verified; copy must say
 *    "Approved seller", never "Campus email verified".
 *  - otherwise → needs a verified campus email.
 */
import type { User } from '../db/schema';

export type PostingAccess = User['postingAccess'];
export const POSTING_ACCESS_VALUES = ['default', 'approved', 'blocked'] as const satisfies readonly PostingAccess[];

export type PostingStatus = 'campus_verified' | 'approved' | 'needs_campus_email' | 'blocked';

type PostingFields = Pick<User, 'postingAccess' | 'campusEmailVerifiedAt'>;

export function postingStatus(u: PostingFields): PostingStatus {
  if (u.postingAccess === 'blocked') return 'blocked';
  if (u.campusEmailVerifiedAt) return 'campus_verified';
  if (u.postingAccess === 'approved') return 'approved';
  return 'needs_campus_email';
}

export function canPost(u: PostingFields): boolean {
  const s = postingStatus(u);
  return s === 'campus_verified' || s === 'approved';
}

export const BLOCKED_MESSAGE = 'Your account can’t buy, sell or post right now. Contact support.';
export const NEEDS_CAMPUS_EMAIL_MESSAGE =
  'Verify your campus email to buy, sell, or post. A phone number or a non-campus email isn’t enough.';

/** Fields the caller's own shape (auth.me and sign-in results) adds on top of the row. */
export function postingFields(u: PostingFields) {
  return { canPost: canPost(u), postingStatus: postingStatus(u) };
}
