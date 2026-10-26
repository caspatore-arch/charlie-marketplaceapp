# Dibbs — project directives and work queue

Consolidated October 21, 2026; production section added October 26. Start here
before choosing work. Statuses are dated snapshots: update them with evidence.

## Production as of 2026-10-26

Verified in the provider dashboards on Oct 25-26, 2026. These override older docs.

- **Website:** https://trydibbs.com on Netlify, project `dibbs-app-web`, auto-builds
  from GitHub `main` (`caspatore-arch/charlie-marketplaceapp`) with deploy previews
  for PRs. `www` and `app` subdomains redirect to the root. The Netlify build env has
  `EXPO_PUBLIC_RORK_API_BASE_URL` and `EXPO_PUBLIC_WEB_BASE_URL`. The old waitlist
  site is gone from the domain.
- **API:** Render web service `dibbs-api` (Docker, Oregon, 1 instance), custom domain
  https://api.trydibbs.com (also `dibbs-api-v3cg.onrender.com`), auto-deploys from
  `main`, health check `/api/health`, **Free plan (sleeps when idle)**. Not Railway.
- **Database:** Neon, project "Dibbs Campus Marketplace", branch `production`, Free
  plan, 6-hour restore window, Postgres 18.
- **Email:** Resend, domain `trydibbs.com`, `EMAIL_MODE=live`, free plan (100/day,
  3,000/month). Health reports email live.
- **Photos:** Cloudflare R2 bucket `dibbs-photos` exists, but `S3_BUCKET` was not yet
  set on Render as of Oct 25 (being fixed). Do not claim photos are persistent until
  verified.
- **SMS and payments:** simulated. `/admin` is enabled (`ADMIN_PASSWORD` set).
- **Sign-in:** any email can sign in, and since 2026-10-26 (owner decision) any
  verified email can trade too; a campus email adds the "Campus email verified"
  badge. Phone-only accounts still need a campus email or the founder's Approved
  setting. Not yet deployed. Listings are in Browse for 24h, then the Archive; community
  posts do not expire.

Operations guides: `docs/DEPLOY.md` (API, database, photos, email) and
`docs/DEPLOY-WEB.md` (website).

## Read order and decision rules

1. The owner's latest explicit request controls the current task.
2. Read `AGENTS.md`, then this document for priorities and known conflicts.
3. Read `docs/CONTRACT.md` for API/data behavior and the relevant source files.
4. Use the specialist guides below for implementation details. Older handoffs,
   prompts and unchecked lists are historical context, not new assignments.
5. Distinguish requested behavior, committed code, local unfinished changes,
   test results, and verified production behavior. None implies the others.

Do not execute every item just because it is listed here. Select the next item
within the owner's current authorization; keep the remaining queue intact.

## Product direction

- Dibbs is a University of Arizona campus marketplace: list an item, agree on
  price, book a specific campus meetup, and confirm the handoff.
- Current committed direction: one website at `https://trydibbs.com`. The former
  waitlist design becomes the Create account / Log in front door. New accounts
  continue to profile setup and the feed; returning signed-in users see the feed.
  Public listing links remain accessible. Native browsing remains available.
- `www.trydibbs.com` and `app.trydibbs.com` redirect to the same path
  on the root domain (live). Do not create a second app experience on a subdomain.
- Fixed asking prices and offers replace new auctions. A listing is live in the
  main Browse feed for 24 hours, then moves to an Archive where it stays
  visible, likeable, commentable and open to a buyer-proposed time and place
  that the seller accepts or declines (owner decision, October 24, 2026).
  Community posts stay up until removed. Confirmed meetups survive listing expiry.
- Bookings use exact 30-minute slots and campus-local display times (owner decided 2026-10-22 to move to 15-minute slots inside seller-chosen blocks; see `docs/OVERHAUL.md` "The pitch"). Preserve
  concurrency protection, price checks, report/block behavior and account privacy.
- Tabs: Browse, Sell, Community, Profile. Meetups/messages remain accessible
  through the inbox route and relevant item/meetup screens.
