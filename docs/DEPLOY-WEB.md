# Deploying the website (for the founder, not an engineer)

This guide gets the **Dibbs website** — the student-facing pages that run in any browser, including iPhone Safari — onto the internet. It covers the web front-end only: the HTML, JavaScript, and image files that your visitors download.

The **backend API** (the server your app talks to) is a separate thing covered in `docs/DEPLOY.md`. Read that document first and follow it completely before starting here. The website needs a running API to actually work, and you need to know the API's public URL before you can build the site.

Budget **an afternoon** the first time.

---

## 0. Why the order matters

The website is a static package — a folder of files that a hosting service delivers to browsers. Unlike a traditional web app, there is no server running on the host. That means:

**Environment variables are baked in at build time, not read at runtime.**

This is the single thing that trips people up most often. When you run `npm run web:build` on your Mac, Metro (the JavaScript bundler) finds every variable that starts with `EXPO_PUBLIC_` in your `.env` file and hard-codes the values into the JavaScript files. After the build, those values are frozen. If you change an environment variable on the hosting dashboard after uploading the files, **nothing changes** — the files already have the old value baked in and you must rebuild and re-upload.

The practical consequence: **set your environment variables correctly before you build**, not after.

---

## 1. Make sure the backend is deployed first

Follow `docs/DEPLOY.md` completely. When you are done, you will have:

- A public backend URL (e.g. `https://dibbs-api.onrender.com`). You need this in step 2.
- A running API that returns `{"ok":true}` at `https://dibbs-api.onrender.com/api/health`.

Do not continue until that health check passes.

---

## 2. Set your build-time environment variables

In the root of this repo, open (or create) a file called `.env`. This file is already listed in `.gitignore` — it will not be committed to GitHub, which is correct because some of its values are secrets.

Add or update these three lines (the rest of `.env` can stay as-is from your local dev setup):

```
EXPO_PUBLIC_RORK_API_BASE_URL=https://dibbs-api.onrender.com
EXPO_PUBLIC_WEB_BASE_URL=https://dibbs.yourdomain.com
```

Replace both placeholder URLs with your real ones:

- **`EXPO_PUBLIC_RORK_API_BASE_URL`** — the public backend URL from step 1. No trailing slash.
- **`EXPO_PUBLIC_WEB_BASE_URL`** — the URL the website will have once you deploy it (step 4). You need to choose your host and know its URL before you build. See step 3 to pick a host and find out what URL it gives you.

You can leave `EXPO_PUBLIC_WEB_BASE_URL` unset for now and the site will still work — share links will just use whatever URL the browser shows. Set it before your final launch so share links look like `https://dibbs.yourdomain.com/listing/…` instead of your host's default subdomain.

---

## 3. Choose a hosting provider

Pick one. All three are free to start and accept the same build output. The repo ships a ready-made configuration file for each one.

