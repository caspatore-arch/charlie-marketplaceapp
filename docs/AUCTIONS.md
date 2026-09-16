# Auctions, custom meetup locations, payments — specification

Supersedes the fixed-price parts of `docs/CONTRACT.md`. Written before implementation; it is the source of truth. Deviate only by editing this file in the same change.

## 1. Auction is an option on the sell form

Listings keep working exactly as they do today. The sell form gains a **sale type** choice:

- **Fixed price** (default, unchanged): `priceCents`, optional 24h "Sell today" expiry. Buyers request a meetup directly. Every existing flow and test stays valid.
- **Auction — 24 hours**: bidding, with an optional buy-it-now price.

`listings.saleType` enum `'fixed' | 'auction'`, default `'fixed'`. Auction-only columns are nullable and ignored when `saleType = 'fixed'`:

- `startPriceCents` int — required for auctions, ≥ 100 ($1 floor; below that a platform fee cannot round sensibly).
- `buyoutPriceCents` int, **optional** — must be > `startPriceCents`.
- `endsAt` timestamptz = `createdAt + 24h` (reuses the existing `expiresAt` column rather than adding a second one — see note below).
- `currentPriceCents` / `bidCount` — derived, never stored: highest bid else `startPriceCents`.

> Implementation note: `listings.expiresAt` already exists for "Sell today". Reuse it as the auction end time and keep one expiry concept, rather than introducing a parallel `endsAt` that `applyExpiry` would have to reason about twice.

**`bids`**: id, listingId, bidderId, amountCents, createdAt. Index `(listingId, amountCents desc)`.

Rules, all server-enforced:
1. Bidding requires an account, `saleType = 'auction'`, `status = 'active'`, `now < expiresAt`, bidder ≠ seller, and neither party blocking the other. Bidding on a fixed-price listing → `BAD_REQUEST`.
2. **Minimum increment:** next bid ≥ `currentPriceCents + max(100, ceil(currentPriceCents * 0.05))` — $1 or 5%, whichever is larger. Rejected with `BAD_REQUEST` naming the required minimum.
3. A bid is a **commitment to buy**, not a reservation. Say so in the UI.
4. **Buyout** ends the auction immediately: `status = 'reserved'`, winner = that buyer, `expiresAt` = now. Allowed only while `active`, only if `buyoutPriceCents` is set, and only if no existing bid is already ≥ buyout.
5. **Anti-sniping:** a bid inside the final 2 minutes pushes `expiresAt` to `now + 2 minutes`. Standard practice; surface "Extended" in the UI when it happens.
6. A seller cannot remove or edit price fields on an auction that already has a bid (`CONFLICT`). Zero bids → free to edit or remove.

### Settlement at `expiresAt` (lazy, inside `applyExpiry`, transactional)

- **Auction with bids** → `status = 'reserved'`; a `reservations` row is created for (listing, highest bidder) with `status: 'requested'`, `priceCents` = winning amount, no spot or time yet. Both parties then use the existing meetup flow to agree where and when.
- **Auction with no bids** → `status = 'expired'`. Seller may relist.
- **Fixed-price listing** → unchanged behaviour.
- The existing "one accepted reservation per listing" partial unique index still guarantees a single hold.

### Reposting

`listing.relist { id, saleType?, ... }` on an `expired`/`removed` listing returns it to `active` and, for an auction, sets `expiresAt = now + 24h` and **clears previous bids** — a new auction is a new auction. A `sold` listing cannot be relisted.

**State plainly in the sell form:** an auction with a single bid sells at the start price. The start price is the seller's floor.

## 2. Meetup locations

Curated campus spots stay and are **recommended first**. In addition, either party may propose a **custom address**.

`campuses` gains `centerLat`, `centerLng`, `meetupRadiusMeters` (default **3219** = 2 miles). U of A center: `32.2319, -110.9501` — `[FOUNDER TO CONFIRM]`, approximate.

`reservations` gains `customAddress` text?, `customLat` double?, `customLng` double?. Exactly one of `spotId` or the custom trio is set — enforce with a DB check constraint.