- Any email can sign in. Email leads sign-in while SMS is simulated; `auth.methods` controls the lead
  method and can choose phone when SMS is live. Do not restore unconditional
  phone-first copy from older docs. A verified email of any domain, a campus email, or the founder's Approved setting allows trading/posting (owner decision 2026-10-26);
  phone or email verification is never identity verification.
- Payments remain simulated unless separately approved and configured. No claims
  of guaranteed safety, escrow, protection, fabricated activity or fake reputation.
- Use current theme tokens and accessible mobile layouts. Old design prose is
  not permission to overwrite newer branding or restore removed screens.

## Repository and collaboration

- GitHub: https://github.com/caspatore-arch/charlie-marketplaceapp
- Existing `origin` is that repository; default branch is `main`. Fetch and
  connected GitHub read/push permissions were verified during consolidation.
- Repository visibility is public. Never commit credentials, `.env`, private
  customer data, login codes, API keys or exports of real signups.
- At inspection, local `main` was four commits ahead of `origin/main`:
  `b10ec62` profiles/follows; `1e0c5f3` comments/Hottest;
  `1b480a9` one-domain front door; `f56197a` signup lint fixes.
  Fetch and recheck before integrating: other chats are editing this checkout.
- Uncommitted work observed: profile/layout/router edits plus `app/dashboard.tsx`
  and `backend/trpc/routes/admin.ts`. Treat as unfinished; review authorization,
  privacy and tests before committing or deploying. Do not overwrite it.
- Research and presentation outputs also exist locally. Keep them separate from
  app changes; do not indiscriminately stage the entire workspace.
- Open PR: https://github.com/caspatore-arch/charlie-marketplaceapp/pull/1 —
  “Accepting an offer books the meetup the buyer proposed.” It proposes structured
  meetup fields and booking on acceptance, with a hold fallback if stale. Review
  against current main; do not describe it as merged. No open issues were returned.
- Use focused branches/commits, no force pushes. Do not send instructions to other
  chats without the owner's authorization. Multi-agent workstream prompts are not
  standing permission to launch agents.

## Ordered work queue

| Priority | Directive | Completion evidence |
|---|---|---|
| 1 | Reconcile local commits, open PR and dashboard work before publishing the full app. | Reviewed diffs, appropriate checks, recorded commit/branch and deployment source. |
| 2 | ~~Recheck current Cloudflare DNS and Netlify deployments; select the one-domain app target.~~ **Done 2026-10-26**: `trydibbs.com` on Netlify `dibbs-app-web`. | Documented in "Production as of 2026-10-26". |
| 3 | ~~Finish Resend domain verification and owner-approved sending key.~~ **Done 2026-10-26**: domain verified, `EMAIL_MODE=live`. | Domain Verified; key stored directly by owner, never in chat or git. |
| 4 | **Partly done.** Backend (Render) and Postgres (Neon) are live. Remaining: set the R2 `S3_*` variables on Render and prove a photo survives a redeploy. | Real upload/read test across a redeploy. Plan upgrades (Render/Neon/Resend) need owner input. |
| 5 | ~~Configure backend email and browser origins, then build/deploy the web app to Netlify.~~ **Done 2026-10-26.** | `EMAIL_MODE=live`, secret `RESEND_API_KEY`, `EMAIL_FROM=Dibbs <codes@trydibbs.com>` on backend; health reports live and a real code arrives. Correct public API URL baked into build; CORS permits intended domains. |
| 6 | ~~Connect root/www DNS to the selected site and provision HTTPS.~~ **Done 2026-10-26.** | Owner approves exact DNS records first; Netlify verifies domains/certificate; browser loads intended front door and direct listing routes. |
| 7 | Verify pilot flows on phone and desktop. | Signup/login, profile, listing/photos, offers, booking race, messaging, cancel/reschedule, handoff, expiry, blocking/reporting, deep links and restart persistence. |
| 8 | Resolve founder/pilot operations decisions. | Confirmed meetup locations/hours, moderation owner, support/privacy contact, eligibility, retention/deletion and reviewed legal copy. |
| 9 | Native/TestFlight/App Store preparation when web pilot is ready. | Device QA, stable bundle ID, Apple/Expo account details, public privacy/support pages and reviewed store disclosures. |

