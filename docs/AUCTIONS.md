# Auctions, custom meetup locations, payments — specification

> **STATUS 2026-10-20 — §1 (auctions) is RETIRED. §2 and §3 still apply.**
> - **§1 is historical.** Dibbs no longer runs auctions: new auctions, bids and buy-outs are refused, and buyers book at the asking price or send an offer instead. See `docs/CONTRACT.md` sections "Auctions retired", "Offers" and "Booking". Do not build to §1.
> - Nothing was deleted: old `bids` rows and listings that were already auctions remain, and those listings still settle at their original end time (at most 24h after the change shipped), after which the legacy path is dead.
> - **§2 (custom meetup addresses)** still applies unchanged to `reservation.request`/`counter`.
> - **§3 (payments)** still applies. The payment timeout only affects legacy auction reservations (the ones created by auction settlement); meetups created by `reservation.book` carry no auction payment deadline.

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

- **Auction with bids** → `status = 'reserved'`; a `reservations` row is created for (listing, highest bidder) with `status: 'requested'`, `priceCents` = winning amount, `proposedById` = the seller. Both parties then use the existing meetup flow to agree where and when.

  > **Implemented deviation (see §2).** The original wording was "no spot or time yet". `reservations` cannot express that: §2 adds a check constraint requiring exactly one of `spotId` or the custom-address trio, and `startsAt` is `NOT NULL`. Settlement therefore *opens* the meetup flow with a seller-side proposal — the listing's first pickup spot and its next availability window (or 24h out if it has none) — which the winner accepts or counters exactly as with a fixed-price request. Same state machine, same screens, and the winner sees a concrete proposal instead of an empty card. If the listing somehow has no pickup spot, the listing is still marked `reserved` and no reservation is created.

- **Buyout** takes the same path immediately rather than waiting for the lazy pass.
- **Auction with no bids** → `status = 'expired'`. Seller may relist.
- **Fixed-price listing** → unchanged behaviour.
- The existing "one accepted reservation per listing" partial unique index still guarantees a single hold.

### Reposting

`listing.relist { id, isSellToday, saleType?, startPriceCents?, buyoutPriceCents? }` on an `expired`/`removed` listing returns it to `active` and, for an auction, sets `expiresAt = now + 24h` and **clears previous bids** — a new auction is a new auction. A `sold` listing cannot be relisted.

**State plainly in the sell form:** an auction with a single bid sells at the start price. The start price is the seller's floor.

### Implementation notes (as built)

- `listings.priceCents` mirrors `startPriceCents` for an auction, so every existing price filter, sort and card keeps working with no special-casing. `currentPriceCents` and `bidCount` are derived on read and returned on `ListingCard`/`ListingDetail`.
- An auction never sets `isSellToday`; its 24h clock *is* `expiresAt`.
- Rule 6 also blocks `listing.remove` on an auction that already has bids (`CONFLICT`), not just price edits — removing it would be the same broken promise to bidders.
- `bid.place` rejects an amount at or above `buyoutPriceCents` with `BAD_REQUEST` pointing at Buy it now, so the buyout path is the only way to reach that price.
- Seller-bidding and blocked-party bidding return `FORBIDDEN`; sale-type and amount problems return `BAD_REQUEST`; auction-state problems (`closed`, `ended`, buyout already passed) return `CONFLICT`.

## 2. Meetup locations

Curated campus spots stay and are **recommended first**. In addition, either party may propose a **custom address**.

`campuses` gains `centerLat`, `centerLng`, `meetupRadiusMeters` (default **3219** = 2 miles). U of A center: `32.2319, -110.9501` — `[FOUNDER TO CONFIRM]`, approximate.

`reservations` gains `customAddress` text?, `customLat` double?, `customLng` double?. Exactly one of `spotId` or the custom trio is set — enforce with a DB check constraint.

- Geocoding: `POST`-free lookup via OpenStreetMap **Nominatim** from the backend, with a descriptive `User-Agent`, results cached in a `geocode_cache` table. Nominatim's usage policy forbids heavy use — **production needs a paid geocoder**; note this in the handoff.
- Validation: haversine distance from campus center ≤ `meetupRadiusMeters`, else `BAD_REQUEST`: "That address is outside the 2-mile campus area." Unresolvable address → `BAD_REQUEST` "We couldn't find that address."
- **Safety (non-negotiable):** custom addresses are opt-in per meetup and never appear on a public listing or profile — only inside an agreed reservation visible to the two participants. The picker shows campus spots first, and choosing a custom address shows a short, non-preachy line: *"Public places are safer for meeting someone new. Only share an address you're comfortable with."* Never auto-suggest the user's own address, and never store an address on a user record.

