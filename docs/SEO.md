# Getting found on Google and ChatGPT

The 9-item "get-found" checklist, applied to trydibbs.com (2026-11-01), plus the
per-page prerender, FAQ and header work (2026-11-16).

## Done in code

| Item | Where |
|------|-------|
| Sitemap (real public pages only, with lastmod) | `public/sitemap.xml` |
| Homepage title, description, share tags, structured data | `public/index.html` `<head>` |
| Own title, description, canonical, share tags and readable text for `/about`, `/why-dibbs`, `/faq`, `/legal/terms`, `/legal/privacy` | `scripts/prerender-public.ts` writes `dist/<page>/index.html` after `expo export` |
| FAQ (12 questions, plain answers) and `FAQPage` structured data | `scripts/content/faq.ts`, shared by `app/faq.tsx` and the script, so the screen and the structured data cannot differ |
| Legal text readable without JavaScript | the script imports `constants/legal.ts`, the same module the app screens render |
| Real 404 for unknown URLs (no soft 404s) | `public/_redirects` lists every real route and ends with `/*  /404.html  404`; the script writes `dist/404.html` (app shell plus `noindex`) |
| Preview image for shares | `public/og-image.png` (1200x630) plus `og:` and `twitter:` tags |
| AI bots allowed, plain summary for AI tools | `public/robots.txt` (one group), `public/llms.txt` |
| Web manifest and home-screen icon | `public/manifest.json`, `public/apple-touch-icon.png` |
| Long caching for hashed files, security headers | `netlify.toml` `[[headers]]` |

The site is still a single-page app (`web.output` stays `single`). The prerender
step only adds files; the app replaces the readable text inside `<div id="root">`
when it boots, the same way the homepage already worked.

## Adding a public page

1. Build the screen in `app/` and add it to `public/_redirects` (the prerendered
   pages section, with the `200!` rule).
2. Add its copy to `scripts/content/` (or import an existing shared module) and add
   a `PageSpec` to `pages` in `scripts/prerender-public.ts`. Exactly one `<h1>`.
3. Add it to `public/sitemap.xml` with a real `lastmod`, to `public/llms.txt`, and
   to the link row in `public/index.html` and `NAV` in the script.
4. Run `npm run web:build` and check `dist/<page>/index.html` (title, canonical, one h1).
5. If the page is private or signed-in only, do none of the above; add it to
   the `_redirects` app-route list and to the `Disallow` list in `public/robots.txt`.

The about and why-dibbs text is kept twice on purpose: on screen in
`app/about.tsx` and `app/why-dibbs.tsx`, and as crawlable text in
`scripts/content/pages.ts`. Change both together.

## Needs the owner

1. **Google Search Console** (item 1). Go to search.google.com/search-console, add
   the *Domain* property `trydibbs.com`, and add the TXT record it gives you in
   Netlify DNS. Then open Sitemaps and submit `https://trydibbs.com/sitemap.xml`.
   Do the same in Bing Webmaster Tools (it can import from Search Console); Bing
   feeds ChatGPT search.
2. **10 directories** (item 7). Backlinks get you off page 9. Start with: Product
   Hunt, BetaList, AlternativeTo (as an alternative to Facebook Marketplace and
   OfferUp), the UArizona student org / Tech Launch Arizona resources, Tucson
   startup lists, Crunchbase, LinkedIn company page, Instagram bio link, Reddit
   r/UofArizona (post once, no spam), and the Google Business Profile.
3. **One real keyword** (item 8). The page now targets "buy and sell used stuff at
   the University of Arizona". Close cousins worth a page each later:
   "University of Arizona dorm furniture", "UArizona textbooks for sale",
   "Tucson move-out sale".
4. **One blog post a week** (item 9). Not built. A post such as "What to sell at
   UArizona move-out" needs a blog section that renders as plain HTML; ask for it
   when you're ready.

## Still open

- **Per-listing titles and share previews.** Each listing URL shares the app
  shell. Fixing it needs a Netlify edge function (or a prerender against the API),
  and listings only live 24 hours in Browse, so the payoff is mainly link previews
  when someone shares a listing. Recommended: an edge function for `/listing/*`
  that reads the public listing and fills title, description and `og:image`.
- **Bing and Search Console verification** (owner, see above).
- **Home-screen icon.** `public/apple-touch-icon.png` is the 1024px app icon and
  has a transparent background, which iOS draws on black. Export a 180px and a
  512px opaque version when convenient.
- **Enforcing the Content-Security-Policy.** Only `frame-ancestors` is enforced.
  The full policy is Report-Only in `netlify.toml`; watch the browser console on a
  deploy preview before changing that.
