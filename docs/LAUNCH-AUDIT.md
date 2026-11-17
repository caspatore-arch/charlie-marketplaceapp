# Dibbs launch audit

Audit run November 16, 2026, against `main` at `192dca6` and the live site.
Fixes are on branch `audit/launch-readiness` (local, not pushed, not deployed).
Statuses are dated snapshots: re-check before relying on them.

Five read-only audits ran in parallel (build health, SEO and AI search, security,
legal and store policy, operations and growth), then five fix workstreams, then
an independent verification pass.

## Scorecard

| Area | Before | On the branch | What still blocks a pass |
|---|---|---|---|
| Build health | Lint failed (17 errors). A clean install failed typecheck in 6 files. | Typecheck 0 errors, lint 0 errors and 0 warnings, 16 test scripts pass, web build passes. | Nothing in code. |
| Security | 2 critical, 3 high, 5 medium. | All critical, high and medium findings fixed, with 40 new automated checks. | Deploy. A bot check on sign-in emails (owner account). |
| Dependencies | 20 advisories: 1 critical, 7 high. | 6 advisories: 0 critical, 3 high. | The 3 high need Expo Router 58 (an Expo SDK upgrade). |
| SEO and AI search | Every URL returned the homepage with status 200. No per-page titles, no FAQ. | Real HTML per public page, true 404s, FAQ with structured data, caching and security headers. | Confirm on a Netlify deploy preview. Search Console (owner). |
| Legal and policy | Terms contradicted "Get a Dibbs offer". No prohibited-items list. Privacy missed several third parties. | Draft copy matches the product. Community rules screen. | Lawyer review and the owner decisions listed below. |
| Operations | No CI gate, no storage visibility, no error tracking. | CI workflow added. Health reports storage mode. | Owner actions listed below. |
| Growth and outreach | A campaign plan, no ready-to-send copy. | Outreach kit in `docs/outreach/`. | Waitlist work (see "Waitlist"). |

## Found and fixed on the branch

### Security

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Critical | Rate limits could be skipped by batching several calls into one request. | Batching is off; limiters match the procedure name. |
| 2 | Critical | Email sign-in codes had no wrong-guess limit, and the campus-email check could hand over another person's account. | Codes are hashed, tied to their purpose, and burned after 5 wrong guesses. |
| 3 | High | Any made-up session token got its own rate-limit bucket. | A token only gets a bucket when it is a real session. |
| 4 | High | Sign-in emails could be used to spam strangers and use up the daily email allowance. | Daily cap per network address, stored in the database (reduces the risk; see open items). |
| 5 | High | The dev sign-in shortcut was switched off only by an environment variable. | Refused in production; the server will not start with both set. |
| 6 | Medium | Anyone could post fake payment events to production. | The simulated webhook answers 404 in production. |
| 7 | Medium | The seller could read the buyer's handoff code, and guesses were unlimited. | The code goes to the buyer only; 5 wrong guesses lock confirmation. |
| 8 | Medium | Uploads were read into memory before any size check. | Size limits on uploads, private media and API calls. |
| 9 | Medium | A listing photo could be any web address (tracking images, unreviewed content). | Only this server's uploads or the storage address are accepted. |
| 10 | Medium | The website sent no security headers except HSTS. | nosniff, Referrer-Policy, frame blocking, Permissions-Policy; full CSP in report-only mode. |
| 11 | Low | A user upload named `demo-*` kept its name and could overwrite another file. | User uploads always get a generated name. |
| 12 | Low | Uploaded files were trusted by their declared type. | File bytes are checked; served files send nosniff. |

### Found during verification (not in the first audit)

- A clean install of `main` fails typecheck (timer typing differs by install
  order). The main folder only passed because its installed packages had drifted
  from the lockfile.
- The first lint fix used a hook that `react-native-web` does not export. It
  passed typecheck, lint, every test and the build, and crashed the web app on
  load. Caught in the browser and replaced.
- The price filter's Max field was off-screen at every width on the web, so
  nobody could set a maximum price. Already present on `main`. Fixed.
- Privacy never mentioned that photo autofill can send photos to Anthropic, or
  that custom meetup addresses are sent to OpenStreetMap for lookup. Disclosed.

### Website and search

- Each public page (`/about`, `/why-dibbs`, `/faq`, `/legal/terms`,
  `/legal/privacy`) is written as real HTML after the build, with its own title,
  description, canonical address and readable text.
- Unknown addresses return 404. The 404 page is still the app, so a person on a
  route missing from the list sees a working app.
- New FAQ page (12 questions) with matching FAQPage structured data.
- Hashed assets cached for a year. Manifest, home-screen icon, sitemap dates.

### Client

