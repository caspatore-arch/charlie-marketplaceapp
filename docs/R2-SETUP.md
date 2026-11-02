# Finish Cloudflare R2 photo storage (owner guide)

Written 2026-11-01. You do every step below yourself in the Cloudflare and Render
dashboards. **Paste keys straight into Render. Never into chat, email or a doc.**
Nothing here changes code. (R2 = Cloudflare's file storage, "S3-compatible",
meaning the app talks to it the same way it would talk to Amazon S3.)

## 1. Why it isn't done, and what breaks today

- **What's missing:** the bucket `dibbs-photos` exists (created about Oct 25), but
  none of the `S3_*` variables were ever added to the `dibbs-api` service on Render.
  Evidence: `docs/PROJECT-DIRECTIVES.md` ("Production as of 2026-10-26" and work-queue
  item 4) and `docs/DEPLOY.md` section 4 both say so. The code switches on one
  thing: `backend/storage.ts` uses R2 only if `S3_BUCKET` is set; otherwise it writes
  to the server's own disk.
- **Why it stalled:** I found no note or commit explaining it. The remaining steps
  (create a key, paste it into Render) can only be done by you, so my best guess is
  they were waiting on you. That's an inference.
- **What breaks today:** Render wipes the server's disk on every redeploy or restart.
  Every uploaded listing photo then disappears and shows as broken. Render's Free
  plan also restarts the service after idle time. Don't tell students photos are
  safe until step 5 passes.
- **I couldn't look at your dashboards.** Cloudflare wasn't signed in, in the browser
  I can use, so I didn't check Render or Cloudflare. Everything about their current
  state comes from the repo docs, not a live look.

## 2. Cloudflare steps

1. Sign in at dash.cloudflare.com, then go to **R2 object storage → Overview**.
2. **Confirm the bucket `dibbs-photos` exists.** Don't change its settings yet.
3. **Create a second bucket** called `dibbs-private` (button **Create bucket**,
   leave the defaults). This holds the private "Get a Dibbs offer" photos and videos.
   **Never turn on public access for this bucket**, not r2.dev and not a custom
   domain. Check its Settings: "Public Development URL" must say Disabled.
4. **Copy your Account ID.** It's on the R2 Overview page (right side, "Account
   Details"). Your endpoint (the address the app talks to) is
   `https://<account-id>.r2.cloudflarestorage.com`.
5. **Create the key.** On the same page, **Account Details → API Tokens → Manage**,
   then **Create Account API token**:
   - Permission: **Object Read & Write**
   - Scope it to **only** `dibbs-photos` and `dibbs-private` (the app uses one key
     for both buckets, so it must cover both).
   - Create it. You'll see an **Access Key ID** and a **Secret Access Key**. The
     secret is shown **once**. Keep that tab open and go straight to step 3 below.
     If you lose it, delete the token and make a new one.
6. **Public access for `dibbs-photos`: your choice.** See "Decisions" below. You
   can skip this entirely for now and the app still works.

## 3. Render steps

Render dashboard → service `dibbs-api` → **Environment** → add these. Saving
triggers an automatic redeploy.

