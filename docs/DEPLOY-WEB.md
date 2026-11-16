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
| Build | `npm run web:build` (`expo export --platform web`, then `scripts/prerender-public.ts`) into `dist/`, set in `netlify.toml` |
| Domains | `trydibbs.com` is primary. `www.trydibbs.com` and `app.trydibbs.com` redirect to the same path on the root (301, one hop, from `public/_redirects`). |
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

- `netlify.toml`: build command, publish directory, `EXPO_PUBLIC_WEB_BASE_URL`,
  caching and security headers. It holds no redirects.
- `public/_redirects`: all redirects. Netlify runs it first.
- `scripts/prerender-public.ts` (run by `npm run web:build`): writes real HTML for
  `/about`, `/why-dibbs`, `/faq`, `/legal/terms`, `/legal/privacy` and `dist/404.html`.

**Redirect design.** The app is one app shell, so the host must serve it for every
real route, but not for URLs that are not routes (otherwise typos and missing files
answer 200 and look like soft 404s to Google). `_redirects` therefore has, in order:
host redirects (app. and www., http and https, one hop to `https://trydibbs.com`);
`200!` rewrites for the five prerendered pages; one 200 rewrite per real route in
`app/` (dynamic routes use a splat such as `/listing/*`); and a last rule
`/*  /404.html  404`. `404.html` is the app shell with `noindex`, so someone who
opens a route missing from the list still gets a working app; only the status code
is 404. When you add a screen in `app/`, add its URL to the list. Real files
(`/_expo/*`, `/assets/*`, `/favicon.ico`, `/robots.txt`) are served first and need
no rule.

Headers in `netlify.toml`: one-year immutable caching for `/_expo/*` and `/assets/*`
(hashed names); `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
`Permissions-Policy` and an enforced `Content-Security-Policy: frame-ancestors 'none'`
on everything. The full CSP is `Content-Security-Policy-Report-Only`: it blocks
nothing and only logs to the browser console. HSTS is unchanged.

**Confirm on a deploy preview before production.** None of this was run on Netlify
when written (local checks serve `dist/` with a plain static server and cannot
exercise redirect rules). On the preview, check:
`curl -sI` shows 404 for `/nope` and `/manifest.json` and 200 for `/about`, `/faq`,
`/listing/abc`, `/sell`, `/dibbs-offer/new`, `/staff/dibbs-offers`; `/about/` does
not redirect in a loop and `/about` does not redirect to `/about/`; each page's
`<title>` and canonical differ; `/_expo/...js` has `immutable`; the headers appear on
`/`; the console shows no errors on the home page, a listing, Sell and sign-in; and
CSP Report-Only messages are noted (expect some, that is its purpose).

## 6. Verify

- [ ] `https://trydibbs.com` in a private window on an iPhone: the front door with
  **Create account** and **Log in**. Sign in with a real inbox and confirm the code
  arrives, then you land on the feed.
- [ ] **Open a listing URL directly** in a new tab (and hard-refresh it). It must show
  the listing, not a 404. This proves the SPA rewrite is working.
- [ ] A made-up URL such as `/nope` returns a real 404 (`curl -sI`) but the page still loads the app.
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