| Provider | Config file in this repo | Free plan | Notes |
|---|---|---|---|
| [Vercel](https://vercel.com) | `vercel.json` | Yes, generous | Connects to GitHub, redeploys on every push — recommended if the repo is on GitHub |
| [Netlify](https://netlify.com) | `netlify.toml` | Yes | Same GitHub-connect model; also supports drag-and-drop if you prefer |
| [Cloudflare Pages](https://pages.cloudflare.com) | `public/_redirects` | Yes, very generous | Good choice if you already use Cloudflare for DNS |

All three serve static files from a CDN automatically — no server configuration, no monthly instance fee for the web part. (You still pay for the backend API from `docs/DEPLOY.md`.)

---

## 4. Build the static site

On your Mac, in the repo folder, run:

```
npm run web:build
```

This runs `expo export --platform web` and produces a folder called `dist/`. That folder is your entire website — every `.html`, `.js`, image, and font file that browsers need. You only need to do this when you want to ship a new version; the `dist/` folder is not committed to GitHub.

The build takes a minute or two. When it finishes, you should see a `dist/` folder in the repo with an `index.html` inside it.

---

## 5. Deploy to your chosen host

### Option A — Vercel (recommended if the repo is on GitHub)

1. Push this repo to GitHub if it isn't already (`docs/HANDOFF.md` §4 covers the Rork → GitHub connection).
2. Sign up / log into [vercel.com](https://vercel.com) and click **Add New → Project**.
3. Connect your GitHub account and pick this repo.
4. Vercel will auto-detect the `vercel.json` and set the build command (`npm run web:build`) and output directory (`dist`) for you. Confirm and click **Deploy**.
5. Vercel gives you a URL like `https://your-project-name.vercel.app` as soon as the deploy finishes. That's your site.

### Option B — Netlify (also GitHub, or drag-and-drop)

**Via GitHub:**
1. Sign up / log into [netlify.com](https://netlify.com) and click **Add new site → Import an existing project**.
2. Connect GitHub and pick this repo. Netlify reads `netlify.toml` and pre-fills everything.
3. Click **Deploy site**.

**Drag-and-drop (no GitHub required):**
1. Run `npm run web:build` on your Mac (step 4).
2. Go to [app.netlify.com](https://app.netlify.com), log in, drag the whole `dist/` folder onto the drop zone on the dashboard.
3. Done — Netlify gives you a URL immediately.

### Option C — Cloudflare Pages

1. Log into the Cloudflare dashboard, go to **Workers & Pages → Create application → Pages**.
2. Connect your GitHub repo, or use the **Direct Upload** option to upload the `dist/` folder from step 4.
3. If connecting GitHub, set the build command to `npm run web:build` and the output directory to `dist`.
4. Deploy.

---

## 6. Tell the backend about the website (CORS)

This step is easy to miss and produces a confusing error.

**What happens if you skip it:** every API call from the website fails silently. The site loads, but nothing works — no listings appear, sign-in fails, uploads fail. In the browser's developer tools (open with right-click → Inspect → Console), you will see errors that say something like:

> `Access to fetch at 'https://dibbs-api.onrender.com/…' from origin 'https://dibbs.yourdomain.com' has been blocked by CORS policy`

**The fix:** go to your backend host's dashboard (Render, Railway, etc.) and add an environment variable:

```
ALLOWED_ORIGINS=https://dibbs.yourdomain.com
```

Replace the placeholder with the exact URL your site has. If you have multiple URLs (e.g. the host's default subdomain and a custom domain), separate them with commas:

```
ALLOWED_ORIGINS=https://dibbs.yourdomain.com,https://your-project.vercel.app
```

After saving, the backend will restart automatically on most hosts. Check the health endpoint again (`/api/health`) to confirm it is still up.

---

## 7. Set the share-link URL (optional but recommended before launch)

Share links (the button on a listing page) use `EXPO_PUBLIC_WEB_BASE_URL` to produce a correct `https://` URL. If you left it unset in step 2, go back, add it to `.env`, and rebuild (`npm run web:build`) and redeploy.

You only need to do this once. After that, every share link a student sends will look like `https://dibbs.yourdomain.com/listing/…` and open the listing page directly.

---

## 8. Check that it actually worked

Go through this list after deploying. None of it requires a terminal.

- [ ] Open the site URL on an iPhone in Safari. You should see the listing feed.
- [ ] **Hard-refresh a listing URL directly.** This is the most important test. Copy a listing URL (e.g. `https://dibbs.yourdomain.com/listing/some-id`), paste it into a new browser tab, and open it. It should show the listing — not a 404 page. If you get a 404, the SPA rewrite rule isn't working and shared links will be broken for everyone. (The `vercel.json`, `netlify.toml`, and `public/_redirects` files in this repo are the fix — make sure your host is actually reading the right one.)
- [ ] Sign in with a `@arizona.edu` email address. You should receive a sign-in code (note: email delivery is still simulated — the code is printed to the backend server's logs, viewable in your host's dashboard; see `docs/DEPLOY.md` §8 for the full list of what's still simulated).
- [ ] Tap the share button on a listing. On iPhone Safari you should see the native share sheet. Copy the link and paste it into a new tab — it should open the listing, not a 404.
- [ ] Upload a photo on a new listing. Confirm the photo appears in the listing. If it doesn't, the backend's object storage config needs attention (`docs/DEPLOY.md` §2).

---

## 9. What this guide did *not* cover

- **Custom domain** — all three hosts let you connect your own domain name for free, but the steps differ per host. Their own documentation covers it; once the site is working on the host's default URL, adding a domain is straightforward.
- **Real email delivery** — sign-in codes are still printed to the backend logs, not emailed. This is fine for testing but needs a mail-sending provider before real users can sign up independently. Covered in `docs/HANDOFF.md`.
- **App Store / TestFlight** — the iPhone app (native build) is a completely separate path through Expo / Rork / App Store Connect. This guide is the website-first launch only.
