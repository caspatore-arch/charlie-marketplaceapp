# Handoff — Campus marketplace MVP (build 1, 2026‑09‑14)

The app is named **Dibbs** (decided; no longer a placeholder). This is a locally runnable prototype: a real iPhone app (Expo) talking to a real backend (Hono + tRPC + Postgres‑compatible database) with clearly labeled demo data. It is **not** an App Store release and moves **no money**.

> **Update 2026-10-20.** This document records build 1 and later passes as they were verified. Since then: auctions were retired and replaced by asking prices + offers; meetups are booked into exact 30-minute slots (`reservation.book`); the tab bar is Browse · Sell · Community · Profile (messages and meetups live at the "Meetups & messages" screen, `app/inbox.tsx`); sign-in is phone-first (campus email still works); and transactional SMS exists (simulated by default). Where this document still says "auction", "Inbox tab" or "request then accept", read `docs/CONTRACT.md` instead. Run `npm run test:workstreams` for the new server behaviour.

## 1. Run it on your iPhone (Expo Go)

Prerequisites: this Mac, your iPhone on the **same Wi‑Fi**, and the free **Expo Go** app from the App Store.

```bash
npm install
```
```bash
npm run db:seed
```
```bash
npm run env:lan
```
```bash
npm run backend
```
Leave that terminal open (it prints `[SIMULATED EMAIL] code for …` lines when someone signs in with email). In a second terminal:

```bash
npm start
```
Scan the QR code with the iPhone camera → opens in Expo Go.