Dependency matters more than old checklist order: a static app deployment cannot
prove working sign-in without the backend and email provider. Do not activate paid
services or production money movement simply to clear this queue.

## Domain setup handoff and owner boundaries

Verified in this chat earlier on October 21:

- Registrar and authoritative DNS: Cloudflare; zone was Active with Full DNS.
- Email Routing was already enabled with locked DNS records. Added the routing
  rule `hello@trydibbs.com` to the owner's verified Gmail destination; rule Active.
  No DNS records were created or deleted by this chat. Recipient remains in the
  account UI rather than this public repository document.
- An existing pending destination for `hello@trydibbs.com` was left untouched.
- Registrar status initially said Email Verification Required. Recheck whether
  the owner completed the registration email; this is separate from Gmail routing.
- Superseded: an earlier Netlify inspection (no Dibbs project) and a failed folder
  upload are obsolete. The site, Resend and the domain are now live (see
  "Production as of 2026-10-26"); inspect current dashboards before changing anything.

Owner's explicit operating rules persist:

1. Open login pages and pause for owner login/password/2FA/CAPTCHA. Never type
   passwords. Keep the relevant browser tab open when handing control back.
2. Before EVERY DNS change, show type, name, exact value and proxy setting, plus
   MX priority where applicable; wait for “ok.” Netlify web records use DNS only.
3. Do not delete existing DNS records without asking, change nameservers, buy
   anything, change billing, or create API keys/tokens without approval.
4. Preserve Cloudflare routing MX/TXT records. Resend sending MX normally belongs
   on a subdomain such as `send`; if it conflicts with inbound mail, stop and ask.
5. Before creating a Resend key, ask. If approved: `dibbs-production`, Sending
   access only. Owner copies directly to password manager; never show the key.
6. Provide a short status after each completed task. Final domain report must
   include forwarding/verification, HTTPS, form detection or why obsolete,
   Resend/key status, and every added DNS record plus unresolved uncertainty.

## Validation and deferred work

- Run checks appropriate to actual code changes: `npm run typecheck`,
  `npm run lint`, `npm run test:workstreams`, `npm run test:e2e`, and focused
  scripts as relevant. Historical PASS claims are not current results.
- Do not seed/reset a database while the backend owns it. Do not run migration,
  seed or destructive test scripts against production without reviewing scope.
- Real email/SMS/payment tests require explicit live configuration. Keep ordinary
  automated tests simulated. Preserve dev/demo labels and production dev-login gates.
- Review PR #1 migrations and existing hosted migration prechecks before rollout.
- Maps remain backlog with an accessible list fallback. Profile category labels
  remain exploratory; profiles/follows themselves now exist in local commits.
- Saved-search alerts, collections, richer discovery, product previews and campus
  “Wanted” improvements are research recommendations, not approved build scope.
  Compare against existing Community functionality before proposing duplicate work.
- Consumer slides describe a team-offer feature as planned; do not present it as
  implemented. Slides and logo/research work are supporting assets, not release proof.
- SMS carrier registration/consent and STOP-sync work, real payments, payout policy,
  geocoding provider choice, push delivery and scaled rate limiting remain separate
  integration decisions; confirm current code and deployment before declaring gaps closed.

## Source map and known limits

| Source | Use |
|---|---|
| `docs/CONTRACT.md`, actual backend routes/schema | API and data behavior; resolve stale phone-first statements with current `auth.methods`. |
| `docs/DEPLOY.md`, `.env.example` | Operations guide for the live backend (Render, Neon, R2, Resend); re-verify plan/price details in dashboards. |
| `docs/DEPLOY-WEB.md`, `netlify.toml`, `public/_redirects` | Operations guide for the live one-domain website on Netlify. |
| `docs/INTEGRATION-CHECKLIST.md`, `docs/BRIEF.md` | Acceptance references; older phone-first/profiles-only-backlog items need current-scope interpretation. |
| `docs/LEGAL-TODO.md`, `docs/APP-STORE.md` | Founder and native-release decisions; auction sections are historical. |
| `docs/DESIGN.md`, `constants/theme.ts` | Visual/accessibility rules; current tokens and implemented flow supersede old screen descriptions. |
| `docs/HANDOFF.md`, `docs/AUCTIONS.md` | Trimmed. Keep for what is simulated, turning payments on (HANDOFF sections 3, 3a, 7) and custom meetup addresses/payments spec (AUCTIONS sections 2, 3; section 1 auctions is retired). The old workstream/prompt docs were deleted 2026-10-26. |
| `docs/backlog/`, `docs/concepts/BUYOUT.md` | Deferred ideas; buyout concept stays gated, not a live auction feature. |
| `competitor-profiles/`, `output/` | Local research and presentation artifacts; not all are committed. |

