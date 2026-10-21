/** FAKE fixtures for the buyout concept. Not real listings, not from any database. */
import type { BuyoutListingFixture } from './logic';

const MIN = 60_000;

/** Fixtures are expressed relative to `now` so the demo always looks the same. */
export function makeFixtures(now: number): BuyoutListingFixture[] {
  return [
    { id: 'FAKE-1', title: 'FAKE: Desk lamp bundle ($100)', category: 'electronics', askingCents: 10000, status: 'active', hasBooking: false, hasLiveAcceptedOfferHold: false, expiresAt: now + 90 * MIN },
    { id: 'FAKE-2', title: 'FAKE: Mini fridge ($40)', category: 'furniture', askingCents: 4000, status: 'active', hasBooking: false, hasLiveAcceptedOfferHold: false, expiresAt: now + 45 * MIN },
    { id: 'FAKE-3', title: 'FAKE: Monitor (reserved)', category: 'electronics', askingCents: 12000, status: 'reserved', hasBooking: true, hasLiveAcceptedOfferHold: false, expiresAt: now + 60 * MIN },
    { id: 'FAKE-4', title: 'FAKE: Bike (outside window)', category: 'furniture', askingCents: 15000, status: 'active', hasBooking: false, hasLiveAcceptedOfferHold: false, expiresAt: now + 20 * 60 * MIN },
    { id: 'FAKE-5', title: 'FAKE: Textbook ($15)', category: 'books', askingCents: 1500, status: 'active', hasBooking: false, hasLiveAcceptedOfferHold: false, expiresAt: now + 30 * MIN },
    { id: 'FAKE-6', title: 'FAKE: Speaker (offer hold)', category: 'electronics', askingCents: 8000, status: 'active', hasBooking: false, hasLiveAcceptedOfferHold: true, expiresAt: now + 50 * MIN },
  ];
}
