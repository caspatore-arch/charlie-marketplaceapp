/**
 * Runs after `expo export --platform web` (see "web:build" in package.json).
 *
 * The site is a single-page app, so Expo writes ONE html file. That left
 * every URL with the homepage's title and no text before JavaScript runs.
 * This script takes dist/index.html as a template and writes a real HTML
 * file per public page, each with its own title, description, canonical,
 * share tags, structured data and readable fallback text inside <div id="root">.
 * The app replaces that text when it boots, exactly as it does on the homepage
 * (public/index.html), so nothing about how the app mounts changes.
 *
 * It also writes dist/404.html: the same app shell marked noindex, used by
 * `/*  /404.html  404` in public/_redirects.
 *
 * Text sources (so copy cannot drift):
 *  - legal pages: constants/legal.ts, the same module the app screens render;
 *  - FAQ: scripts/content/faq.ts, shared with app/faq.tsx;
 *  - about / why-dibbs: scripts/content/pages.ts (owned here, see its header).
 *
 * Idempotent (it never edits dist/index.html), and it exits non-zero if the
 * template or any expected marker is missing. To add a page: docs/SEO.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DRAFT_BANNER,
  LAST_UPDATED,
  OPERATOR_CONTACT_EMAIL,
  PRIVACY_SECTIONS,
  PRIVACY_SUMMARY,
  PRIVACY_TITLE,
  TERMS_SECTIONS,
  TERMS_SUMMARY,
  TERMS_TITLE,
  type LegalSection,
} from '../constants/legal';
import { FAQ, FAQ_DESCRIPTION, FAQ_HEADING, FAQ_INTRO, FAQ_TITLE } from './content/faq';
import { ABOUT, WHY, type SimplePage } from './content/pages';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ORIGIN = 'https://trydibbs.com';

interface PageSpec {
  /** URL path without trailing slash, e.g. "/about". */
  path: string;
  title: string;
  description: string;
  ogDescription: string;
  /** Inner HTML of the fallback <main>; must contain exactly one <h1>. */
  body: string;
  jsonLd: object[];
}

function fail(message: string): never {
  console.error(`prerender-public: ${message}`);
  process.exit(1);
}

/** Escapes text for HTML content and double-quoted attributes. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON for a <script type="application/ld+json"> block; `<` is escaped so text can never close the tag. */
function jsonLdScript(graph: object[]): string {
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n    </script>`;
}

/** Keeps meta descriptions near what search results show (about 160 characters), cutting at a word. */
function clip(text: string, max = 160): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}\u2026`;
}

const NAV = `<p>
            <a href="/">Browse listings</a> &middot; <a href="/about">How Dibbs works</a> &middot;
            <a href="/why-dibbs">Why Dibbs</a> &middot; <a href="/faq">FAQ</a> &middot;
            <a href="/legal/terms">Terms</a> &middot; <a href="/legal/privacy">Privacy</a>
          </p>`;

function paragraphs(lines: string[]): string {
  return lines.map((line) => `<p>${esc(line)}</p>`).join('\n          ');
}

function simpleBody(page: SimplePage): string {
  return [
    `<h1>${esc(page.h1)}</h1>`,
    `<p>${esc(page.intro)}</p>`,
    ...page.sections.map((s) => `<h2>${esc(s.heading)}</h2>\n          <p>${esc(s.body)}</p>`),
    NAV,
  ].join('\n          ');
}

function legalBody(title: string, summary: string[], sections: LegalSection[]): string {
  return [
    `<h1>${esc(title)}</h1>`,
    `<p>${esc(DRAFT_BANNER)}</p>`,
    `<p>Last updated: ${esc(LAST_UPDATED)}. Contact: ${esc(OPERATOR_CONTACT_EMAIL)}</p>`,
    `<h2>Summary</h2>`,
    paragraphs(summary),
    ...sections.map((s) => `<h2>${esc(s.heading)}</h2>\n          ${paragraphs(s.body)}`),
    NAV,
  ].join('\n          ');
}

function webPage(path: string, name: string, description: string, type = 'WebPage'): object {
  return {
    '@type': type,
    '@id': `${ORIGIN}${path}#page`,
    url: `${ORIGIN}${path}`,
    name,
    description,
    isPartOf: { '@id': `${ORIGIN}/#site` },
  };
}

