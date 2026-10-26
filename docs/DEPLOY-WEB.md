# Website operations guide (trydibbs.com on Netlify)

How the Dibbs website is hosted, how it gets redeployed, and how to check it.
The API, database, photos and email are in `docs/DEPLOY.md`.

Status below was checked in the dashboards on Oct 25-26, 2026.

---

## 1. What is live

There is **one website**, at **https://trydibbs.com**. The old waitlist site is gone
from the domain, and the app no longer lives on its own subdomain.

| Piece | Setting |
|---|---|
| Host | **Netlify**, project `dibbs-app-web` |
| Source | Auto-builds from GitHub `main` (`caspatore-arch/charlie-marketplaceapp`). Pull requests get **deploy previews**. |
| Build | `npm run web:build` (`expo export --platform web`) into `dist/`, set in `netlify.toml` |
| Domains | `trydibbs.com` is primary. `www.trydibbs.com` and `app.trydibbs.com` redirect to the same path on the root (301, from `public/_redirects`). |
| DNS | Cloudflare (registrar and DNS). Netlify web records are **DNS only** (not proxied). |
| API it talks to | `https://api.trydibbs.com` (Render, see `docs/DEPLOY.md`) |

What a visitor sees:

- **First visit, signed out:** the front door (`app/welcome.tsx`) with **Create
  account** and **Log in** tabs.
- **Create account:** email, 6-digit code, name and age/Terms, then **Make your
  profile** (`app/create-profile.tsx`, "Skip for now" allowed), then the feed.
- **Log in:** email, code, straight to the feed. Any email can sign in; a campus
  email unlocks selling, offers, booking and posting.
- **Signed in:** `trydibbs.com` opens the feed directly.
- **Shared listing links** (`trydibbs.com/listing/...`) open for anyone.

---

## 2. Build-time variables (the one thing that trips people up)

The website is a static folder of files. There is no server on the host, so
**`EXPO_PUBLIC_*` variables are baked in at build time**. Changing one in the
dashboard changes nothing until you trigger a new build.

Set in the **Netlify build environment** (Site configuration, Environment variables):

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_RORK_API_BASE_URL` | `https://api.trydibbs.com` (no trailing slash) |
| `EXPO_PUBLIC_WEB_BASE_URL` | `https://trydibbs.com` (used for share links; `netlify.toml` also sets it) |

Only `EXPO_PUBLIC_*` values reach the app, so never put a secret in one.

## 3. Redeploy and roll back

- **Normal path:** push or merge to `main`; Netlify builds and publishes. Open a PR
  to get a deploy preview URL to check first.
- **Manual / after changing a build variable:** Netlify, `dibbs-app-web`, Deploys,
  Trigger deploy, "Clear cache and deploy".
- **Roll back:** Netlify, Deploys, open an earlier good deploy, "Publish deploy".
  Instant, and it does not touch the API or database.
- **Local build (debugging only):** `npm run web:build` writes `dist/`. It is not
  committed and is not how production is deployed.

## 4. Backend must allow the site (CORS)

If the website loads but nothing works (no listings, sign-in fails, uploads fail),
the browser console will show a CORS error like
`Access to fetch at 'https://api.trydibbs.com/...' ... has been blocked by CORS policy`.

Fix it on **Render** (`dibbs-api`): `ALLOWED_ORIGINS` must include every origin the
site is served from, comma-separated, for example
`https://trydibbs.com,https://www.trydibbs.com`. It is only enforced when
`NODE_ENV=production`. Deploy previews use other origins (`*.netlify.app`); add one
only if you need to test against production from a preview. Check
`/api/health` afterwards.

## 5. Hosting config files in the repo

- `netlify.toml`: build command, publish directory, `EXPO_PUBLIC_WEB_BASE_URL`, and
  the SPA rewrites.
- `public/_redirects`: host redirects (`app` and `www` to the root) and the SPA
  fallback. Netlify runs it before `netlify.toml`, so the host redirects must stay
  above the catch-all.

The single-page-app fallback matters: a shared link such as `/listing/abc` must
return the app, not a 404.

## 6. Verify

- [ ] `https://trydibbs.com` in a private window on an iPhone: the front door with
  **Create account** and **Log in**. Sign in with a real inbox and confirm the code
  arrives, then you land on the feed.
- [ ] **Open a listing URL directly** in a new tab (and hard-refresh it). It must show
  the listing, not a 404. This proves the SPA rewrite is working.
- [ ] `https://app.trydibbs.com/listing/anything` and `https://www.trydibbs.com/...`
  change the address bar to `trydibbs.com/...`.
- [ ] Tap Share on a listing: the native share sheet appears on iPhone Safari, and
  the copied link opens the listing.
- [ ] Photo upload: only trust it if `docs/DEPLOY.md` section 4 (R2) is done;
  otherwise photos can disappear on the next API redeploy.

## 7. Not covered here

- **Real SMS and payments:** still simulated (`docs/DEPLOY.md` section 8,
  `docs/HANDOFF.md` section 3a).
- **App Store / TestFlight:** the native app is a separate path (`docs/APP-STORE.md`).