- 17 lint errors cleared. API calls time out after 45 seconds. A "Waking up the
  server" line shows after 5 seconds of waiting. Listing photos have labels for
  screen readers. Settings links to Community rules and the FAQ.

### Legal copy (still a draft)

- Terms now cover "Get a Dibbs offer", prohibited items and conduct, meetup
  safety and copyright complaints. Privacy lists the services actually used and
  what closing an account really does.
- "Free, and you keep 100%" and "Safe and sure" on `/why-dibbs` replaced with
  wording that is true.

### Operations

- `.github/workflows/ci.yml`: typecheck, lint, every `test:*` script and the web
  build on pull requests and `main`. No secrets needed.
- `/api/health` reports whether photos are on object storage or local disk.

## Open: needs the owner

| # | Item | Why it matters |
|---|---|---|
| 1 | Have a lawyer review Terms and Privacy. | Both screens say "Draft, not final". |
| 2 | Find out whether buying used goods directly needs a secondhand-dealer licence and records in Arizona and Tucson, and how sales tax and payout reporting apply. | Dibbs becomes the buyer. Answer this before buying at volume. |
| 3 | Set team hours, or remove "an offer within an hour" from the welcome page. | The promise has no hours behind it. |
| 4 | A postal mailing address and an unsubscribe method before any email goes to the waitlist. | US email-marketing law requires both. |
| 5 | Set the R2 storage variables on Render and confirm a photo survives a redeploy. | Photos are otherwise lost on every deploy. Health now shows the mode. |
| 6 | Move Resend off the free plan before a public push. | 100 emails a day means about 100 sign-ins. |
| 7 | Add a bot check to the sign-in email form (for example Cloudflare Turnstile). | The daily cap slows abuse; it does not stop it. |
| 8 | Error tracking and an uptime alert that reaches the owner. | Today errors only go to the server log. |
| 9 | Database backups beyond Neon's 6-hour window. | A mistake noticed the next morning cannot be undone. |
| 10 | Move DMARC from `p=none` to `p=quarantine` once reports are clean. | Stops others sending as trydibbs.com. |
| 11 | Search Console and Bing Webmaster verification. | Needed to see how the site is indexed. |
| 12 | Decide on a report response time and state it. | Apple expects timely action on reports in apps with user content. |
| 13 | Decide whether to form a company and register a DMCA agent. | The operator is currently an individual. |

## Open: code work not done here

| # | Item | Note |
|---|---|---|
| 1 | Record Terms acceptance and age confirmation on the server. | Today it is only a checkbox in the app. |
| 2 | Per-listing titles and share previews. | Needs a Netlify edge function. |
| 3 | Expo SDK 58 upgrade. | Clears the last 3 high advisories. |
| 4 | Admin login: per-address lockout and a revocable cookie. | Low severity. |
| 5 | A seller can open a chat with any user. | Product decision: require a prior offer, booking or comment. |
| 6 | Sign-in code hashes are unsalted. | Matters only if the database leaks; phone codes are the same. |
| 7 | `scripts/loadtest.ts` rate-limit check uses made-up tokens. | Will report a failure until it uses real sessions. Not part of CI. |
| 8 | Retention for Dibbs offer requests. | Not covered by the cleanup job; needs a period from the owner. |
| 9 | Opaque 180px and 512px home-screen icons. | The current icon has a transparent background. |
| 10 | Admin stats: sign-up funnel, sources, meetups per week. | Cannot yet answer "how many meetups this week". |
| 11 | `docs/APP-STORE.md` privacy labels. | Out of step with the updated third-party list. |

## Waitlist

The directives describe the waitlist as the current front door. It is not live:
production answers "no procedure found" for `waitlist.join`, and the work sits
uncommitted in the main checkout (last edited November 9). When it lands:

- Its migration is also numbered 0022. Renumber whichever lands second.
- `app/welcome.tsx` there still needs the copy fixes ("sellers keep 100%",
  "within an hour") and footer links to `/faq` and `/rules`.
- The form needs a line on what the email is used for, a Privacy link, and
  capture of `utm_*` values (the campaign plan relies on them).
- Privacy needs a waitlist paragraph.

## Before this branch reaches production

1. Open a pull request so CI runs and Netlify builds a deploy preview.
2. On the preview: `/nope` returns 404; `/about` and `/faq` return 200 with their
   own titles; `/_expo/*` files are cached; no console errors on Home, a listing,
   Sell and sign-in.
3. After the API deploys: `/api/health` shows `storage`; sign in with a real
   email; confirm ordinary use is not rate limited (the limiter now keys on the
   address Render's edge reports).
4. Reconcile the migration number with the waitlist work first if that lands
   before this.
