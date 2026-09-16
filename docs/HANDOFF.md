# Handoff — Campus marketplace MVP (build 1, 2026‑09‑14)

Working name **Campus Swap** (placeholder). This is a locally runnable prototype: a real iPhone app (Expo) talking to a real backend (Hono + tRPC + Postgres‑compatible database) with clearly labeled demo data. It is **not** an App Store release and moves **no money**.

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

Added after the first build and verified the same way: **search** on Browse (title/brand/description, composes with filters), **Settings** (edit name/bio, blocked users, honest prototype disclosures, sign out), **Close account**, a **moderation** screen for reports, and a **connection banner** that names the exact server address when the phone can't reach the Mac — with Retry restoring the feed, not just the banner.

Bugs found and fixed during QA: confirm dialogs silent on web (now `utils/confirm.ts`), web photo upload sending the wrong body, and a stale‑state bug that could erase a just‑added photo (would have affected iPhone too).

Also verified: `npm run typecheck` clean; `npx expo export --platform ios` bundles (≈3.7k modules); seed is idempotent; data survives backend restart (PGlite on disk).

**Not tested:** anything on a physical iPhone (this Mac has no Xcode/simulator). Expect small layout/keyboard fixes on first device run — that's normal.

## 3. Simulated or unfinished — read before demoing

| Area | State |
|---|---|
| Payments | **Simulated.** `payment.quote` does arithmetic (10% default fee, `PLATFORM_FEE_PERCENT`) and always returns `simulated: true`. No processor, no payment records, no protection implied. |
| Email verification | **Simulated delivery.** Codes are real and expire in 10 min, but they print to the backend console instead of being emailed. Badge copy says "Campus email verified", never identity. |
| Campus + meetup spots | University of Arizona with 4 **demo** spots (approximate coordinates). All labeled "verify hours and permission before pilot". |
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