Relevant chats inspected/listed: “Set up trydibbs.com”, “Consolidate site to
trydibbs.com domain”, “MVP deployment and waitlist launch”, “GitHub repo addition”,
“Create a Dibbs logo inspired by Snag”, and “Create a DIBBS vision slideshow”.
The latter reports a daily 5–5:30 p.m. launch check-in for tester feedback,
collaborator follow-ups and the next blocker; calendar state was not reverified.

Memory search failed twice (automatic and guided). Three imported chats returned
unsupported detail reads; their summaries and corresponding commits/docs were
available. This consolidation does not claim exhaustive recovery of those records.
No application tests or production verification were performed for this docs pass.

## October 21 site improvement update

Owner authorized repo changes/push: stronger logo, explanatory landing content,
two public explainer pages, more color, first-post tutorial, post-publish share
link, hour-by-hour availability, photo swipe/scroll review, meetup email/upvote
checks, Twilio integration and running-cost scenarios.

- Fresh fetch found local main and origin/main both at `e93adc7`; the previously
  observed dashboard work is committed. Work is on `codex/dibbs-site-improvements`.
- Added `/about`, `/why-dibbs`, login explanation, six-step listing tutorial
  (per account/device, replayable), hourly availability chips retaining 30-minute
  booking slots, visible share URL, and accessible photo paging controls.
- Added transactional booking email queue/migration `0014_booking_emails`, with
  retries, stale-state checks, and provider idempotency keys. Requires backend
  deployment/migration and live Resend configuration to deliver real email.
- Added signed Twilio incoming STOP callback. Account activation, approved sender,
  credentials, webhook configuration and real-device delivery remain unverified.
- Current checks: typecheck and web export pass; workstreams 39/39; e2e 17/17.
  Focused lint has no errors. Full lint reports 20 existing errors in unrelated
  source. Public explainer navigation checked in local browser; physical-device
  swipe testing and production delivery remain pending.
- Claude cost calculation could not authenticate (expired session). Locally
  calculated assumptions and scenarios are in `docs/RUNNING-COSTS.md`.
- No DNS/billing/credential/account changes or production deployment performed.
  Existing uncommitted AGENTS.md, README.md and research outputs are preserved.

## October 22 feed additions (local, uncommitted, not deployed)

Owner-approved additive work: likes, shares and Hottest on Browse; automatic listing posts in Community; story art and an optional video email after posting. Existing look, controls, auth, offers, booking and 24-hour expiry were preserved. Nothing here is committed, pushed or deployed; the hosted database has NOT been migrated.

Verified locally on a throwaway sandbox database (never the shared dev DB or production), October 22:
- Backend: `npm run typecheck`; new `npm run test:engagement` 58/58; existing `test:workstreams` 42/42, `test:e2e` 17/17, `test:comments` 24/24, `test:save` 9/9, `test:payments` 39/39, `test:geo` 6/6.
- Browser (headless Chrome, 1440x900 and 390x844): Browse is newest-first by default; Hottest chip beside All; 4 columns at >= 1200px, 3 at >= 900, 2 at >= 600, 1 on phones; filter-row arrows scroll the chips; likes persist across reload and show identically in Community; a rapid double tap is one like; Saved is separate and unrenamed; the same listing comment shows under the Browse card, on the Community listing post and in the listing page thread; replies, save/unsave and swipe view still work; no console errors. Screenshots of welcome, saved, profile, sell and listing detail are byte-identical before/after at both widths.
- After posting (web, 1440x900 / 390x844 / 320x640): the success modal keeps its existing content and adds an optional "Share to your story" image (real 1080x1920 PNG with the Dibbs logo, photo, price and title; Save downloads it; Share image uses the browser file share when supported, else saves) and a free, optional "Email your video" `mailto:` (nothing is uploaded or auto-published; "a feature is not guaranteed"). Both appear only in the post-publish modal, never on the Sell form. The copy never says anything was posted to Instagram.
- Share count rule (see `docs/CONTRACT.md` "Likes, shares and Hottest"): signed-in person, share sheet not cancelled or link copied, one per person per listing. It is not proof of an Instagram (or any) post.

