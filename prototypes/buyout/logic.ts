/**
 * CONCEPT PROTOTYPE — expiring-listing buyout. NOT LIVE. Pure functions only.
 * No imports from backend/ or lib/trpc. No network. No valuation model.
 */

/** The buyout offer is 25% of the seller's asking price ($100 -> $25, NOT $75). */
export const BUYOUT_PERCENT = 25;

/** Rounding rule: round half up to the nearest cent via Math.round. */
export function buyoutOfferCents(askingCents: number): number {
  return Math.round((askingCents * BUYOUT_PERCENT) / 100);
}

/**
 * UNRESOLVED / PLACEHOLDER values. Every number below is a stand-in so the
 * prototype runs; none is a product decision. See docs/concepts/BUYOUT.md.
 */
export interface BuyoutConfig {
  /** Master switch. Default false. Nothing in the concept ever sends anything. */
  enabled: boolean;
  /** UNRESOLVED: how long before listing expiry the offer may be proposed. */
  triggerMinutesBeforeExpiry: number;
  /** UNRESOLVED: minimum asking price (cents) to qualify. */
  minAskingCents: number;
  /** UNRESOLVED: which categories qualify. Empty = none qualify. */
  eligibleCategories: string[];
  /** UNRESOLVED: max total spend (cents) the concept may commit. */
  budgetCapCents: number;
}

export const DEFAULT_BUYOUT_CONFIG: BuyoutConfig = {
  enabled: false,
  triggerMinutesBeforeExpiry: 120, // placeholder
  minAskingCents: 2500, // placeholder
  eligibleCategories: ['electronics', 'furniture'], // placeholder
  budgetCapCents: 20000, // placeholder
};

/** Minimal fake-listing shape for the concept (not the live Listing type). */
export interface BuyoutListingFixture {
  id: string;
  title: string;
  category: string;
  askingCents: number;
  /** FAKE state flags mirroring what a real integration would need to check. */
  status: 'active' | 'reserved' | 'sold' | 'expired';
  hasBooking: boolean;
  hasLiveAcceptedOfferHold: boolean;
  expiresAt: number; // epoch ms
}

export type IneligibleReason =
  | 'not_active'
  | 'already_reserved_sold_or_booked'
  | 'live_accepted_offer_hold'
  | 'outside_trigger_window'
  | 'below_minimum'
  | 'category_not_eligible'
  | 'over_budget';

export const REASON_TEXT: Record<IneligibleReason, string> = {
  not_active: 'Listing is not active',
  already_reserved_sold_or_booked: 'Already reserved, sold, or booked',
  live_accepted_offer_hold: 'A live accepted offer is holding this item',
  outside_trigger_window: 'Outside the trigger window before expiry',
  below_minimum: 'Asking price is below the minimum',
  category_not_eligible: 'Category is not eligible',
  over_budget: 'Offer would exceed the budget cap',
};

export interface Eligibility {
  eligible: boolean;
  reasons: IneligibleReason[];
  offerCents: number;
}

/**
 * Eligibility check. Deliberately NO valuation model: price is whatever the
 * seller asked. `committedCents` is spend already committed against the budget.
 */
export function evaluateEligibility(
  listing: BuyoutListingFixture,
  config: BuyoutConfig,
  now: number,
  committedCents = 0,
): Eligibility {
  const reasons: IneligibleReason[] = [];
  const offerCents = buyoutOfferCents(listing.askingCents);

  if (listing.status === 'expired') reasons.push('not_active');
  if (listing.status === 'reserved' || listing.status === 'sold' || listing.hasBooking) {
    reasons.push('already_reserved_sold_or_booked');
  }
  if (listing.hasLiveAcceptedOfferHold) reasons.push('live_accepted_offer_hold');

  const msLeft = listing.expiresAt - now;
  const windowMs = config.triggerMinutesBeforeExpiry * 60_000;
  if (msLeft <= 0) {
    if (!reasons.includes('not_active')) reasons.push('not_active');
  } else if (msLeft > windowMs) {
    reasons.push('outside_trigger_window');
  }

  if (listing.askingCents < config.minAskingCents) reasons.push('below_minimum');
  if (!config.eligibleCategories.includes(listing.category)) reasons.push('category_not_eligible');
  if (committedCents + offerCents > config.budgetCapCents) reasons.push('over_budget');

  return { eligible: reasons.length === 0, reasons, offerCents };
}

/** Concept state machine: accepted goes to manual review before anything happens. */
export type BuyoutState =
  | 'proposed'
  | 'seller_accepted'
  | 'seller_declined'
  | 'expired'
  | 'manual_review';

const TRANSITIONS: Record<BuyoutState, BuyoutState[]> = {
  proposed: ['seller_accepted', 'seller_declined', 'expired'],
  seller_accepted: ['manual_review'],
  seller_declined: [],
  expired: [],
  manual_review: [], // terminal in the concept: a human decides; nothing automatic
};

export function canTransition(from: BuyoutState, to: BuyoutState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns the new state, or the same state if the transition is not allowed. */
export function transition(from: BuyoutState, to: BuyoutState): BuyoutState {
  return canTransition(from, to) ? to : from;
}

/** Accept/decline helper: accepting moves straight on to manual review. */
export function sellerAccept(state: BuyoutState): BuyoutState {
  const accepted = transition(state, 'seller_accepted');
  return accepted === 'seller_accepted' ? transition(accepted, 'manual_review') : state;
}

export function sellerDecline(state: BuyoutState): BuyoutState {
  return transition(state, 'seller_declined');
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'expired';
  const m = Math.floor(msLeft / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m left` : `${m}m left`;
}
