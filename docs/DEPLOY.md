# Backend operations guide (API, database, photos, email)

Where the Dibbs backend lives, which settings matter, how to redeploy or roll
back, and how to check it is healthy. The website is covered in
`docs/DEPLOY-WEB.md`; the iPhone app in `docs/APP-STORE.md`.

Status below was checked in the provider dashboards on Oct 25-26, 2026. Anything
that changes later (plan, domain, env vars) is only true once someone re-checks.

---

## 1. Where everything lives

| Piece | Where | Notes |
|---|---|---|
| API | **Render** web service `dibbs-api` (Docker, Oregon, 1 instance) | Public at `https://api.trydibbs.com` (also `dibbs-api-v3cg.onrender.com`). Auto-deploys from `main` on GitHub (`caspatore-arch/charlie-marketplaceapp`). Health check path `/api/health`. Builds the `Dockerfile` at the repo root (backend only). |
| Database | **Neon** project "Dibbs Campus Marketplace", branch `production`, Postgres 18 | Set on Render as `DATABASE_URL` (secret). |
| Photos | **Cloudflare R2** bucket `dibbs-photos` (S3-compatible) | The bucket exists, but as of Oct 25 `S3_BUCKET` was **not yet set on Render**, so uploads still go to the container's disk. **Do not claim photos persist** until the S3 variables are set and a photo survives a redeploy (section 4). |
| Sign-in email | **Resend**, domain `trydibbs.com` | `EMAIL_MODE=live`; `/api/health` reports email live. |
| SMS | Simulated | Not set up. See section 8 for when you want it. |
| Payments | Simulated | No Stripe account or key. See `docs/HANDOFF.md` section 3a for the checklist. |
| Admin | `/admin` on the API | Enabled (`ADMIN_PASSWORD` is set on Render). |
| Website | Netlify (see `docs/DEPLOY-WEB.md`) | Calls the API at `https://api.trydibbs.com`. |

Plans (as of Oct 26): Render **Free** (the service sleeps when idle, so the first
request after a quiet spell is slow), Neon **Free** (6-hour restore window),
Resend **free** (100 emails/day, 3,000/month). Upgrading any of these is a
billing decision for the owner.

The container runs database migrations automatically every time it starts
(`backend/db/migrate.ts`, called from `backend/server.ts`). There is no separate
migration step, and each migration only runs once.

---

## 2. Redeploy

- **Normal path:** merge or push to `main`. Render builds and deploys by itself.
  Watch the deploy in Render, then check health (section 5).
- **Manual:** Render dashboard, `dibbs-api`, Manual Deploy, "Deploy latest commit"
  (or "Clear build cache & deploy" if a build looks stale).
- **Changed an env var on Render:** saving it restarts the service. No rebuild.
- **Changed anything starting with `EXPO_PUBLIC_`:** that is baked into the web
  and app builds, not the API. Rebuild the website (`docs/DEPLOY-WEB.md`).

Before a deploy that includes a **new migration**, read it (`backend/db/migrations/`)
and run the pre-check for it against the hosted database if it adds unique
indexes (see "Migration pre-check" below). Migrations only go forward.

## 3. Roll back

- **Code:** Render dashboard, `dibbs-api`, Events/Deploys, pick an earlier
  successful deploy and roll back to it. Or revert the commit on `main` and let
  auto-deploy run.
- **Caveat:** rolling code back does **not** undo database migrations that already
  ran. Older code running against a newer schema usually works for additive
  migrations; check the migration before relying on it.
- **Database:** Neon console, branch `production`, Restore. The free plan only
  restores to a point within the last **6 hours**, so decide quickly. Restoring
  discards writes made after the restore point.
- **Never** run `npm run db:seed` or `npm run db:reset` against the production
  `DATABASE_URL`. They are for local demo data.

## 4. Photos (R2)

To switch the API to R2, set these on Render (the values come from the
Cloudflare R2 dashboard, API token scoped to `dibbs-photos` with read+write):

| Variable | What it does | Secret? |
|---|---|---|
| `S3_BUCKET` | `dibbs-photos`. **Setting it is the on/off switch**: set means S3-compatible storage, empty means local disk. | No |
| `S3_REGION` | `auto` for R2. Required once `S3_BUCKET` is set. | No |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com`. Leave empty only for real AWS S3. | No |
| `S3_ACCESS_KEY_ID` | R2 access key. | **Yes** |
| `S3_SECRET_ACCESS_KEY` | R2 secret key. | **Yes** |
| `S3_PUBLIC_BASE_URL` | Optional. A public bucket or custom domain in front of R2; photo URLs then skip the API. | No |

If `S3_BUCKET` is set but `S3_REGION`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY`
is missing, **the server refuses to start** and names the missing variable. That
is intentional, so a typo cannot silently fall back to disposable disk.

