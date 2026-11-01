/**
 * One physical item, two ways to sell it. When a public listing also has a
 * Dibbs offer request, the listing's own status is the shared lock:
 *
 *  - A confirmed Dibbs meetup holds the listing by setting it `reserved`
 *    (and `holdsListing` on the request), under the listing row lock. Booking
 *    already refuses anything that isn't `active`, so a buyer can't book over it.
 *  - A Dibbs meetup can only be confirmed while the listing is `active` or
 *    archived (`expired`). If a buyer booked it first, the listing is
 *    `reserved` by that reservation and Dibbs gets a CONFLICT.
 *  - Releasing a hold mirrors reservation.releaseListing: back to `active`, or
 *    `expired` (the Archive) when past its 24 hours.
 *  - Completing the Dibbs handoff marks the listing `sold`.
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from '../db/client';
import { dibbsOfferRequests, listings, reservations } from '../db/schema';
import { expireOffers, recordReservationEvent } from '../trpc/lib';

/** True when an open Dibbs request currently holds this listing. */
export async function dibbsHoldsListing(db: Db, listingId: string): Promise<boolean> {
  const rows = await db
    .select({ id: dibbsOfferRequests.id })
    .from(dibbsOfferRequests)
    .where(and(eq(dibbsOfferRequests.listingId, listingId), eq(dibbsOfferRequests.holdsListing, true)))
    .limit(1);
  return rows.length > 0;
}

export type HoldResult = { ok: true } | { ok: false; reason: 'reserved' | 'sold' | 'removed' };

/**
 * Locks the listing row and puts it on hold for this Dibbs request. Run inside
 * the same transaction that confirms the meetup. Declines other open meetup
 * requests on the listing and closes its open offers, as booking does.
 */
export async function holdListingForDibbs(tx: Db, listingId: string, requestId: string): Promise<HoldResult> {
  const [listing] = await tx.select().from(listings).where(eq(listings.id, listingId)).for('update').limit(1);
  if (!listing) return { ok: true }; // listing deleted: nothing to hold
  if (listing.status === 'sold') return { ok: false, reason: 'sold' };
  if (listing.status === 'reserved') {
    const ours = await tx
      .select({ id: dibbsOfferRequests.id })
      .from(dibbsOfferRequests)
      .where(and(eq(dibbsOfferRequests.id, requestId), eq(dibbsOfferRequests.holdsListing, true)))
      .limit(1);
    return ours.length > 0 ? { ok: true } : { ok: false, reason: 'reserved' };
  }
  // A removed listing doesn't block a private sale; there is just nothing public to hold.
  if (listing.status === 'removed') return { ok: true };

  const now = new Date();
  await tx.update(listings).set({ status: 'reserved', updatedAt: now }).where(eq(listings.id, listingId));
  await tx.update(dibbsOfferRequests).set({ holdsListing: true }).where(eq(dibbsOfferRequests.id, requestId));

  const declined = await tx
    .update(reservations)
    .set({ status: 'declined', cancelReason: 'item_reserved', updatedAt: now })
    .where(and(eq(reservations.listingId, listingId), inArray(reservations.status, ['requested', 'countered'])))
    .returning();
  for (const r of declined) await recordReservationEvent(tx, r, 'declined', null);
  await expireOffers(tx, now);
  return { ok: true };
}

/** Lifts this request's hold (if any) and puts the listing back on the market or in the Archive. */
export async function releaseDibbsHold(tx: Db, request: { id: string; listingId: string | null; holdsListing: boolean }) {
  if (!request.holdsListing) return;
  await tx.update(dibbsOfferRequests).set({ holdsListing: false }).where(eq(dibbsOfferRequests.id, request.id));
  if (!request.listingId) return;
  const [listing] = await tx.select().from(listings).where(eq(listings.id, request.listingId)).for('update').limit(1);
  if (!listing || listing.status !== 'reserved') return;
  const stillHeld = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.listingId, listing.id), eq(reservations.status, 'accepted')))
    .limit(1);
  if (stillHeld.length > 0) return;
  const expired = listing.expiresAt != null && listing.expiresAt < new Date();
  await tx
    .update(listings)
    .set({ status: expired ? 'expired' : 'active', updatedAt: new Date() })
    .where(eq(listings.id, listing.id));
}

/** The Dibbs handoff happened: the linked listing is sold and the hold ends. */
export async function markListingSoldToDibbs(tx: Db, request: { id: string; listingId: string | null }) {
  await tx.update(dibbsOfferRequests).set({ holdsListing: false }).where(eq(dibbsOfferRequests.id, request.id));
  if (!request.listingId) return;
  const now = new Date();
  await tx
    .update(listings)
    .set({ status: 'sold', soldAt: now, updatedAt: now })
    .where(and(eq(listings.id, request.listingId), inArray(listings.status, ['active', 'reserved', 'expired'])));
  await expireOffers(tx, now);
}
