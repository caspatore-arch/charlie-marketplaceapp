# Handoff: what is simulated, and how payments would be turned on

Trimmed 2026-10-26. The original build-1 handoff (run instructions, acceptance
test table, Rork connection steps, App Store pass notes) was removed as completed
or superseded. What is kept here is the part other documents and the in-app
Terms/Privacy draft still point at. **Section numbers (3, 3a, 7) are unchanged
on purpose**, because `docs/APP-STORE.md`, `docs/LEGAL-TODO.md` and
`constants/legal.ts` cite them.

Where to look instead:

- Run it locally and commands: `CLAUDE.md`, `README.md`.
- Deploy and operate (Render, Neon, Netlify, R2, Resend): `docs/DEPLOY.md`, `docs/DEPLOY-WEB.md`.
- Current priorities and production status: `docs/PROJECT-DIRECTIVES.md`.
- API and data behavior: `docs/CONTRACT.md`. Stack: `docs/ARCHITECTURE.md`.
- Acceptance criteria from the original brief: `docs/BRIEF.md`; run `npm run test:e2e`
  and `npm run test:workstreams` for current results rather than trusting old tables.

> Auctions were retired in favor of an asking price plus offers, meetups are booked
> into exact slots (`reservation.book`), and the tab bar is Browse, Sell, Community,
> Profile. Where any older text says "auction", "Inbox tab" or "request then accept",
> read `docs/CONTRACT.md`.

## 3. Simulated or unfinished — read before demoing

Updated 2026-10-26 against the verified production facts in
`docs/PROJECT-DIRECTIVES.md`. Never imply payment protection.

| Area | State |
|---|---|
| Payments | **Built, and switched off.** Stripe Connect Express with **direct charges** is implemented end to end (seller onboarding, buyer payment intent, webhook, refund, the 24-hour unpaid timeout), but there is **no Stripe account and no API key**, so the server forces `PAYMENTS_MODE=simulated` and **it cannot charge anyone**. Payment screens say "Simulated — no money moves." The product direction for now is no platform fee and no card step: the buyer pays the seller in person. The seller's connected account would be the merchant of record, so a dispute is drawn from the **seller's** balance; the platform would take 10% as `application_fee_amount` and the seller would bear Stripe's processing fee (so every seller-facing figure is an **estimate**). `PAYOUT_DELAY_DAYS` defaults to **0**; at 0 a dispute usually finds an empty seller balance and Stripe's negative-balance rules push the loss back to the platform, so **set it to 7 for any pilot with real money**. Proof against the built-in fake gateway: `npm run test:payments`. See "Turning payments on" below. |
| Email sign-in codes | **Live as of 2026-10-26** through Resend (domain `trydibbs.com`, `EMAIL_MODE=live`; `/api/health` reports email live). Free plan: 100/day, 3,000/month. Codes are real and expire in 10 minutes. Badge copy says "Campus email verified", never identity. Any email can sign in; a campus email unlocks trading. Local development still prints simulated codes to the backend console. |
| SMS | **Simulated.** Phone codes and transactional texts are built but have never been sent through Twilio; no account, no carrier registration. See `docs/DEPLOY.md` section 8. |
| Campus + meetup spots | University of Arizona with demo spots (approximate coordinates). Labeled "verify hours and permission before pilot". |
| Custom meetup addresses | Either party can propose an address within 2 miles of the campus center (approximate coordinates, `[FOUNDER TO CONFIRM]`) instead of a campus spot. Geocoded via OpenStreetMap **Nominatim**, a free public service whose usage policy forbids heavy/commercial use: fine for pilot volume, but **production needs a paid geocoder** before real traffic. See `backend/geocode.ts`. |
| Map | Placeholder block + "Directions" link (opens Maps). No map SDK (`docs/backlog/MAPS.md`). |
| Reminders / push | Push not implemented. Screens poll every 5-10 s while open. Meetup reminders are texts, which are simulated (see SMS). |
| Read receipts | None; unread count = messages from the other person. |
| Listing expiry | A listing shows in Browse for 24 hours, then moves to the Archive; community posts do not expire. Applied lazily when data is read, not by a background job. |
| Demo photos | Generated SVG placeholders with a "DEMO" mark. Real photos come from the picker. |
| Photo storage | Cloudflare R2 bucket `dibbs-photos` exists, but on 2026-10-25 `S3_BUCKET` was not yet set on the API host. Do **not** claim photos persist until `docs/DEPLOY.md` section 4 is verified. |
| Time zone | Sell form uses the device's time zone (fine on campus). |
| Hosted database | Neon (project "Dibbs Campus Marketplace", branch `production`, Free plan, 6-hour restore window). Local development still uses on-disk PGlite when `DATABASE_URL` is empty. |
| Moderation | Reports land in the `reports` table; `MODERATOR_USER_IDS` grants access to a Moderation screen (open/reviewed reports, dismiss, add a note, remove a listing, which also cancels its accepted reservation). `/admin` is enabled on the API (`ADMIN_PASSWORD` set). As of 2026-10-31, every new report (from Browse or Community) sends a best-effort email to each `MODERATOR_USER_IDS` account that has a stored email (`backend/email/moderation.ts`, `notifyModeratorsOfReport`), linking to `/moderation`; a moderator with no email on file, or no `MODERATOR_USER_IDS` set, gets nothing and the report still saves either way. Untested: real delivery (`npm run test:moderation-alert` only exercises the simulated provider), since that needs live `EMAIL_MODE` and a real moderator inbox. |
| Account closure | **Built, and it is anonymization, not erasure.** Closing an account removes your listings, cancels pending requests, signs you out everywhere and renames you "Deleted user"; message history, reports and completed sales are kept. It refuses while you have an accepted meetup. Hard erasure, data export and a retention policy are **not** built. |
| Terms + Privacy | **Placeholder drafts only**, shown in-app (Settings, Legal) with a visible "DRAFT — not reviewed by a lawyer" banner. Every unknown fact is marked `[FOUNDER TO CONFIRM]`. See `docs/LEGAL-TODO.md` for the decision list and the items that block an App Store submission. |
| Age eligibility | A self-declaration checkbox on **new** sign-ups only ("I am at least 18"), plus agreement to Terms/Privacy. The threshold lives in `constants/legal.ts` and is **the founder's decision**. A declaration, not verification, and the UI says so. |