Verify: upload a photo in the app, redeploy the API, and confirm the photo still
loads. Until that passes, photos on a container-disk deploy are lost on every
redeploy or restart.

## 5. Verify it is healthy

Open `https://api.trydibbs.com/api/health`. You should see `"ok": true`, plus:

- `email.mode` is `live` and `simulated` is `false`.
- `payments.mode` is `simulated` unless real payments were deliberately turned on
  (`docs/HANDOFF.md` section 3a). Anything else unexpected: stop and check the
  Stripe variables.
- `sms` is simulated (expected until section 8 is done).

Free Render sleeps when idle, so the first health request can take a while. Then
sign in on `https://trydibbs.com` with a real inbox and confirm the code arrives
from `codes@trydibbs.com` (check spam once; if it lands there, check the Resend
domain records).

Verify a hosted database from a laptop with
`DATABASE_URL="..." npm run db:check` (connects, applies migrations, prints the
table count). Use a throwaway branch if you are unsure: `db:check` applies
migrations.

---

## 6. Environment variables

`.env.example` is the authoritative list of names. This explains the ones that
matter in production. Set them in the Render dashboard, never in a committed file.

### Core

| Variable | What it does | Secret? |
|---|---|---|
| `DATABASE_URL` | Neon connection string. Empty means the on-disk local database, which is disposable inside a container. **Always set in production.** | **Yes** |
| `NODE_ENV` | `production` in production. Turns on the `ALLOWED_ORIGINS` allowlist. | No |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API (CORS). Must include `https://trydibbs.com`. If the website loads but nothing works, check this first. Only enforced when `NODE_ENV=production`. | No |
| `PORT` | Set by the host; leave it alone. | No |
| `DEV_LOGIN` | The "switch test user" shortcut. **Must be unset or `0` in production**; it lets anyone become any demo user. | No, but must be off |
| `ALLOWED_EMAIL_DOMAINS` | Campus email domains that count as campus-verified (e.g. `arizona.edu`). Any email can sign in; only a verified campus email unlocks selling, offering, booking and posting (unless the founder sets that user to Approved). | No |
| `MODERATOR_USER_IDS` | User id(s) who can review reports. | No |
| `ADMIN_PASSWORD` | Enables `/admin`. Needs 16+ characters; shorter means `/admin` is off. | **Yes** |
| `PUBLIC_APP_URL` | Public address of this server. Only matters once real payments are on. | No |
| `PLATFORM_FEE_PERCENT`, `PAYOUT_DELAY_DAYS` | Payment settings; inert while payments are simulated. | No |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Real payments only (`docs/HANDOFF.md` section 3a). Not set. | **Yes** |
| `DB_POOL_MAX` | Max database connections per instance. Keep `DB_POOL_MAX x instances` below the Neon plan's connection limit. | No |

### Email (Resend)

| Variable | Value | Secret? |
|---|---|---|
| `EMAIL_MODE` | `live` | No |
| `RESEND_API_KEY` | Sending-access key from Resend | **Yes** |
| `EMAIL_FROM` | `Dibbs <codes@trydibbs.com>` (domain must be the verified one) | No |

All three are required; if any is missing the backend quietly stays simulated and
`/api/health` says why. Never set them on a laptop. Email codes: 6 digits, expire
in 10 minutes, 5 wrong guesses, 30-second resend cooldown, at most 5 codes per
address per hour. Free Resend caps at 100/day and 3,000/month, so a burst of
sign-ins can hit the daily cap; upgrade the plan if that happens.

Which sign-in method leads is decided by `auth.methods`: email until live SMS is
configured, then phone automatically.

### Rate limits

`RATE_LIMIT_AUTH_REQUEST_CODE_PER_MIN`, `RATE_LIMIT_AUTH_VERIFY_CODE_PER_MIN`,
`RATE_LIMIT_CHECK_ADDRESS_PER_MIN`, `RATE_LIMIT_UPLOADS_PER_MIN`: per-visitor
limits per minute. Defaults are sane; only change them for a real problem.

### Photos

See section 4.

---

## 7. Reference

### Migration pre-check (hosted database)

Migration 0009 adds unique indexes that fail if anyone holds two accepted
meetups at the same instant. This only matters on a database that has not run
0009 yet (production has very likely run it already). If you are unsure, run this **before** deploying and resolve any rows by hand (never automatically):