- Geocoding: `POST`-free lookup via OpenStreetMap **Nominatim** from the backend, with a descriptive `User-Agent`, results cached in a `geocode_cache` table. Nominatim's usage policy forbids heavy use — **production needs a paid geocoder**; note this in the handoff.
- Validation: haversine distance from campus center ≤ `meetupRadiusMeters`, else `BAD_REQUEST`: "That address is outside the 2-mile campus area." Unresolvable address → `BAD_REQUEST` "We couldn't find that address."
- **Safety (non-negotiable):** custom addresses are opt-in per meetup and never appear on a public listing or profile — only inside an agreed reservation visible to the two participants. The picker shows campus spots first, and choosing a custom address shows a short, non-preachy line: *"Public places are safer for meeting someone new. Only share an address you're comfortable with."* Never auto-suggest the user's own address, and never store an address on a user record.

## 3. Payments — Stripe Connect, immediate payout, test mode only

**Founder decisions on record (2026-09-15):** money is paid out to the seller **immediately**, not held until handoff. There is **no Stripe account yet**, so this ships switched off.

### Mode switch

`PAYMENTS_MODE` env: `simulated` (default) | `test` | `live`. If `STRIPE_SECRET_KEY` is absent the server **forces `simulated`** regardless of the variable, and every payment surface says so. The UI label is derived from the server's reported mode — never hard-coded, never optimistic. `live` additionally requires `STRIPE_LIVE_ACK=1` so it cannot be reached by setting one variable by accident.

### Seller onboarding

**Stripe Connect Express.** `stripe_accounts`: userId (unique), stripeAccountId, chargesEnabled, payoutsEnabled, detailsSubmitted, updatedAt.
- `payment.onboardSeller` → creates/reuses the Express account, returns an onboarding link.
- `payment.sellerStatus` → the flags above, refreshed from Stripe.
- In `test`/`live`, a seller with `payoutsEnabled = false` may still list, but the listing shows "Payouts not set up" to the seller only, and winning a bid prompts onboarding before the buyer is charged. In `simulated` the whole check is bypassed and labelled.

### Buyer payment

Because payout is immediate, there is no card-on-file at bid time (that would add SCA and stored-credential complexity for no benefit under this model). Instead:

1. Auction settles (or buyout) → reservation created, `payments` row `requires_payment`, and the **winner has 24 hours to pay**.
2. `payment.createIntent { reservationId }` → a **destination charge**: `amount` = winning price, `application_fee_amount` = `PLATFORM_FEE_PERCENT` (default 10), `transfer_data.destination` = the seller's connected account. Stripe splits it and pays the seller out on their normal schedule.
3. Webhook `payment_intent.succeeded` → payment `paid`; the meetup flow proceeds.
4. Unpaid after 24h → reservation `cancelled` (`cancelReason: 'payment_timeout'`), listing back to `active`/`expired` so the seller can relist.
5. `POST /api/stripe/webhook` verifies the Stripe signature and is the **only** thing permitted to move a payment to a terminal state. Never the client. Handle at minimum: `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `charge.refunded`. Idempotent on Stripe event id (store processed ids).

`payments`: id, reservationId (unique), buyerId, sellerId, amountCents, feeCents, stripePaymentIntentId, stripeChargeId?, status (`requires_payment` | `paid` | `failed` | `refunded`), paidAt?, createdAt, updatedAt.

### Refunds

`payment.refund { reservationId, reason }` — seller or moderator only, full refund via Stripe. There is no automatic refund path, because the money has already left for the seller.

### Risks this model carries — state them in the handoff, do not soften them

- **The buyer pays before they receive the item.** With immediate payout the app cannot claw the money back automatically; a refund depends on the seller agreeing or a moderator intervening. The buyer's real recourse is a card chargeback.
- **Chargeback liability sits with the platform** on destination charges by default. A disputed sale can leave the platform out of pocket after the seller has been paid.
- The UI must therefore **never** say "protected", "guaranteed", "safe", or "escrow". Permitted framing: "You pay now; the seller is paid right away. Arrange the handoff in the app."
- A short hold (pay at settlement, release at handoff) removes most of this. Revisit before real money.

### Before `live` — none of this is code, and none of it is done

Stripe marketplace/Connect terms, seller KYC (Connect handles the mechanics, not the decision), a written refund and dispute policy, 1099-K reporting thresholds, sales-tax posture, a support contact, and the items in `docs/LEGAL-TODO.md`.