Decisions and open items for the owner:
- Community now opens on the Sellers tab (listing posts are `selling` posts); it was Buyers. One-line revert in `app/(tabs)/community.tsx`.
- No dedicated video inbox exists. The "Email your video" section reuses `hello@trydibbs.com` (the Cloudflare-routed founder inbox recorded above); override with `EXPO_PUBLIC_VIDEO_EMAIL`. Owner to confirm or name another inbox.
- Migration `0016_listing_engagement` is additive (no backfill): listings created before it have no Community post; new and relisted ones do. Review it with the existing hosted-migration prechecks before rollout.
- Not counted as shares: the listing page's own share button and the intent chips (WhatsApp, X, ...). On Android the OS cannot report a cancelled share sheet, so a cancelled sheet may count there.
- Native (iPhone/Android) was not run: no Xcode on this machine. The iPhone story-image export (react-native-svg `toDataURL`, `expo-file-system`, iOS share sheet) is written and typechecks but is untested on a device; the Story section is hidden on Android because React Native's `Share` ignores `url` there (the video email still shows).
- Lint: `npx expo lint` still reports the pre-existing errors (e.g. `Confetti.tsx`, `Skeleton.tsx`); none are in the files added or changed for this work.

## October 24 Archive and permanent posts (local, uncommitted, not deployed)

Owner decision: a listing is live in Browse for 24 hours, then moves to an **Archive** where it stays usable (a buyer proposes the time and place; the seller accepts or declines), and Community posts stay up until removed. Behavior is specified in `docs/CONTRACT.md` ("Archive, buyer-proposed meetups and permanent posts"). Nothing is committed, pushed or deployed; no hosted database has been migrated (adds migration `0017_posts_no_expiry`; `0016` from the October 22 work is already on `main`).

Verified locally on a throwaway sandbox database (never the shared dev DB or production), October 24:
- `npm run typecheck`; new `npm run test:archive` 43/43; `test:engagement` 58/58, `test:workstreams` 42/42, `test:e2e` 17/17, `test:comments` 24/24, `test:save` 9/9, `test:payments` 39/39, `test:geo` 6/6. The e2e and workstreams checks that asserted "community posts expire after 24 hours" were rewritten to the new rule (posts stay; removal takes them down).
- Browser (headless Chrome, 1440x900 and 390x844): an Archive chip beside Hottest shows unsold listings past their 24 hours (cards say "Archived · propose a time"; Pickup today is disabled there); archived listings stay likeable and open the listing page; the live feed no longer shows them; Community keeps a five-day-old text post and labels archived listings' posts "Archived", with no countdowns; no console errors. The buyer flow (listing page "Propose a time and place" -> pick a day/time up to 7 days out -> pick a campus spot or address -> confirm -> sent) and the seller's Accept / Propose another time / Decline screen were exercised in the browser by a helper session; screenshots are in the session scratchpad.

Open items for the owner:
- Offers stay live-listing only (and are currently hidden); instant booking stays live-listing only. Buyers on an archived listing can like, comment and request a meetup.
- A buyer can propose any time up to 7 days out and any active campus spot or a custom address (the existing campus-radius check). Change `ARCHIVE_REQUEST_HORIZON_MS` or the spot rule if you want it tighter.
- The posting brake changed from "5 live posts" to "5 new posts per rolling 24 hours" because posts no longer lapse.
- The draft Terms/Privacy wording was updated to match (posts and archived listings do not expire), but retention (`DATA_RETENTION_PERIOD`) and deletion promises still need the founder's and a lawyer's review (`docs/LEGAL-TODO.md`).
- `docs/OVERHAUL.md` was not touched: the coordinator should record this decision there.
- Native (iPhone) not run: no Xcode on this machine.