### Implementation notes (this change)

- `reservations.spotId` became nullable and `reservations.customAddress` / `customLat` / `customLng` were added, with a DB check constraint (`reservations_spot_xor_custom`) enforcing exactly one of `spotId` or the custom trio.
- `campuses.centerLat` / `centerLng` / `meetupRadiusMeters` (default 3219m) were added as **column defaults** (U of A's coordinates — `[FOUNDER TO CONFIRM]`, approximate) rather than a `seed.ts` edit, since `backend/db/seed.ts` is owned by the concurrent auctions change. Existing and new campus rows pick this up automatically.
- **Deviation from the router sketch in `docs/CONTRACT.md`:** added `reservation.checkAddress` (protected mutation, `{ campusId, address } → { address, lat, lng, distanceMeters, meetupRadiusMeters }`), not listed there. It geocodes + radius-checks without creating a reservation, so the UI can show a resolved-address confirmation (with distance) before the buyer/seller commits — mirrors the "Check address" step required by this section. `docs/CONTRACT.md` itself was not edited (owned by the concurrent auctions change); flagged here instead.
- `reservation.request` / `reservation.counter` inputs now accept `{ spotId }` **or** `{ customAddress }` (exactly one), replacing the previously-required `spotId`. Existing spot-only callers are unaffected.
- Geocoding lives in `backend/geocode.ts` (Nominatim + `geocode_cache` read-through cache + `GEOCODER=stub` offline fixtures for tests) — see the file header for the production caveat (Nominatim's usage policy forbids heavy/commercial use; a paid geocoder is needed before real traffic, also noted in `docs/HANDOFF.md`).

## 3. Payments — Stripe Connect **direct charges**, configurable payout delay, test mode only

**Founder decisions on record (2026-09-15):** money is paid out to the seller **immediately**, not held until handoff. There is **no Stripe account yet**, so this ships switched off.

**Founder decision, later the same day — the charge model changed.** Payments were originally built as **destination charges** (platform = merchant of record, platform pays Stripe's processing fee, platform carries dispute liability). They are now **direct charges**:

- the PaymentIntent is created **on the seller's connected Express account** (`Stripe-Account` header / `{ stripeAccount }` in the Node SDK);
- the **seller is the merchant of record**;
- the **seller pays Stripe's processing fee** out of the sale;
- a **dispute debits the seller's Stripe balance**, not the platform's;
- the platform's 10% is collected purely as `application_fee_amount` — there is no `transfer_data.destination` and no `on_behalf_of`;
- refunds and any retrieval of these objects **must** be issued on the connected account. A direct charge does not exist on the platform account and cannot be refunded from it;
- webhooks for these charges are delivered to the same platform endpoint with **`event.account`** set to the connected account.

**This shifts risk from the platform onto the seller, and it does not make the buyer any safer.** The buyer still pays before receiving the item and still has no protection from this app. What changed is who is out of pocket when a sale goes wrong first.

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
2. `payment.createIntent { reservationId }` → a **direct charge on the seller's connected account**: `amount` = winning price, `application_fee_amount` = `PLATFORM_FEE_PERCENT` (default 10). Stripe sweeps the application fee to the platform, deducts its own processing fee from the seller, and pays the seller out on the schedule set by `PAYOUT_DELAY_DAYS`.
3. Webhook `payment_intent.succeeded` → payment `paid`; the meetup flow proceeds.
4. Unpaid after 24h → reservation `cancelled` (`cancelReason: 'payment_timeout'`), listing back to `active`/`expired` so the seller can relist.
5. `POST /api/stripe/webhook` verifies the Stripe signature and is the **only** thing permitted to move a payment to a terminal state. Never the client. Handle at minimum: `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `charge.refunded`. Idempotent on Stripe event id (store processed ids).

`payments`: id, reservationId (unique), buyerId, sellerId, amountCents, feeCents, stripePaymentIntentId, stripeChargeId?, status (`requires_payment` | `paid` | `failed` | `refunded`), paidAt?, createdAt, updatedAt.

### Refunds

`payment.refund { reservationId, reason }` — seller or moderator only, full refund via Stripe, **issued on the seller's connected account** with `refund_application_fee: true` (so the platform gives its cut back too). No `reverse_transfer`: there is no transfer under a direct charge. There is no automatic refund path, because the money has already left for the seller, and the refund comes out of the seller's own Stripe balance — which can put that balance negative.

### Payout delay — `PAYOUT_DELAY_DAYS`

`PAYOUT_DELAY_DAYS` (env, whole number **0–30**, **default 0**) is applied as `settings.payouts.schedule.delay_days` when a seller's Express account is created. `0` is sent to Stripe as its `'minimum'`, because Stripe enforces a country floor (2 days in the US) and rejects a lower literal — so `0` means "as fast as Stripe permits", not "instantly".

**What 0 costs you.** At 0 the seller is paid out before a dispute realistically arrives. Under direct charges a dispute is debited from the *seller's* balance; with the money already gone there is nothing to debit, Stripe takes that account negative, and if the seller never makes it good Stripe's negative-balance rules push the residual loss back onto the **platform**. A delay leaves a buffer in the seller's balance for exactly that case, at the cost of sellers waiting.

**`7` is the recommended pilot value.** `0` is the repo default only because it matches the founder's original "paid immediately" decision.

### Fee math — who actually nets what

- **Buyer:** pays the sale price exactly. Nothing is added.
- **Platform:** takes exactly `application_fee_amount` = 10% of the sale. Exact, because we set it.
- **Seller:** receives the sale price minus the platform fee minus **Stripe's processing fee**. Stripe's fee is *not knowable before settlement* — it depends on the card (international, Amex, card-present), on currency conversion, and on the seller's own Stripe pricing.

`payment.quote`, `payment.createIntent` and `payment.byReservation` therefore return two different kinds of number, and the UI must keep them apart:

| field | exact? | meaning |
|---|---|---|
| `amountCents` | exact | what the buyer pays |
| `feeCents` / `platformFeeCents` | exact | the platform's `application_fee_amount` |
| `sellerBeforeStripeFeeCents` | exact | sale minus platform fee, **before** Stripe's fee |
| `stripeFeeEstimateCents` | **estimate** | 2.9% + 30¢, the published US online-card rate |
| `sellerNetEstimateCents` | **estimate** | what the seller can expect to keep |
| `estimateNote` | — | the wording that must accompany any estimated figure |

`quote.sellerNetCents` is retained as an alias of `sellerBeforeStripeFeeCents` so the existing request-sheet component and `scripts/e2e.ts` keep working; it is **not** the seller's take-home and must not be labelled as such. Never state an exact seller net anywhere. Never present the 2.9% + 30¢ constant without the word "estimate".

### Risks this model carries — state them in the handoff, do not soften them

- **The buyer pays before they receive the item.** With immediate payout the app cannot claw the money back automatically; a refund depends on the seller agreeing or a moderator intervening. The buyer's real recourse is a card chargeback.
- **Chargeback liability sits with the *seller*** now that these are direct charges: a dispute is debited from the seller's Stripe balance. That is not a clean escape for the platform — with `PAYOUT_DELAY_DAYS=0` the seller's balance is usually empty, Stripe takes them negative, and an unrecovered negative balance comes back to the platform. Raise the delay before real money.
- **The seller pays Stripe's processing fee**, so the seller's net is smaller than "price minus 10%" and is not exactly knowable until settlement. Every seller-facing figure is shown as an estimate.
- The UI must therefore **never** say "protected", "guaranteed", "safe", or "escrow". Permitted framing: "You pay now; the seller is paid right away. Arrange the handoff in the app."
- A short hold (pay at settlement, release at handoff) removes most of this. Revisit before real money.

### As built (2026-09-15) — deviations and additions, recorded here per the rule above

Implemented exactly as specified above, with these clarifications:

- **Direct-charge conversion (second pass, 2026-09-15).** `backend/stripe/real.ts` creates and refunds on the connected account via `{ stripeAccount }`; `transfer_data` and `on_behalf_of` are gone. `retrievePaymentIntent` was added to `PaymentGateway` so any future retrieval is forced through the connected account too. `retrieveAccount` is deliberately still a platform-level call — Account objects do live on the platform.
- **Connected-account webhook matching.** `handleGatewayEvent` now requires `event.account` on `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded`, resolves it to a local user through `stripe_accounts`, and matches on `payments.sellerId` as well as the intent id. An event with no account, or an account we do not know, is recorded for idempotency and **not applied**. `account.updated` prefers `event.account` and rejects a mismatch against the object id. No schema change was needed or made: the seller link already existed via `payments.sellerId → stripe_accounts.userId`.
- **Idempotency is unchanged** — still `stripe_events` keyed by event id alone, which is unique across a platform and its connected accounts.
- **Signature verification is unchanged** and still mandatory; connected-account events arrive at the same endpoint under the same signing secret.
- **`PAYOUT_DELAY_DAYS`** added to `backend/env.ts` (integer 0–30, default 0, throws on anything else) and surfaced on `payment.config` / `payment.sellerStatus` so the Payouts screen can tell the seller the truth about when they are paid.
- **`FakeGateway` models direct charges**: an intent belongs to one connected account, refunding or retrieving it from any other account fails, and simulated webhook events carry `account`. So the simulated path exercises the real matching logic.
- **Script directory bug fixed.** `scripts/payments-check.ts` set `PGLITE_DIR` *after* its static imports, which are hoisted — so it had been running against `backend/data/pg`, the demo database, rather than its own throwaway directory. Its backend imports are now dynamic (`await import`) so the env is set first. Anyone who ran the old script has payments-check fixtures in their demo database; `npm run db:reset`/`db:seed` clears them.

- **Gateway interface.** All Stripe calls go through `PaymentGateway`
  (`backend/stripe/gateway.ts`) with two implementations: `StripeGateway`
  (real, `stripe` npm v22) and `FakeGateway` (deterministic, in-memory). With
  no key present the resolved mode is `simulated` and the fake is used. **No
  line of the real implementation has ever run against Stripe's API** — there
  is no account and no key. It is written to the documented shapes and is
  unverified until a key exists.
- **Extra table.** `stripe_events` (event id primary key) for webhook
  idempotency, as required by rule 5.
- **Extra column.** `payments.mode` records which mode produced the row, so a
  simulated record can never be mistaken for a real one later.
- **Extra procedures.** `payment.config` (server-resolved mode + banner text,
  so no UI label is hard-coded) and `payment.mine` (the caller's own payments).
  `payment.quote` is unchanged.
- **Timeout and payment state.** On the 24-hour timeout the reservation is
  cancelled with `cancelReason: 'payment_timeout'` via the reservation
  router's own public `cancel` mutation, and the payment row is left at
  `requires_payment` — rule 5 says only a verified webhook may set a terminal
  payment state, and a timeout is not a Stripe outcome. Read paths expose a
  derived `timedOut` flag. The sweep is lazy, mirroring `applyExpiry`.
- **Local test hook.** `POST /api/stripe/simulated-test-event`, available only
  when `DEV_LOGIN=1` **and** the resolved mode is `simulated`. It synthesizes
  the event JSON and runs it through the same raw-body → signature-verify →
  handler path a real webhook takes. It exists because otherwise a simulated
  payment could never reach `paid` and the flow could not be demonstrated.
- **Proof.** `npx tsx scripts/payments-check.ts` — 39 assertions against the
  fake gateway, including the exact cents of a $38.00 sale at 10%
  (3800 charged / 380 application fee / 3420 before Stripe's fee / ~3280
  estimated seller net), the intent being created ON the connected account with
  no transfer_data or on_behalf_of, refunds being issued on the connected
  account and refused from any other, connected-account webhook matching
  (missing account, unknown account, correct account applied exactly once),
  `PAYOUT_DELAY_DAYS` validation, idempotency, FORBIDDEN for non-participants,
  the timeout path, and refund. **None of it touches Stripe** — there is still
  no account and no key, so the real gateway remains entirely unexecuted.

### Before `live` — none of this is code, and none of it is done

Stripe marketplace/Connect terms, seller KYC (Connect handles the mechanics, not the decision), a written refund and dispute policy, 1099-K reporting thresholds, sales-tax posture, a support contact, and the items in `docs/LEGAL-TODO.md`.
