/**
 * Plain-language copy for a "Get a Dibbs offer" request, seller side. One place
 * for status headlines, badge tones, money and campus-time formatting so the
 * list and the detail page never disagree.
 *
 * Wording rules: an estimate is never a price commitment, agreeing to meet is
 * not agreeing to a final price, and nothing here says money has moved
 * (docs/CONTRACT.md "Dibbs offer requests").
 */
import type { BadgeTone } from '@/components/ui/Badge';
import { clockTime, shortDate, zoneAbbreviation } from '@/components/booking/time';
import type { RouterOutputs } from '@/types';

export type DibbsOfferDetail = RouterOutputs['dibbsOffer']['byId'];
export type DibbsOfferSummary = RouterOutputs['dibbsOffer']['mine'][number];
export type DibbsOfferStatus = DibbsOfferDetail['status'];

/** Statuses the seller can still withdraw from (mirrors the server's open set). */
export const OPEN_STATUSES: readonly DibbsOfferStatus[] = [
  'submitted',
  'in_review',
  'needs_info',
  'offered',
  'meetup_proposed',
  'meetup_confirmed',
  'final_offer',
  'final_accepted',
];

export function isOpenStatus(status: DibbsOfferStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function money(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "$40" or "$30–$40". */
export function estimateText(lowCents: number, highCents: number): string {
  return lowCents === highCents ? money(lowCents) : `${money(lowCents)}–${money(highCents)}`;
}

/** "Thu, Oct 29 at 3:00 PM MST" in campus time. */
export function campusDateTime(iso: string | Date, timeZone?: string): string {
  const zone = zoneAbbreviation(timeZone);
  return `${shortDate(iso, timeZone)} at ${clockTime(iso, timeZone)}${zone ? ` ${zone}` : ''}`;
}

export const CLOSED_OUTCOME_HEADLINES: Record<string, string> = {
  no_show: 'Closed: the meetup didn’t happen',
  not_as_described: 'Closed after the inspection',
  sold_elsewhere: 'Closed: the item sold another way',
  duplicate: 'Closed as a duplicate',
  other: 'Closed by Dibbs',
};

export interface StatusCopy {
  /** Short label for list rows and badges. */
  label: string;
  /** Headline on the detail page. */
  headline: string;
  body: string;
  tone: BadgeTone;
}

type StatusInput = Pick<DibbsOfferSummary, 'status'> & {
  closedOutcome?: string | null;
  meetupProposedBy?: 'seller' | 'dibbs' | null;
};

export function statusCopy(r: StatusInput): StatusCopy {
  switch (r.status) {
    case 'submitted':
      return {
        label: 'Sent to Dibbs',
        headline: 'Request sent',
        body: 'The Dibbs team reviews each request by hand. They aim to reply within about an hour, but that isn’t guaranteed.',
        tone: 'neutral',
      };
    case 'in_review':
      return {
        label: 'Being reviewed',
        headline: 'Dibbs is reviewing it',
        body: 'A team member is looking at your photos and details. You’ll get an estimate, a question, or an answer here.',
        tone: 'neutral',
      };
    case 'needs_info':
      return {
        label: 'Dibbs has a question',
        headline: 'Dibbs has a question',
        body: 'Answer below so the team can send an estimate.',
        tone: 'warning',
      };
    case 'offered':
      return {
        label: 'Estimate ready',
        headline: 'You have an estimate',
        body: 'This is an estimate, not a final price. Dibbs confirms the price after inspecting the item.',
        tone: 'warning',
      };
    case 'meetup_proposed':
      return r.meetupProposedBy === 'dibbs'
        ? {
            label: 'Meetup to confirm',
            headline: 'Dibbs suggested a meetup',
            body: 'Accept the time and place, or suggest another time.',
            tone: 'warning',
          }
        : {
            label: 'Waiting for Dibbs',
            headline: 'Waiting for Dibbs to confirm',
            body: 'You suggested a time and place. Nothing is booked until Dibbs confirms.',
            tone: 'neutral',
          };
    case 'meetup_confirmed':
      return {
        label: 'Meetup confirmed',
        headline: 'Meetup confirmed',
        body: 'Dibbs will inspect the item when you meet and then make a final offer. You can still say no.',
        tone: 'success',
      };
    case 'final_offer':
      return {
        label: 'Final offer ready',
        headline: 'Dibbs made a final offer',
        body: 'Nothing is decided until you answer. Accept or decline below.',
        tone: 'warning',
      };
    case 'final_accepted':
      return {
        label: 'You accepted',
        headline: 'You accepted the final offer',
        body: 'Dibbs will record the handoff.',
        tone: 'success',
      };
    case 'completed':
      return {
        label: 'Handoff complete',
        headline: 'Handoff complete',
        body: 'Dibbs recorded that the handoff happened.',
        tone: 'success',
      };
    case 'declined':
      return {
        label: 'Dibbs passed',
        headline: 'Dibbs can’t make an offer on this one',
        body: 'Thanks for sending it. You can still list it on Dibbs for other students.',
        tone: 'neutral',
      };
    case 'seller_declined':
      return {
        label: 'You said no',
        headline: 'You said no to the estimate',
        body: 'This request is closed.',
        tone: 'neutral',
      };
    case 'final_declined':
      return {
        label: 'You declined',
        headline: 'You declined the final offer',
        body: 'This request is closed.',
        tone: 'neutral',
      };
    case 'withdrawn':
      return {
        label: 'Withdrawn',
        headline: 'You withdrew this request',
        body: 'It’s closed, and the Dibbs team no longer sees it as open.',
        tone: 'neutral',
      };
    case 'expired':
      return {
        label: 'Estimate expired',
        headline: 'The estimate expired',
        body: 'It wasn’t answered in time, so it lapsed. Send a new request if you still want an offer.',
        tone: 'neutral',
      };
    case 'closed':
    default: {
      const headline = (r.closedOutcome && CLOSED_OUTCOME_HEADLINES[r.closedOutcome]) || 'Closed by Dibbs';
      return { label: 'Closed', headline, body: 'This request is closed.', tone: 'neutral' };
    }
  }
}

/** Timeline row text, from the seller's point of view ("Dibbs" for staff). */
export function timelineTitle(e: DibbsOfferDetail['timeline'][number], timeZone?: string): string {
  const who = e.actor === 'staff' ? 'Dibbs' : e.actor === 'seller' ? 'You' : 'Dibbs';
  const est = e.lowCents != null && e.highCents != null ? estimateText(e.lowCents, e.highCents) : null;
  const when = e.startsAt ? campusDateTime(e.startsAt, timeZone) : null;
  const where = e.spotName ? ` at ${e.spotName}` : '';
  switch (e.kind) {
    case 'submitted':
      return 'You sent the request';
    case 'review_started':
      return 'Dibbs started reviewing';
    case 'info_requested':
      return 'Dibbs asked a question';
    case 'info_provided':
      return 'You answered';
    case 'estimate_sent':
      return est ? `Dibbs sent an estimate: ${est} (subject to inspection)` : 'Dibbs sent an estimate';
    case 'estimate_declined':
      return 'You said no to the estimate';
    case 'estimate_expired':
      return 'The estimate expired';
    case 'agreed_to_meet':
      return when ? `You agreed to meet: ${when}${where}` : 'You agreed to meet';
    case 'meetup_proposed':
      return when ? `${who} suggested ${when}${where}` : `${who} suggested a meetup`;
    case 'meetup_rescheduled':
      return when ? `${who} suggested a new time: ${when}${where}` : `${who} suggested a new time`;
    case 'meetup_confirmed':
      return when ? `Meetup confirmed: ${when}${where}` : 'Meetup confirmed';
    case 'meetup_cancelled':
      return `${who} cancelled the meetup`;
    case 'final_offer_sent':
    case 'final_offer_revised':
      return est
        ? `${e.kind === 'final_offer_revised' ? 'Dibbs revised the final offer' : 'Dibbs made a final offer'}: ${est}`
        : 'Dibbs made a final offer';
    case 'final_accepted':
      return est ? `You accepted ${est}` : 'You accepted the final offer';
    case 'final_declined':
      return 'You declined the final offer';
    case 'handoff_completed':
      return 'Dibbs recorded the handoff';
    case 'payout_recorded_outside_app':
      return 'Dibbs recorded a payout made outside the app';
    case 'declined':
      return 'Dibbs can’t make an offer on this one';
    case 'withdrawn':
      return 'You withdrew the request';
    case 'sold_elsewhere':
      return 'The item sold through its public listing';
    case 'closed':
      return 'Dibbs closed the request';
    default:
      return e.actor === 'seller' ? 'You updated the request' : 'Update from Dibbs';
  }
}

/** 24000 -> "0:24". */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
