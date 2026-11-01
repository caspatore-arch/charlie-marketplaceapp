/**
 * Labels and formatting for the Dibbs buying-team screens. Money is integer
 * cents everywhere; dates arrive as Date (superjson) but are coerced defensively.
 * Plain words only: Dibbs is the buyer, and every price is "subject to inspection".
 */
import type { RouterOutputs } from '@/types';

export type StaffQueueRow = RouterOutputs['dibbsStaff']['queue'][number];
export type StaffDetail = RouterOutputs['dibbsStaff']['byId'];
export type StaffStatus = StaffDetail['status'];
export type StaffTimelineEvent = StaffDetail['timeline'][number];

/** Same ceiling as the server (backend/dibbs/rules.ts DIBBS_MAX_CENTS): $5,000. */
export const MAX_CENTS = 500_000;

export const OPEN_STATUSES: readonly StaffStatus[] = [
  'submitted',
  'in_review',
  'needs_info',
  'offered',
  'meetup_proposed',
  'meetup_confirmed',
  'final_offer',
  'final_accepted',
];

export function isOpenStatus(status: StaffStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export const STATUS_LABEL: Record<StaffStatus, string> = {
  submitted: 'New, waiting for review',
  in_review: 'In review',
  needs_info: 'Waiting for the seller to answer a question',
  offered: 'Estimate sent, waiting for the seller',
  meetup_proposed: 'Meetup proposed',
  meetup_confirmed: 'Meetup confirmed, inspection pending',
  final_offer: 'Final offer sent, waiting for the seller',
  final_accepted: 'Final offer accepted, handoff pending',
  completed: 'Handoff complete',
  declined: 'Declined by Dibbs',
  seller_declined: 'Seller turned down the estimate',
  final_declined: 'Seller turned down the final offer',
  withdrawn: 'Withdrawn by the seller',
  expired: 'Estimate expired without an answer',
  closed: 'Closed',
};

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export function statusTone(status: StaffStatus): StatusTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'submitted':
    case 'in_review':
    case 'meetup_confirmed':
    case 'final_accepted':
      return 'warning';
    case 'declined':
    case 'seller_declined':
    case 'final_declined':
    case 'withdrawn':
    case 'expired':
    case 'closed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Short status for list rows; meetup_proposed names who proposed. */
export function statusText(status: StaffStatus, meetupProposedBy?: string | null): string {
  if (status === 'meetup_proposed') {
    return meetupProposedBy === 'seller' ? 'Seller proposed a meetup' : 'Dibbs proposed a meetup, waiting for the seller';
  }
  return STATUS_LABEL[status];
}

export const OUTCOME_LABEL = {
  no_show: 'No-show',
  not_as_described: 'Not as described',
  sold_elsewhere: 'Sold elsewhere',
  duplicate: 'Duplicate request',
  other: 'Other',
} as const;
export type CloseOutcome = keyof typeof OUTCOME_LABEL;

export function outcomeLabel(outcome: string | null | undefined): string | null {
  if (!outcome) return null;
  return (OUTCOME_LABEL as Record<string, string>)[outcome] ?? outcome.replace(/_/g, ' ');
}

export const CONDITION_LABEL: Record<string, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
};

const EVENT_LABEL: Record<string, string> = {
  submitted: 'Request submitted',
  review_started: 'Review started',
  info_requested: 'Question sent to the seller',
  info_provided: 'Seller answered',
  estimate_sent: 'Estimate sent',
  estimate_declined: 'Seller turned down the estimate',
  estimate_expired: 'Estimate expired',
  declined: 'Declined by Dibbs',
  agreed_to_meet: 'Seller agreed to meet and proposed a time',
  meetup_proposed: 'Dibbs proposed a meetup',
  meetup_rescheduled: 'Another meetup time proposed',
  meetup_confirmed: 'Meetup confirmed',
  meetup_cancelled: 'Meetup cancelled',
  final_offer_sent: 'Final offer sent',
  final_offer_revised: 'Final offer revised',
  final_accepted: 'Seller accepted the final offer',
  final_declined: 'Seller turned down the final offer',
  handoff_completed: 'Handoff recorded as complete',
  payout_recorded_outside_app: 'Payout recorded as made outside the app',
  closed: 'Closed by Dibbs',
  withdrawn: 'Withdrawn by the seller',
  sold_elsewhere: 'Item sold through its public listing',
  note: 'Staff note',
};

export function eventLabel(kind: string): string {
  return EVENT_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ money */

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

/** "$120" for an exact estimate, "$100–$140" for a range. */
export function estimateText(low: number | null | undefined, high: number | null | undefined): string | null {
  if (low == null || high == null) return null;
  return low === high ? formatCents(low) : `${formatCents(low)}–${formatCents(high)}`;
}

/** Cents back into a plain dollar string for an input default. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

/* ------------------------------------------------------------------- time */

/** "42 min", "3 h", "2 d". */
export function waitingText(minutes: number): string {
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** Device-local date and time, e.g. "Oct 27, 3:42 PM". */
export function formatWhen(value: Date | string | number | null | undefined): string {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}