| Name | Value |
|---|---|
| `S3_BUCKET` | `dibbs-photos`. **This is the on switch.** |
| `S3_REGION` | `auto` (R2's way of saying "no region") |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY_ID` | the Access Key ID from step 2.5 (secret) |
| `S3_SECRET_ACCESS_KEY` | the Secret Access Key from step 2.5 (secret) |
| `S3_PRIVATE_BUCKET` | `dibbs-private`. Recommended always; **required** if you also set `S3_PUBLIC_BASE_URL`, otherwise private uploads are refused |
| `S3_PUBLIC_BASE_URL` | **Leave empty for now.** Only set it later if you choose public photos (see Decisions), e.g. `https://photos.trydibbs.com` with no trailing slash |
| `PRIVATE_MEDIA_SECRET` | Optional but recommended. 32+ random characters. Without it, the "link to a private photo" key changes at every restart, so open pages show broken private photos until the app fetches fresh links. Generate on your Mac: `openssl rand -hex 32` and paste the result into Render only |
| `DIBBS_STAFF_USER_IDS` | Comma-separated user ids of the people who may review Dibbs offers. Find an id in Neon's SQL editor: `select id, email from users where email = 'you@example.com';` |
| `DIBBS_OFFERS_EMAIL` | The team inbox that gets "new request" alerts. Not secret, never shown in the app |

Notes:
- The last three rows belong to the "Get a Dibbs offer" feature (draft PR #12, not
  merged). Adding them early is harmless; nothing reads them until that code ships.
- **If any of `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` is missing while
  `S3_BUCKET` is set, the server refuses to start** and the log names the missing
  variable (`backend/env.ts`, `validateS3Env`). That's deliberate: a typo can't
  quietly fall back to the disk that gets wiped. Check Render's **Logs** tab if the
  deploy fails.
- A *wrong value* (e.g. a typo in the endpoint) does **not** crash startup. It shows
  up as upload failures ("That upload could not be saved") in step 5.

## 4. Order of operations

1. Cloudflare steps 2.1–2.5 (two buckets, token).
2. Render: add all the variables in **one save**, so you get one redeploy.
3. Watch the deploy in Render until it says Live.

## 5. Verify

1. Open `https://api.trydibbs.com/api/health` (first load can be slow on the Free
   plan). You should see `"ok": true`. Note: health does **not** report storage, so
   a healthy result alone doesn't prove R2 works.
2. In the app or on trydibbs.com, sign in and create a listing with a photo.
   Confirm it shows. In Cloudflare → R2 → `dibbs-photos` → Objects, a new file
   should appear. **That's the real proof the switch is on.**
3. In Render, **Manual Deploy → Deploy latest commit** (or **Restart**). Wait for
   Live, reload the listing: the photo must still load. (Before R2, it vanished.)
4. Private check (only once the Dibbs offer code is deployed): submit a test request
   with a photo, then copy that photo's address from the staff screen.
   - Open it with the `&s=...` signature part chopped off, or run
     `curl -i "https://api.trydibbs.com/api/private-media/<id>"`. Expect **403**
     ("This link has expired…"), per `backend/hono.ts`.
   - Also try `https://<account-id>.r2.cloudflarestorage.com/dibbs-private/private/<file>`
     in a browser. You must **not** be able to see the picture (an access-denied
     error is expected).
5. If uploads show an error: re-check each variable for typos or stray spaces, then
   the token's bucket scope (step 2.5).

## 6. Decisions for you

- **Public photos or not?** The app works either way.
  - **Leave `S3_PUBLIC_BASE_URL` empty (recommended to finish today).** Photos are
    stored in R2 but served through the API. Zero extra setup and the bucket stays
    fully private. Cost: every photo view uses your Render server's bandwidth and
    memory, which is a real limit on the Free plan if the app gets busy.
  - **Custom domain later, e.g. `photos.trydibbs.com`.** In R2 → `dibbs-photos` →
    Settings → **Custom Domains → Add**. Cloudflare serves the photos directly (fast,
    free egress). It needs `trydibbs.com` to be a zone in the same Cloudflare account.
    I believe it is (DNS was rechecked 2026-10-26), but check. Then set
    `S3_PUBLIC_BASE_URL=https://photos.trydibbs.com` and make sure `S3_PRIVATE_BUCKET`
    is already set. **Switching later is safe**: older photos saved as
    `/api/uploads/...` keep working through the API.
  - **Avoid the `r2.dev` address** for production. Cloudflare says it's rate-limited
    and for development only.
- **Cost.** Per Cloudflare's pricing page (read 2026-11-01): free tier is 10 GB
  stored, 1 million "write-type" operations and 10 million "read-type" operations a
  month. Beyond that storage is $0.015 per GB-month, and sending data out to the
  internet is free. Campus photos should fit the free tier at pilot scale, but
  Cloudflare may ask for a payment method on the account. Verify the numbers in the
  dashboard before relying on them.
- **Old photos.** Anything uploaded before this switch is already gone; those
  listings will need new photos. I did not check the production database.
- **Update the docs** afterward: once step 5.3 passes, `docs/DEPLOY.md` and
  `docs/PROJECT-DIRECTIVES.md` still say "not set", so tell the coordinator session.
