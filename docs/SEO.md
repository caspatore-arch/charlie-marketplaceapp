# Getting found on Google and ChatGPT

The 9-item "get-found" checklist, applied to trydibbs.com (2026-11-01).

## Done in code (all in `public/`)

| # | Item | Where |
|---|------|-------|
| 2 | Sitemap | `public/sitemap.xml`. Add any new public page here. |
| 3 | Real title and description | `public/index.html` `<head>`. Expo uses this file instead of its blank template. |
| 4 | Preview image for shares | `public/og-image.png` (1200x630) plus the `og:` and `twitter:` tags. |
| 5 | Readable without JavaScript | The text inside `<div id="root">` in `public/index.html`. The app replaces it on load; crawlers that don't run JS read it. Keep it accurate. |
| 6 | AI bots allowed | `public/robots.txt` names GPTBot, ClaudeBot, PerplexityBot and others; `public/llms.txt` is a plain summary for AI tools. |

Every route serves the same `index.html` (single-page app), so `/about` shares the
homepage title in search results. If that ever matters, switch `web.output` to
`"static"` in `app.json`, which needs testing on every screen.

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
