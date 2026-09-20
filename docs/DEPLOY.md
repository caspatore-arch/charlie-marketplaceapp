# Deploying the backend (for the founder, not an engineer)

This guide gets the **backend API** — the thing your phone app talks to — running somewhere other than your Mac, so a friend can download the app from TestFlight and it actually works. It does **not** cover publishing the iPhone app itself (that's a separate, later step through Expo/Rork/App Store Connect).

Right now, when you run `npm run backend`, everything lives on your laptop: the database is a file on your hard drive, and photos are files in a folder on your hard drive. That's great for building the app but means:
- Only phones on your home Wi‑Fi can reach it.
- If your laptop restarts or the app is reinstalled, all your data and photos could vanish.

Deploying fixes both. Budget **half a day** the first time, mostly spent waiting on signups and DNS/propagation, not typing commands.

---

## 0. The shape of what you're building

Three separate things, three separate signups:

1. **A place to run the container** (the Docker image this repo now builds) — this is your API server.
2. **A Postgres database** — this repo already supports this via one environment variable (`DATABASE_URL`); you're just choosing who hosts it.
3. **A place to store photos** — "S3-compatible object storage." Several providers offer this.

None of these are the same company necessarily, and none of them need to be. Pick the cheapest/simplest for a pilot; you can move later without touching code.

---

## 1. Choose a Postgres host

The repo already speaks real Postgres (`backend/db/client.ts`) — it's a single environment variable (`DATABASE_URL`) away from working. You don't need to change any code.

**Recommended for a first pilot: [Neon](https://neon.tech)** — this repo's docs already assume it, it has a genuinely usable free tier, and it's a two-minute signup with no credit card.

Steps:
1. Sign up at neon.tech (a free account is enough for a pilot).
2. Create a project. Neon gives you a **connection string** that looks like `postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/dbname?sslmode=require`.
3. Copy that whole string — this is your `DATABASE_URL`. **Treat it as a secret**, same as a password (it contains one).
4. Before pointing the real app at it, verify it from your Mac:
   ```
   DATABASE_URL="paste-the-string-here" npm run db:check
   ```
   This connects, applies the database's table structure, and prints a table count. If it fails, the error message will say why (usually a copy/paste issue with the connection string).

**Cost:** Neon's free tier covers a pilot easily (small storage/compute, scales to zero when idle). Expect **$0/month** to start; their paid tier (if you outgrow free) starts around $19/month. Other options (Supabase, Railway, Render Postgres, AWS RDS) all work identically — same one variable — pick whichever you already have an account with.

---

## 2. Choose an object storage provider (for photos)

This is new: the backend can now write uploaded photos to S3-compatible storage instead of local disk. "S3-compatible" means several companies speak the same protocol Amazon invented, so the same code works with any of them — you're picking based on price and how much you trust the company, not features.

**Recommended for a first pilot: [Cloudflare R2](https://developers.cloudflare.com/r2/)** — no egress (bandwidth) fees, which matters because every time someone views a listing photo, that's a download; a generous free tier; a well-known company.

Steps (Cloudflare R2):
1. Sign up / log into Cloudflare, go to **R2** in the dashboard.
2. Create a bucket (pick any name, e.g. `campus-swap-photos`).
3. Under **R2 → Manage API Tokens**, create an API token scoped to that bucket with **read + write** permission. This gives you an **Access Key ID** and a **Secret Access Key** — copy both immediately, the secret is shown once.
4. Your **endpoint** is shown on the bucket's page — it looks like `https://<account-id>.r2.cloudflarestorage.com`.
5. (Optional, recommended once you're past the earliest testing) Turn on **public access** for the bucket, or put a Cloudflare custom domain in front of it, and use that URL as `S3_PUBLIC_BASE_URL` (see below) — this makes photo loading faster and cheaper because your server stops relaying every photo byte itself.

**Alternatives that work with zero code changes** (same env vars, just different values): **Backblaze B2** (also very cheap, has its own free egress deal with Cloudflare), **Wasabi**, or plain **AWS S3** (the original, most "enterprise," typically the most expensive for a small app because of bandwidth fees). Leave `S3_ENDPOINT` empty for real AWS S3; set it for anyone else.

**Cost:** R2's free tier is 10 GB storage and 10 GB/month of the operations that matter for a photo-heavy app, plus **zero bandwidth cost** — a campus pilot's photos will very likely cost **$0/month**. Watch it as you grow; R2 storage beyond free tier is about $0.015/GB/month.

**If you set nothing here:** the backend keeps writing photos to local disk inside the container, exactly like it does on your Mac today. That's fine for a first smoke-test deploy, but **any redeploy or restart of the container will delete every photo** — a container has no permanent disk by default on most hosts. Don't demo to real users this way.

---

## 3. Every environment variable, what it does, and whether it's secret

Set these on whatever host runs the container (step 4). `.env.example` in this repo is the authoritative list — this table explains each one in plain language.

### Already existed (you may already have these from local dev)

| Variable | What it does | Secret? |
|---|---|---|
| `DATABASE_URL` | Your Postgres connection string from step 1. Leave empty only for local disk-based testing — never in a real deploy (see below). | **Yes** — contains a password |
| `PORT` | Which port the server listens on inside the container. Most hosts set this for you automatically; leave it alone unless yours says otherwise. | No |
| `DEV_LOGIN` | Enables the "switch test user" shortcut used for demos. **Set to nothing (or `0`) in production** — it lets anyone become any demo user with no password. | No, but must be off in production |
| `ALLOWED_EMAIL_DOMAINS` | Which campus email domains can sign up (e.g. `arizona.edu`). | No |
| `MODERATOR_USER_IDS` | Which user ID(s) can review reports. | No |
| `PLATFORM_FEE_PERCENT` | Your cut of a sale. | No |
| `PUBLIC_APP_URL` | The public address of this server — needed once you turn on real payments (Stripe sends sellers back here). Set it to your deployed URL, e.g. `https://api.yourdomain.com`. | No |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Real payments. Covered in `docs/HANDOFF.md` §3a — unrelated to this deploy guide except that they live in the same place. | **Yes** |

### New in this pass — object storage

| Variable | What it does | Secret? |
|---|---|---|
| `S3_BUCKET` | Name of the bucket from step 2. **Setting this is the on/off switch** — set it and the server uses S3-compatible storage; leave it empty and it uses local disk exactly like today. | No |
| `S3_REGION` | The region your provider expects. Cloudflare R2 and most non-AWS providers accept `auto`. Required once `S3_BUCKET` is set. | No |
| `S3_ENDPOINT` | The API endpoint from your provider (e.g. R2's `https://<account-id>.r2.cloudflarestorage.com`). Leave empty only for real AWS S3. | No |
| `S3_ACCESS_KEY_ID` | The access key from step 2. | **Yes** |
| `S3_SECRET_ACCESS_KEY` | The secret key from step 2. | **Yes** |
| `S3_PUBLIC_BASE_URL` | Optional. Set once your bucket (or a CDN/custom domain in front of it) is public — photo URLs then point straight at it instead of being relayed through your server. Leave empty to start; the app works either way. | No |

If you set `S3_BUCKET` but forget one of `S3_REGION`, `S3_ACCESS_KEY_ID`, or `S3_SECRET_ACCESS_KEY`, **the server refuses to start** and prints exactly which variable is missing — this is intentional, so a typo doesn't silently drop back to a container's disposable local disk.

### New in this pass — production hardening

| Variable | What it does | Secret? |
|---|---|---|
| `NODE_ENV` | Set to `production` when deployed. This turns on the origin allowlist below (`ALLOWED_ORIGINS`). Leave unset on your Mac. | No |
| `ALLOWED_ORIGINS` | Comma-separated list of web addresses allowed to call your API from a browser (e.g. if you ever build a companion website). **The iPhone app itself is not affected either way** — this only restricts browser-based (CORS) callers. Only enforced when `NODE_ENV=production`. Safe to leave empty for a phone-only pilot. | No |
| `RATE_LIMIT_AUTH_REQUEST_CODE_PER_MIN`, `RATE_LIMIT_AUTH_VERIFY_CODE_PER_MIN`, `RATE_LIMIT_CHECK_ADDRESS_PER_MIN`, `RATE_LIMIT_UPLOADS_PER_MIN` | How many times per minute, per visitor, someone can request a sign-in code, try a code, check a meetup address, or upload a photo, before getting a "slow down" message. Sane defaults are already built in — you only need these if you hit a real problem (too strict for legitimate use, or too loose against abuse). | No |

**Rule of thumb for "secret":** if it's a password, key, or token, it goes in your host's *secret/environment variable* manager, never in a file you commit to GitHub or paste into chat/Rork prompts.

---

## 4. Deploy the container

This repo now has a `Dockerfile` that builds and runs **only the backend API** (not the Expo app — that's built and shipped separately through Expo/Rork).

Any host that runs a Docker container from a `Dockerfile` in a GitHub repo works: **Render**, **Railway**, **Fly.io**, **Google Cloud Run**, others. Recommended for a first pilot because it's the least fiddly: **Render** or **Railway** — both can point directly at your GitHub repo and rebuild automatically on every push.

Generic steps (naming varies slightly by host, but the shape is identical everywhere):

1. Push this repo to GitHub if it isn't already there (see `docs/HANDOFF.md` §4 for the Rork → GitHub connection you may already have).
2. In your chosen host, create a new **Web Service** (Render) / **Service** (Railway) / **App** (Fly), and point it at this GitHub repo. Tell it to build from the `Dockerfile` at the repo root — most hosts auto-detect it.
3. Set the environment variables from the tables above (§3) in that host's dashboard — **not** in a file, and definitely not in `.env.example`.
4. Make sure the host maps whatever `PORT` it wants to the container's `PORT` — most hosts do this automatically and set `PORT` for you; if yours doesn't, set `PORT=3000` to match what's in `.env.example`.
5. Deploy. The container runs database migrations automatically every time it starts (see `backend/db/migrate.ts`, called from `backend/server.ts`) — you don't need a separate "run migrations" step or button. This is safe to happen on every restart/redeploy; each migration only ever runs once.
6. Once it's live, open `https://<your-service-url>/api/health` in a browser. You should see JSON with `"ok": true`. That confirms the database connected and the server is up. Check the `payments.mode` field is `"simulated"` unless you've deliberately turned on real payments (`docs/HANDOFF.md` §3a) — if it says anything else unexpectedly, stop and check your Stripe env vars.

**Cost:** Render and Railway both have hobby tiers around **$5–7/month** for a small always-on service (their free tiers exist but sleep when idle, which means the first request after a quiet spell is slow — fine for testing, not great for a pilot people are actively using). Fly.io has a similar small-instance price. Budget **roughly $5–10/month** for this piece.

### A note on local-disk mode in a deployed container

If you deploy without setting `S3_BUCKET`, the backend still runs — it just writes photos to a folder inside the container instead of an object storage bucket. **Every one of these hosts throws that disk away on redeploy or restart.** Fine for a five-minute smoke test right after deploying; not something to show real users. Set up object storage (§2) before anyone else touches the app.

The same warning applies to the database: if `DATABASE_URL` is empty, the backend falls back to the same on-disk PGlite database it uses on your Mac — which, inside a container, is just as disposable as local-disk photos. **Always set `DATABASE_URL` for a deployed backend.**

---

## 5. Point the phone app at your deployed API

The Expo app already reads one variable for this: `EXPO_PUBLIC_RORK_API_BASE_URL`.

1. Take the public URL your host gave you in step 4 (e.g. `https://campus-swap-api.onrender.com`).
2. Set `EXPO_PUBLIC_RORK_API_BASE_URL=https://campus-swap-api.onrender.com` (no trailing slash) wherever you build/publish the app — in Rork, this is an environment variable in the project's settings; for a plain Expo build it's the `.env` used at build time.
3. Rebuild/republish the app. Because this value is baked in at build time, changing it means a new build, not just a server restart.

This is exactly the same mechanism that currently points your phone at your Mac's LAN IP (`npm run env:lan`) — you're just changing it from "my laptop" to "the internet."

---

## 6. Pre-launch checklist

Go through this before letting anyone outside your test group use the app.

- [ ] `DATABASE_URL` is set to a real hosted Postgres (§1), verified with `npm run db:check`. Not empty, not `localhost`.
- [ ] `S3_BUCKET` and its companion variables are set (§2). Upload a test photo through the app and confirm it survives a redeploy of the backend.
- [ ] `NODE_ENV=production` is set on the deployed host.
- [ ] `DEV_LOGIN` is **not** set to `1` in production — the "switch test user" shortcut must be off before real users can sign up next to it.
- [ ] `EXPO_PUBLIC_RORK_API_BASE_URL` in the shipped app build points at your deployed API, not `localhost` or your Mac's LAN IP.
- [ ] `PUBLIC_APP_URL` matches your real deployed URL (only matters once payments are on).
- [ ] Visit `/api/health` on the deployed URL and confirm `"ok": true` and the payments mode is what you expect.
- [ ] Everything in `docs/HANDOFF.md` §3 ("Simulated or unfinished") still applies — deploying the backend does **not** turn on real payments, real email delivery, or anything else marked simulated there. Read that section again before a real launch, not just this one.
- [ ] Decide, in writing somewhere you'll remember, what campus/community you're piloting with and who is responsible for checking the moderation queue (`MODERATOR_USER_IDS`) — nothing technical enforces this, it's a people problem.
- [ ] If you expect more than a handful of concurrent users, re-read the rate-limiting note below — the built-in limiter is intentionally simple and has a real limitation once you scale.

---

## 6a. Will it hold up? Sizing for ~5,000 students a day

Short answer: yes, comfortably, on the smallest paid tier of anything listed above. Here is the actual arithmetic rather than a reassurance.

**What 5,000 daily active users means in requests.** A student opens the app, scrolls the grid, taps a few items, maybe sends a message — call it 20 requests a session. That is ~100,000 requests a day. Campus traffic is spiky (between classes, evenings), so assume the busiest hour carries 15% of the day and has bursts three times its own average inside it:

| | requests/second |
|---|---|
| Daily average | ~1.2 |
| Peak hour average | ~4.2 |
| Burst inside the peak hour | ~13 |

**What the backend actually does.** `npm run loadtest` builds a campus that has been running a semester — 15,000 users, 24,000 listings, 66,000 messages — and drives a browse-weighted mix at it. On the local WASM database, which is the slowest thing this code will ever run on, it sustains **~270 requests/second** with a p50 of 29ms. That is roughly 20x the burst figure above, on one process, on a laptop.

Real Postgres is faster per query and, unlike the local database, serves many connections at once. So the honest read is: **the database is not what limits you at 5,000 DAU.** Photo bandwidth and your object storage bill will matter sooner.

**What to actually provision:**

- **One backend instance** is enough. Do not turn on auto-scaling — you do not need it, and the rate limiter counts per-process (§7).
- **The smallest paid Postgres tier.** The whole dataset above is well under a gigabyte. Watch the *connection limit* rather than CPU: set `DB_POOL_MAX` so that `DB_POOL_MAX x number of instances` stays below it, with a few spare for you to connect with a database tool.
- **Object storage with a CDN in front.** Photos are the bulk of the bytes you will serve and the one cost that scales with users.

**Re-run the numbers against your real database before launch.** Point the same script at it:

```
DATABASE_URL='your-connection-string' npm run loadtest
```

That is the run that counts, because it is the only one that can show connection-pool and locking behaviour. Use a throwaway database — it writes tens of thousands of fixture rows.

**What overload actually looks like.** Worth knowing in advance, because it is not what most people expect. Driving the same dataset harder and harder:

| Simultaneous requests | Throughput | Typical response | Slowest 1% |
|---|---|---|---|
| 8 | 282/s | 28ms | 47ms |
| 16 | 284/s | 55ms | 89ms |
| 32 | 283/s | 110ms | 311ms |
| 64 | 278/s | 211ms | 2.1s |
| 128 | 285/s | 279ms | 8.5s |

Throughput stops improving almost immediately — the backend is already at capacity around 8 simultaneous requests, and everything past that is queueing. Note the last column: **nothing fails, it just gets slower, without limit.** There are no errors in any of those runs. So an overloaded backend does not announce itself with a crash or a red graph; it announces itself with users saying the app "feels slow", while every health check still passes.

For context, 5,000 DAU bursts to roughly 13 simultaneous requests. You have about 20x headroom, and real Postgres is faster than the local database these numbers came from. This is a thing to recognise if it ever happens, not a thing to solve now.

**The signals to watch once you are live**, in the order they will bite:

1. Response times creeping up while traffic is flat — usually a query that lost its index.
2. "too many connections" errors — `DB_POOL_MAX` too high for your tier, or too many instances.
3. Storage bandwidth cost — photos, and the first bill that grows faster than users.

---

## 7. A blunt limitation: rate limiting and multiple instances

To stop abuse (someone hammering the sign-in code endpoint, spamming the free address-lookup service, or a phone stuck in a retry loop hitting the main API), the backend counts requests **in its own memory**, per caller, per minute.

"Per caller" is deliberately not "per IP". Several hundred students on campus wifi share a single NAT address, so a per-IP limit would treat the whole building as one abusive visitor and throttle everyone at exactly the busiest time of day. Signed-in requests are counted against the session instead, and only anonymous traffic falls back to the IP address.

This works great for a single running copy of the backend — which is what every host above gives you by default on a hobby/starter tier. **It stops working correctly if you ever run more than one copy at once** (e.g. you turn on "auto-scaling" or "multiple instances" on your host to handle more traffic): each copy counts separately, so the *real* limit becomes however many copies are running times the intended limit, and a determined abuser can dodge it by landing on a different copy each time.

You will very likely not hit this for a campus pilot. If you ever do turn on multiple instances, the fix is to swap this in-memory counter for a shared one — a small hosted service like **Upstash Redis** (has a free tier, a few minutes to wire up) is the standard fix, or your hosting provider's own edge/proxy-level rate limiting if it has one. That's a small follow-up task for whoever's doing engineering work at that point, not something to solve now.

---

## 8. What this pass did *not* change or fix

To be precise about scope, so nothing here is mistaken for having been checked:

- The Expo/iPhone app itself is unchanged — this is entirely a backend deploy story.
- Real Stripe payments are untouched; see `docs/HANDOFF.md` §3a for that separate checklist.
- Real email delivery for sign-in codes is still simulated (printed to the server's logs, which you can view in your host's dashboard) — nobody receives an actual email yet. That's a separate piece of work (an email-sending provider, another signup) not covered here.
- The free geocoding service used for custom meetup addresses (`backend/geocode.ts`, OpenStreetMap Nominatim) is unchanged — this pass added rate limiting in front of it to reduce the chance of tripping its usage policy, but did **not** replace it with a paid provider. Still fine for pilot volume; revisit before real traffic, per `docs/HANDOFF.md`.