```sql
select seller_id, starts_at, count(*) from reservations where status='accepted' group by 1,2 having count(*) > 1;
select buyer_id,  starts_at, count(*) from reservations where status='accepted' group by 1,2 having count(*) > 1;
```

No auction, bid, reservation or payment row is changed by 0009. Review any later
migration (for example `0017_posts_no_expiry`) the same way before rollout.

### Will it hold up? Sizing for about 5,000 students a day

Yes, comfortably, on a small paid tier. 5,000 daily active users is roughly
100,000 requests a day: about 1.2 requests/second on average, about 4.2 in the
peak hour, bursts to about 13.

`npm run loadtest` builds a campus that has run a semester (15,000 users,
24,000 listings, 66,000 messages) and drives a browse-weighted mix. On the local
WASM database (the slowest it will ever run) it sustains about 270 requests/second
with a p50 of 29ms, roughly 20x the burst figure, on one process. Real Postgres is
faster per query. Photo bandwidth and storage cost will matter sooner than the
database.

- One backend instance is enough. Do not turn on autoscaling (the rate limiter is
  per-process, section 9).
- Watch the Neon connection limit rather than CPU (`DB_POOL_MAX`).
- Put object storage behind a CDN or public bucket.
- Re-run `DATABASE_URL='...' npm run loadtest` against a **throwaway** database
  (it writes tens of thousands of fixture rows), never production.

Overload does not crash; it just gets slower without limit:

| Simultaneous requests | Throughput | Typical response | Slowest 1% |
|---|---|---|---|
| 8 | 282/s | 28ms | 47ms |
| 16 | 284/s | 55ms | 89ms |
| 32 | 283/s | 110ms | 311ms |
| 64 | 278/s | 211ms | 2.1s |
| 128 | 285/s | 279ms | 8.5s |

Signals to watch, in order: response times creeping up while traffic is flat (a
query lost its index); "too many connections" errors (`DB_POOL_MAX` or instance
count too high); storage bandwidth cost. On the Free Render plan, slowness after
a quiet spell is the service waking up, not overload.

---

## 8. Transactional SMS (Twilio), for later

Phone sign-in codes and three event texts (listing posted, booking confirmed,
30-minute reminder) are built and tested against a simulated provider, and have
never been sent through Twilio. Until this section is done the app stays in
`SMS_MODE=simulated`; phone sign-in is not usable by real students.

1. A **Twilio account** with billing. Note the Account SID and Auth Token.
2. A **sender**: a US long-code number, toll-free number, or Messaging Service
   (SID starts with `MG`; put that in `TWILIO_FROM`).
3. **US carriers block unregistered texting.** Register first (days to weeks, plus
   fees): A2P 10DLC for a long code (brand, then campaign), or toll-free
   verification.
4. Set on Render only: `SMS_MODE=live`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
   (secret), `TWILIO_FROM`, `SMS_LIVE_ACK=1`, `SMS_APP_LINK_BASE=https://trydibbs.com`.
   Any one missing and it stays simulated and says why.
5. Enable Twilio **Advanced Opt-Out** so STOP/HELP are handled. Step-by-step for
   the inbound STOP callback (`/api/sms/inbound`, `TWILIO_INBOUND_WEBHOOK_URL`) and
   the delivery test is in `docs/MESSAGING-LAUNCH.md`.

How sending works: events write rows to `sms_messages`; a dispatcher inside the
backend process wakes every 30 seconds (`SMS_DISPATCH_INTERVAL_MS`), sends what
is due, retries after 1, 2, 4 and 8 minutes, and gives up after 5 attempts.
Designed and tested for a single instance. Verification codes are texted directly
and not retried. Check `failed` and long-`scheduled` rows in `sms_messages` after
launch; there is no dashboard.

---

## 9. Known limits

- **Rate limiting is per process.** The backend counts requests in its own memory,
  per caller (signed-in requests by session, anonymous by IP, because campus Wi-Fi
  shares one NAT address). With more than one instance each counts separately and
  the real limit multiplies. Fine for one instance; if you ever scale out, swap in
  a shared counter (for example Upstash Redis) or edge rate limiting.
- **Geocoding** for custom meetup addresses uses free OpenStreetMap Nominatim
  (`backend/geocode.ts`), behind the rate limiter. Fine for pilot volume; its
  usage policy forbids heavy commercial use, so swap in a paid geocoder before
  real traffic.
- **Free-plan sleep:** Render Free sleeps the API when idle. Fine for a pilot with
  occasional users; consider a paid instance if people are actively using it.
