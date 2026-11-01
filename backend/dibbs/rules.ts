/**
 * Shared rules for "Get a Dibbs offer" requests (docs/CONTRACT.md
 * "Dibbs offer requests"). Defaults here are reversible placeholders for
 * decisions the owner has not made yet: estimate validity, meetup horizon.
 */
import type { DibbsOfferStatus } from '../db/schema';
import { env } from '../env';

/** Placeholder until the owner decides offer validity: an estimate lapses if the seller doesn't answer in 48h. */
export const DIBBS_ESTIMATE_VALID_MS = 48 * 60 * 60 * 1000;
/** Meetups can be proposed up to 7 days ahead (same horizon as Archive meetup requests). */
export const DIBBS_MEETUP_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Amount ceiling, same as a listing's asking price ($5,000). */
export const DIBBS_MAX_CENTS = 5_000_00;
/** Open requests one person may have at once, and new requests per rolling day. */
export const DIBBS_MAX_OPEN_PER_SELLER = 5;
export const DIBBS_MAX_NEW_PER_DAY = 10;

export const TERMINAL_STATUSES = [
  'completed',
  'declined',
  'seller_declined',
  'final_declined',
  'withdrawn',
  'expired',
  'closed',
] as const satisfies readonly DibbsOfferStatus[];

export const OPEN_STATUSES = [
  'submitted',
  'in_review',
  'needs_info',
  'offered',
  'meetup_proposed',
  'meetup_confirmed',
  'final_offer',
  'final_accepted',
] as const satisfies readonly DibbsOfferStatus[];

export function isOpen(status: DibbsOfferStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** States the team can still send (or revise) an estimate from. `expired` re-opens with a fresh estimate. */
export const ESTIMATE_FROM: readonly DibbsOfferStatus[] = ['submitted', 'in_review', 'needs_info', 'offered', 'expired'];
/** States a polite decline can come from (after a confirmed meetup, staff use `close` with an outcome). */
export const DECLINE_FROM: readonly DibbsOfferStatus[] = ['submitted', 'in_review', 'needs_info', 'offered', 'meetup_proposed'];
/** States where a meetup proposal (new or reschedule) is allowed. */
export const PROPOSE_MEETUP_FROM: readonly DibbsOfferStatus[] = ['offered', 'meetup_proposed', 'meetup_confirmed'];
/** States the seller may withdraw from: anything open before the handoff is recorded. */
export const WITHDRAW_FROM: readonly DibbsOfferStatus[] = OPEN_STATUSES;

export function isDibbsStaff(userId: string | null | undefined): boolean {
  return !!userId && env.dibbsStaffUserIds.includes(userId);
}

/** Who the seller is waiting on, for list badges. */
export function sellerActionNeeded(r: { status: DibbsOfferStatus; meetupProposedBy: string | null }): boolean {
  return (
    r.status === 'needs_info' ||
    r.status === 'offered' ||
    r.status === 'final_offer' ||
    (r.status === 'meetup_proposed' && r.meetupProposedBy === 'dibbs')
  );
}

export function staffActionNeeded(r: { status: DibbsOfferStatus; meetupProposedBy: string | null }): boolean {
  return (
    r.status === 'submitted' ||
    r.status === 'in_review' ||
    r.status === 'meetup_confirmed' ||
    r.status === 'final_accepted' ||
    (r.status === 'meetup_proposed' && r.meetupProposedBy === 'seller')
  );
}

export function moneyLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

export function estimateLabel(low: number | null, high: number | null): string | null {
  if (low == null || high == null) return null;
  return low === high ? moneyLabel(low) : `${moneyLabel(low)}–${moneyLabel(high)}`;
}