- **Fastest way in:** Profile tab → "Switch test user (dev only)" → Maya / Jordan / Sam. Use two phones (or one phone + the web preview `npm run web`) to play buyer and seller.
- **Email sign-in path:** enter `anything@arizona.edu` → the 6‑digit code is printed in the backend terminal → type it in.
- If the phone shows "network request failed", the app now shows a banner naming the exact address it is trying. Run `npm run env:lan` again (your Mac's Wi‑Fi IP changed), restart `npm start`, then tap **Retry**.
- **Never run `npm run db:seed` or `db:reset` while `npm run backend` is running.** The local database allows one writer at a time, and doing both at once makes the running server throw confusing 500 errors. Both commands now refuse with a clear message instead, so this is a speed bump rather than a trap — stop the backend, reseed, start it again.

Scripted proof (no phone needed):
```bash
npm run test:e2e
```
Prints PASS/FAIL for acceptance criteria 1–8.

## 2. What was actually tested

| Acceptance criterion | Backend script (`npm run test:e2e`) | Clicked through in the app (web preview at iPhone width) |
|---|---|---|
| 1. Browse sample listings signed‑out | PASS | ✅ feed, filters, Demo badges, "Today" pills |
| 2. Seller creates/edits a persisted listing with photos + availability | PASS | ✅ published a listing with a real photo upload, edited it, removed it (web picker); validation, size field, availability window sheet, Sell‑today toggle exercised |
| 3. Second user views, messages, requests spot + time | PASS (+ seller can now start a chat) | ✅ chat both directions with polling; reservation strip in chat; request flow incl. fee label "Simulated — no money moves" |
| 4. Seller accepts; both see the same meetup card | PASS | ✅ Maya accepted; Jordan and Maya saw identical spot/time/price |
| 5. Second buyer cannot reserve the accepted item | PASS (incl. race: pending request auto‑declined) | ✅ Sam's pending request auto‑declined; Sam sees "Reserved" and cannot request |
| 6. Cancel / reschedule stay consistent | PASS | ✅ counter‑proposal → accept (both show new time); cancel → listing back to active; decline → buyer sees declined state |
| 7. Handoff → sold, no payment event | PASS (asserts no payment table exists) | ✅ buyer code 1771 → seller entered → buyer confirmed → "Handed off — item marked sold" |
| 8. Report / block / access control | PASS (FORBIDDEN / UNAUTHORIZED / moderator checks) | ✅ report + block from profile and item page; blocked user's listings vanish from feed; unblock restores; saved items; signed‑out gating; email code sign‑in |
| 9. Works at iPhone sizes incl. keyboard/photo picker | — | Layout verified at 390×844 in web preview; **keyboard + native photo picker still need a real‑device pass** |
| 10. This document | — | — |
| A. Auctions (opt-in per listing) — **RETIRED 2026-10-20, replaced by offers; row kept as history of what was tested** | PASS (`test:e2e` 1/2/5/7/8; simultaneous equal bids → exactly one winner; double settlement → one reservation) | ✅ signed-out "Place bid" correctly routes to sign-in; bid sheet copy "a bid is a commitment to buy"; bid placed at $25 → panel updated live to "Current bid $25 · 1 bid" with the bidder in Recent bids |
| B. Custom meetup addresses | PASS (`npm run test:geo` 5/5, `GEOCODER=stub`) | ✅ verified against **live** Nominatim at 390×844: campus spots listed first, safety line shown before the field; "1 E Congress St, Tucson, AZ" resolved and reported "1.4 mi from campus center · within range"; "100 N Central Ave, Phoenix, AZ" rejected with "That address is outside the 2-mile campus area." |
| C. Payments (Stripe direct charges) | PASS (`npx tsx scripts/payments-check.ts` 39/39, fake gateway only) | ❌ **Not clicked through.** No Stripe key exists; `backend/stripe/real.ts` has never been executed. |

Added after the first build and verified the same way: **search** on Browse (title/brand/description, composes with filters), **Settings** (edit name/bio, blocked users, honest prototype disclosures, sign out), **Close account**, a **moderation** screen for reports, and a **connection banner** that names the exact server address when the phone can't reach the Mac — with Retry restoring the feed, not just the banner.

Bugs found and fixed during QA: confirm dialogs silent on web (now `utils/confirm.ts`), web photo upload sending the wrong body, and a stale‑state bug that could erase a just‑added photo (would have affected iPhone too).

Also verified: `npm run typecheck` clean; `npx expo export --platform ios` bundles (≈3.7k modules); seed is idempotent; data survives backend restart (PGlite on disk).

**Not tested:** anything on a physical iPhone (this Mac has no Xcode/simulator). Expect small layout/keyboard fixes on first device run — that's normal.

## 3. Simulated or unfinished — read before demoing

| Area | State |
|---|---|
| Payments | **Built, and switched off.** Stripe Connect Express with **direct charges** is implemented end to end — seller onboarding, buyer payment intent, webhook, refund, the 24-hour unpaid timeout. The seller's connected account is the merchant of record, so a dispute is drawn from the **seller's** balance, not the platform's; the platform takes 10% as `application_fee_amount` and the seller bears Stripe's processing fee (so every seller-facing figure is an **estimate** — the exact fee is unknown until settlement). `PAYOUT_DELAY_DAYS` defaults to **0** (pay out as fast as Stripe allows). At 0 a dispute usually finds an empty seller balance and Stripe's negative-balance rules push the loss back to the platform — **set it to 7 for the pilot**. But there is **no Stripe account and no API key**, so the server forces `PAYMENTS_MODE=simulated` and **it cannot charge anyone**. Every payment screen shows "Simulated — no money moves." Proof against the built-in fake gateway: `npx tsx scripts/payments-check.ts`. See "Turning payments on" below. |
| Email verification | **Simulated delivery.** Codes are real and expire in 10 min, but they print to the backend console instead of being emailed. Badge copy says "Campus email verified", never identity. |
| Campus + meetup spots | University of Arizona with 4 **demo** spots (approximate coordinates). All labeled "verify hours and permission before pilot". |
| Custom meetup addresses | Either party can propose an address within 2 miles of the campus center (approximate coordinates, `[FOUNDER TO CONFIRM]`) instead of a campus spot. Geocoded via OpenStreetMap **Nominatim**, a free public service whose usage policy forbids heavy/commercial use — fine for pilot volume, but **production needs a paid geocoder** (e.g. Google, Mapbox, Radar) before real traffic. See `backend/geocode.ts`. |
| Map | Placeholder block + "Directions" link (opens Maps). No map SDK. |
| Reminders / push | Not implemented. Screens poll every 5–10 s while open instead. |
| Read receipts | None; unread count = messages from the other person. |
| Listing expiry | Applied lazily when data is read, not by a background job. |
| Photo reorder | Skipped; first picked photo is the cover. |
| Demo photos | Generated SVG placeholders with a "DEMO" mark. Real photos come from the picker. |
| Time zone | Sell form uses the device's time zone (fine on campus). |
| Hosted database | `DATABASE_URL` is now a one‑variable switch: set it (e.g. to a Neon connection string) and the backend uses `drizzle-orm/node-postgres` automatically — no code changes. Run `npm run db:check` after setting it to connect, apply migrations, and print the table count before pointing the app at it. Schema needs no change. |
| Moderation | Built end to end: reports land in the `reports` table, `MODERATOR_USER_IDS` (defaults to Maya's demo id) grants access, and a **Moderation screen** (Profile → Settings area, visible only to a moderator) lists open/reviewed reports and can dismiss, add a note, or remove a listing. Removing a listing also cancels its accepted reservation. No email alerts to the moderator yet — they have to look. |
| Account closure | **Built, and it is anonymization — not erasure.** Closing an account removes your listings, cancels pending requests, signs you out everywhere and renames you "Deleted user"; message history, reports and completed sales are kept. It refuses while you have an accepted meetup. Hard erasure, data export and a retention policy are **not** built. |
| Terms + Privacy | **Placeholder drafts only**, shown in-app (Settings → Legal) with a visible "DRAFT — not reviewed by a lawyer" banner. Every unknown fact is marked `[FOUNDER TO CONFIRM]` in the text itself. See **docs/LEGAL-TODO.md** for the decision list and the four items that specifically block an App Store submission. |
| Age eligibility | A self-declaration checkbox on **new** sign-ups only ("I am at least 18"), plus agreement to Terms/Privacy. The threshold lives in one constant (`constants/legal.ts`) and is **your decision** — 13/16/18 have real legal consequences. This is a declaration, not verification, and the UI says so. Existing sign-in and the dev test-user switch are unaffected. |

## 3a. Turning payments on — your steps, not the code's

Nothing below can be done for you; it all needs your name, your bank details and your legal decisions.

1. **Create a Stripe account** at stripe.com and complete the business details.
2. **Enable Connect** in the Stripe dashboard and choose **Express** accounts. Accept Stripe's Connect / marketplace terms.
3. **Copy your test secret key** (`sk_test_…`) into `.env` as `STRIPE_SECRET_KEY`, and set `PAYMENTS_MODE=test`. `.env` is gitignored — never put a key in `.env.example` or in a commit.
4. **Add the webhook endpoint** in the Stripe dashboard: `POST https://<your server>/api/stripe/webhook`, subscribed to `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `charge.refunded`. Copy the signing secret (`whsec_…`) into `.env` as `STRIPE_WEBHOOK_SECRET`. The webhook is the only thing allowed to mark a payment paid, so payments will sit unpaid without it.
5. Set `PUBLIC_APP_URL` to the address Stripe should send sellers back to after onboarding.
6. **Test with Stripe's test cards** before going anywhere near `live`. Going live additionally requires `PAYMENTS_MODE=live` **and** `STRIPE_LIVE_ACK=1` — two switches on purpose.

### Before real money — read this, it is not softened

- **The buyer pays before they receive the item.** Payout is immediate, so the app cannot claw the money back automatically. A refund happens only if the seller agrees or a moderator intervenes. The buyer's real recourse is a card chargeback.
- **Chargeback liability sits with you.** On destination charges the platform is liable by default. A disputed sale can leave you out of pocket *after* the seller has already been paid.
- **The UI must never say "protected", "guaranteed", "safe" or "escrow".** The permitted framing is: "You pay now; the seller is paid right away. Arrange the handoff in the app."
- **A short hold — pay at settlement, release at handoff — removes most of this.** Worth revisiting before real money; it is a different Stripe flow (separate charge and transfer), not a config change.
- Also outstanding and none of it code: Stripe marketplace/Connect terms, seller KYC decisions (Connect handles the mechanics, not who you accept), a written refund and dispute policy, 1099-K reporting thresholds, sales-tax posture, a support contact, and everything in `docs/LEGAL-TODO.md`.
- The real Stripe code path has **never been executed** — there has been no key to execute it with. Expect to debug it the first time a test key is present. That is normal.

## 4. Rork

The repo already matches Rork's generated layout (`app/`, `components/`, `backend/hono.ts`, `backend/trpc/`, `lib/trpc.ts`, `EXPO_PUBLIC_RORK_API_BASE_URL`).

**To connect:** in Rork, create a new project (any blank prompt), open its settings → GitHub → let Rork create the repository. Then push this code into that repo (`git remote add origin <url> && git push -u origin main --force`). Rork syncs two‑way from then on.

**Two cautions:**
1. Rork's hosted backend VMs are ephemeral — the local PGlite folder would be wiped. Before hosting the backend through Rork, set `DATABASE_URL` to a hosted Postgres (Neon is Rork's own recommendation) as described above.
2. Rork prompts can rewrite files. Keep `backend/**` and `docs/CONTRACT.md` out of design prompts — tell Rork explicitly.

**Design‑polish prompts to paste into Rork** (one at a time; review the diff after each):

> Read docs/DESIGN.md and constants/theme.ts. Without changing any file under backend/, lib/, hooks/, or docs/, refine the visual polish of the Browse feed (app/(tabs)/index.tsx and components/browse/*): tighten spacing, make the category filter row feel lighter, and ensure the listing card price/title hierarchy is crisp. Keep the warm off‑white + brick palette, no gradients, keep all "Demo" labels.

> Without touching backend/ or lib/, polish the meetup card screen app/reservation/[id].tsx and components/MeetupCard.tsx so it feels like the signature moment of the app: clearer status header, larger agreed time, and a calmer layout for the handoff code. Keep every piece of copy that mentions "simulated", "prototype", or "Demo".

> Design an app icon and splash screen for a campus secondhand marketplace with a warm off‑white background and brick‑red accent (#C8442B). Simple, no text, no mascot. Update app.json icon/splash paths.

## 5. Where things live

`docs/ARCHITECTURE.md` (stack, folders, env), `docs/CONTRACT.md` (data model, reservation rules, every API call), `docs/DESIGN.md` (tokens, components, copy rules), `docs/BRIEF.md` (acceptance criteria). Backend code: `backend/`. App screens: `app/`. Shared UI: `components/`. Acceptance script: `scripts/e2e.ts`.

## 6. Open founder decisions (unchanged from the brief)

Brand name · final pilot campus · commission rate · payment provider + timing · hosting account · launch eligibility/legal review · production distribution.

## 7. Payments update (2026‑09‑15, second pass): direct charges

Added after the section above; nothing earlier in this document was rewritten. Where this contradicts §3's "chargeback liability sits with you", **this section is the current one.**

| What | Where it now stands |
|---|---|
| Charge model | **Direct charges.** The card payment is taken on the *seller's* Stripe account, not the platform's. Previously destination charges. |
| Merchant of record | The seller. |
| Who pays Stripe's processing fee (~2.9% + 30¢) | The seller, out of the sale. Previously the platform. |
| Who a dispute is charged to | The seller's Stripe balance first. Previously the platform. |
| How the platform earns | Purely `application_fee_amount` — exactly 10% of the sale, swept by Stripe. |
| Refunds | Must be issued on the seller's connected account; they come out of the seller's balance. Seller or moderator only, still confirmed by webhook only. |
| New env var | `PAYOUT_DELAY_DAYS` (0–30, **default 0**). `0` = pay the seller as fast as Stripe allows. **`7` is recommended for the pilot.** |
| Webhooks | Same endpoint, same signing secret, verification unchanged and still mandatory. Connected‑account events carry `event.account`; an event without a recognised account is never applied. |
| Still true | No Stripe account, no key, nothing executed against Stripe. Mode is still forced to `simulated` and every screen still says "Simulated — no money moves." |

**The part not to gloss over.** Moving dispute liability to the seller does not make the platform safe, and it does nothing at all for the buyer. With `PAYOUT_DELAY_DAYS=0` the seller has normally been paid out before a dispute lands, so there is no seller balance to debit; Stripe takes that account negative and, if the seller never makes it good, Stripe's negative‑balance rules bring the loss back to the platform. Setting `PAYOUT_DELAY_DAYS=7` keeps a buffer in the seller's balance for exactly this. It also means sellers wait a week — that is the trade, and sellers should be told plainly (the Payouts screen does say it).

**Seller‑facing numbers are now estimates.** Because the seller pays Stripe's fee, "price minus 10%" is no longer what they keep, and Stripe's exact fee is unknown until settlement. The app shows the platform fee exactly, the card fee as an estimate, and the seller's take‑home as an estimate with that word attached. Do not let any future copy state an exact seller net.

~~**One change still needed that this pass was not allowed to make:** `components/FeeBreakdown.tsx` (the fee panel on the request‑meetup sheet) still labels its bottom row "Seller receives" over a figure that is the price minus the platform fee only — i.e. before Stripe's fee. It should read "Seller receives (before card fee)", or show `sellerNetEstimateCents` with the estimate wording. The data it needs is already on `payment.quote`.~~ **Done in a later pass** (see §10) — this paragraph was left stale after the fix landed; `FeeBreakdown.tsx` has read "Seller receives (estimated)" over `sellerNetEstimateCents`, with `estimateNote` shown underneath, since before 2026‑10‑22.

## 9. Buildable and submittable (2026‑09‑16, third pass): eas.json, app identity, App Store guide

Added after everything above; nothing earlier in this document was rewritten.

| What | Where it now stands |
|---|---|
| `eas.json` | Added at the repo root — `development`, `preview`, `production` build profiles, plus an iOS `submit` block with three placeholders (`appleId`, `ascAppId`, `appleTeamId`) that are **not filled in** — they're the founder's Apple account details and don't exist yet. |
| App identity (name, slug, bundle identifier, scheme, version) | Now centralized in **`app.config.ts`** (new file) instead of scattered — one commented block at the top of that file is the only place to edit any of them. `app.json` still exists and still carries the same placeholder values (some tooling reads it directly), but `app.config.ts` is what actually applies at build time. Verified with `npx expo config --type public` before and after: byte-identical output, so nothing changed behaviorally — see the report from this pass for the full diff command and result. |
| Brand name / bundle identifier | The brand name is **decided: Dibbs** — it is no longer a placeholder, and the repo uses it throughout. The **bundle identifier is still a placeholder** awaiting the founder's confirmation; it is a separate decision. `app.config.ts`'s comment block explains the one-time, permanent nature of the bundle identifier (cannot change after first Apple submission) and points at `docs/APP-STORE.md`. |
| `assets/icon.png` | Verified 1024×1024, RGB, **no alpha channel** — meets Apple's store-icon requirement as-is. Not regenerated. |
| `docs/APP-STORE.md` | New — a founder-readable guide to the Apple Developer Program ($99/yr), what `eas build`/`eas submit` do, TestFlight, a drafted (placeholder) App Store listing, an App Privacy "nutrition label" table derived from `backend/db/schema.ts`, and the specific App Review guidelines this app touches (5.1.1(v) account deletion, 1.2 report/block, no IAP needed, safety-feature scrutiny). |
| Verification run this pass | `npm run typecheck` — clean. `npm run test:e2e` — 8/8. `npx expo-doctor` — 18/21 checks pass; the 3 failures (an `app.json` schema warning for `newArchEnabled`, a missing `react-native-worklets` peer dependency, and two packages slightly behind the SDK's expected patch version) all **pre-exist this pass** and were not introduced by it — no packages were installed or changed, per this pass's constraints. |
| Not done, not claimed | No `eas build`, `eas init`, or `eas submit` was run — this machine has no Apple Developer account, no Xcode, no registered EAS project. No Apple/EAS IDs were invented anywhere. |

## 10. Typecheck fixed (2026‑10‑22, automated daily pass)

Added after everything above; nothing earlier in this document was rewritten.

`npm run typecheck` was failing (`backend/sms/outbox.ts(331,9): error TS2339: Property 'unref' does not exist on type 'number'.`), so this document's own claims that typecheck was "clean" had gone stale since whatever change introduced the break. This blocks nothing in the running app — the SMS dispatcher worked fine at runtime — but a red typecheck is a real regression against this repo's own non‑negotiable, and a founder relying on "typecheck passes" as a go/no‑go signal was getting a false pass if they didn't run it themselves.

**What was wrong.** This repo's `tsconfig.json` extends Expo's base config, which sets `"lib": ["DOM", "ESNext"]` for the app side. That makes the *global* `setInterval`/`clearInterval` ambient types resolve to the browser overload (`setInterval(...): number`, no `.unref()`) even inside backend‑only files that only ever run under Node, where the real return value is a `Timeout` object. `backend/sms/outbox.ts`'s dispatcher start‑up code called `.unref()` on that value, which the DOM‑shaped type doesn't have.

**What was fixed.** One file, no dependency changes, no tsconfig changes (changing `lib`/`types` repo‑wide risks breaking the app side's use of DOM‑only types like `fetch`/`URL`, which this pass was not scoped to touch or verify): `backend/sms/outbox.ts` now types `timer` as `NodeJS.Timeout | null` and casts the `setInterval(...)` result to that type with a comment explaining why, instead of inferring the ambiguous global return type. Behavior at runtime is unchanged — it is still the same Node `setInterval` call, same interval, same `.unref()`; only what TypeScript believes the return type is changed, to match reality.

**Verified today** (fresh `npm install`, local PGlite, `PAYMENTS_MODE`/`SMS_MODE`/`EMAIL_MODE` all simulated by default — no real money, texts, or emails sent):
- `npm run typecheck` — clean.
- `npm run test:e2e` — **17/17** criteria passed (the suite has grown past the 8 criteria this document's §1 table describes; that table is otherwise still accurate for criteria 1–8, it's just no longer the whole suite).
- `npm run test:geo` — 6/6.
- `npx tsx scripts/payments-check.ts` — 39/39, fake gateway only, confirms no money moves.
- `npm run test:workstreams` — 36/36.
- `npx tsx scripts/buyout-concept-check.ts` — 11/11 (the disabled buyout concept's math stays correct even though nothing links to it).

**Not done, not claimed:** no feature work, no dependency bumps, no Expo/tsconfig changes, nothing on a physical iPhone or against a real Stripe/Twilio/Resend account. The stale §1 "8/8" claim and the stale §7 FeeBreakdown note (struck through above) are the only documentation corrections made; everything else in this file describes what it already described.