const pages: PageSpec[] = [
  {
    path: '/about',
    title: ABOUT.title,
    description: ABOUT.description,
    ogDescription: ABOUT.ogDescription,
    body: simpleBody(ABOUT),
    jsonLd: [webPage('/about', ABOUT.title, ABOUT.description, 'AboutPage')],
  },
  {
    path: '/why-dibbs',
    title: WHY.title,
    description: WHY.description,
    ogDescription: WHY.ogDescription,
    body: simpleBody(WHY),
    jsonLd: [webPage('/why-dibbs', WHY.title, WHY.description)],
  },
  {
    path: '/faq',
    title: FAQ_TITLE,
    description: FAQ_DESCRIPTION,
    ogDescription: FAQ_DESCRIPTION,
    body: [
      `<h1>${esc(FAQ_HEADING)}</h1>`,
      `<p>${esc(FAQ_INTRO)}</p>`,
      ...FAQ.map((f) => `<h2>${esc(f.question)}</h2>\n          <p>${esc(f.answer)}</p>`),
      NAV,
    ].join('\n          '),
    jsonLd: [
      webPage('/faq', FAQ_TITLE, FAQ_DESCRIPTION),
      {
        '@type': 'FAQPage',
        '@id': `${ORIGIN}/faq#faq`,
        mainEntity: FAQ.map((f) => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      },
    ],
  },
  {
    path: '/legal/terms',
    title: `${TERMS_TITLE} | Dibbs`,
    description: clip(TERMS_SUMMARY[0]),
    ogDescription: clip(TERMS_SUMMARY[0]),
    body: legalBody(TERMS_TITLE, TERMS_SUMMARY, TERMS_SECTIONS),
    jsonLd: [webPage('/legal/terms', `${TERMS_TITLE} | Dibbs`, clip(TERMS_SUMMARY[0]))],
  },
  {
    path: '/legal/privacy',
    title: `${PRIVACY_TITLE} | Dibbs`,
    description: clip(PRIVACY_SUMMARY[0]),
    ogDescription: clip(PRIVACY_SUMMARY[0]),
    body: legalBody(PRIVACY_TITLE, PRIVACY_SUMMARY, PRIVACY_SECTIONS),
    jsonLd: [webPage('/legal/privacy', `${PRIVACY_TITLE} | Dibbs`, clip(PRIVACY_SUMMARY[0]))],
  },
];

// ---- template editing ------------------------------------------------------

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) fail(`${indexPath} not found. Run "expo export --platform web" first.`);
const template = readFileSync(indexPath, 'utf8');

/** Replaces the single match of `pattern`; fails loudly when the marker is missing. */
function swap(html: string, label: string, pattern: RegExp, replacement: string): string {
  if (!pattern.test(html)) fail(`marker not found in dist/index.html: ${label}`);
  return html.replace(pattern, () => replacement);
}

const ROOT_FALLBACK = /<div id="root">\s*<div class="seo-shell">[\s\S]*?<\/main>\s*<\/div>\s*<\/div>/;

// The app bundle the template points at must exist, or every page would boot to nothing.
const bundle = /<script src="([^"]+)" defer><\/script>/.exec(template);
if (!bundle) fail('no <script src="..." defer> bundle tag in dist/index.html');
if (!existsSync(join(DIST, bundle[1]))) fail(`bundle referenced by dist/index.html is missing: ${bundle[1]}`);

function build(spec: PageSpec): string {
  const url = `${ORIGIN}${spec.path}`;
  let html = template;
  html = swap(html, '<title>', /<title>[\s\S]*?<\/title>/, `<title>${esc(spec.title)}</title>`);
  html = swap(html, 'meta description', /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(spec.description)}" />`);
  html = swap(html, 'canonical', /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`);
  html = swap(html, 'og:url', /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
  html = swap(html, 'og:title', /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(spec.title)}" />`);
  html = swap(html, 'og:description', /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(spec.ogDescription)}" />`);
  html = swap(html, 'twitter:title', /<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(spec.title)}" />`);
  html = swap(html, 'twitter:description', /<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(spec.ogDescription)}" />`);
  html = swap(html, 'JSON-LD', /<script type="application\/ld\+json">[\s\S]*?<\/script>/, jsonLdScript(spec.jsonLd));
  html = swap(
    html,
    'root fallback block',
    ROOT_FALLBACK,
    `<div id="root">\n      <div class="seo-shell">\n        <main>\n          ${spec.body}\n        </main>\n      </div>\n    </div>`,
  );
  return html;
}

function build404(): string {
  let html = template;
  html = swap(html, '<title>', /<title>[\s\S]*?<\/title>/, '<title>Page not found | Dibbs</title>');
  html = swap(html, 'meta description', /<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="This page does not exist on Dibbs." />');
  html = swap(html, 'canonical', /<link rel="canonical" href="[^"]*" \/>/, '<meta name="robots" content="noindex" />');
  html = swap(html, 'og:url', /\s*<meta property="og:url" content="[^"]*" \/>/, '');
  html = swap(html, 'JSON-LD', /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
  html = swap(
    html,
    'root fallback block',
    ROOT_FALLBACK,
    `<div id="root">
      <div class="seo-shell">
        <main>
          <h1>Page not found</h1>
          <p>We could not find that page. It may have moved, or a listing may have expired.</p>
          <p><a href="/">Browse listings on Dibbs</a></p>
        </main>
      </div>
    </div>`,
  );
  return html;
}

function write(relativeFile: string, html: string): void {
  const target = join(DIST, relativeFile);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
  console.log(`prerender-public: wrote dist/${relativeFile}`);
}

for (const spec of pages) write(`${spec.path.slice(1)}/index.html`, build(spec));
write('404.html', build404());