## 3a. Turning payments on — your steps, not the code's

Nothing below can be done for you; it needs your name, your bank details and your legal decisions.

1. **Create a Stripe account** at stripe.com and complete the business details.
2. **Enable Connect** in the Stripe dashboard and choose **Express** accounts. Accept Stripe's Connect / marketplace terms.
3. **Copy your test secret key** (`sk_test_…`) into the API host's environment as `STRIPE_SECRET_KEY`, and set `PAYMENTS_MODE=test`. Never put a key in `.env.example` or in a commit (the repository is public).
4. **Add the webhook endpoint** in the Stripe dashboard: `POST https://api.trydibbs.com/api/stripe/webhook`, subscribed to `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `charge.refunded`. Put the signing secret (`whsec_…`) in `STRIPE_WEBHOOK_SECRET`. The webhook is the only thing allowed to mark a payment paid, so payments sit unpaid without it.
5. Set `PUBLIC_APP_URL` to the address Stripe should send sellers back to after onboarding.
6. **Test with Stripe's test cards** before going anywhere near `live`. Going live additionally requires `PAYMENTS_MODE=live` **and** `STRIPE_LIVE_ACK=1`: two switches on purpose.

### Before real money — read this, it is not softened

- **The buyer pays before they receive the item.** Payout is immediate by default, so the app cannot claw the money back automatically. A refund happens only if the seller agrees or a moderator intervenes. The buyer's real recourse is a card chargeback.
- **The UI must never say "protected", "guaranteed", "safe" or "escrow".** The permitted framing is: "You pay now; the seller is paid right away. Arrange the handoff in the app."
- **A short hold (pay at settlement, release at handoff) removes most of this.** Worth revisiting before real money; it is a different Stripe flow (separate charge and transfer), not a config change.
- Also outstanding and none of it code: Stripe marketplace/Connect terms, seller KYC decisions, a written refund and dispute policy, 1099-K reporting thresholds, sales-tax posture, a support contact, and everything in `docs/LEGAL-TODO.md`.
- The real Stripe code path has **never been executed**: there has been no key to execute it with. Expect to debug it the first time a test key is present.

## 7. Payments: direct charges (current model)

Direct charges replaced the original destination charges on 2026-09-15; this is the
current model. The full specification is `docs/AUCTIONS.md` section 3 (its auction
section is retired; the payments section still applies).

| What | Where it stands |
|---|---|
| Charge model | **Direct charges.** The card payment is taken on the *seller's* Stripe account, not the platform's. |
| Merchant of record | The seller. |
| Who pays Stripe's processing fee (~2.9% + 30¢) | The seller, out of the sale. |
| Who a dispute is charged to | The seller's Stripe balance first. |
| How the platform earns | Purely `application_fee_amount`, exactly 10% of the sale (currently set to no fee while payments are off). |
| Refunds | Issued on the seller's connected account and come out of the seller's balance. Seller or moderator only, confirmed by webhook only. |
| `PAYOUT_DELAY_DAYS` | 0-30, **default 0**. `0` = pay the seller as fast as Stripe allows. **`7` is recommended** for a real-money pilot. |
| Webhooks | One endpoint, one signing secret, verification mandatory. Connected-account events carry `event.account`; an event without a recognised account is never applied. |
| Still true | No Stripe account, no key, nothing executed against Stripe. Mode is forced to `simulated`. |

**The part not to gloss over.** Moving dispute liability to the seller does not make the platform safe, and it does nothing for the buyer. With `PAYOUT_DELAY_DAYS=0` the seller has normally been paid out before a dispute lands, so there is no balance to debit; Stripe takes that account negative and, if the seller never makes it good, Stripe's negative-balance rules bring the loss back to the platform. Setting `PAYOUT_DELAY_DAYS=7` keeps a buffer, at the cost of sellers waiting a week (the Payouts screen says so).

**Seller-facing numbers are estimates.** Because the seller pays Stripe's fee, "price minus 10%" is not what they keep, and Stripe's exact fee is unknown until settlement. Show the platform fee exactly, the card fee as an estimate, and take-home as an estimate with that word attached. Never state an exact seller net.
