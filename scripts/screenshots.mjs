// Phone-width screenshots of every Dibbs screen via headless Chrome (CDP).
// Needs `npm run backend` (DEV_LOGIN=1) and `npm run web` running, plus Google Chrome.
// usage: node scripts/screenshots.mjs [outDir]   (default docs/overhaul-screens)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] ?? 'docs/overhaul-screens';
fs.mkdirSync(out, { recursive: true });
const WEB = 'http://localhost:8081';
const API = 'http://localhost:3000/api/trpc';
const MAYA = '00000000-0000-4000-8000-000000000001';
const JORDAN = '00000000-0000-4000-8000-000000000002';
const LISTING = '00000000-0000-4000-8000-000000000101';
const RES = '00000000-0000-4000-8000-000000000301';
let CONV = 'none'; // first of Maya's conversations, looked up below

const shots = [
  // [file, path, who]  who: null = signed out
  ['01-welcome', '/welcome', null],
  ['02-sign-in', '/auth/sign-in', null],
  ['03-email', '/auth/email', null],
  ['04-about', '/about', null],
  ['05-why-dibbs', '/why-dibbs', null],
  ['06-listing-public', `/listing/${LISTING}`, null],
  ['07-create-profile', '/create-profile', MAYA],
  ['10-browse', '/', MAYA],
  ['11-listing-seller-view', `/listing/${LISTING}`, MAYA],
  ['12-listing-buyer-view', `/listing/${LISTING}`, JORDAN],
  ['13-user-profile', `/user/${JORDAN}`, MAYA],
  ['20-sell', '/sell', MAYA],
  ['21-listing-new', '/listing/new', MAYA],
  ['22-listing-edit', `/listing/${LISTING}/edit`, MAYA],
  ['30-reservation-request', `/reservation/request?listingId=${LISTING}`, JORDAN],
  ['31-reservation', `/reservation/${RES}`, MAYA],
  ['32-payments', `/payments/${RES}`, MAYA],
  ['40-inbox', '/inbox', MAYA],
  ['41-conversation', '/conversation/${CONV}', MAYA],
  ['50-community', '/community', MAYA],
  ['51-profile', '/profile', MAYA],
  ['52-settings', '/settings', MAYA],
  ['60-moderation', '/moderation', MAYA],
  ['61-privacy', '/legal/privacy', MAYA],
  ['62-terms', '/legal/terms', MAYA],
  ['63-not-found', '/no-such-page', MAYA],
];

async function token(userId) {
  const r = await fetch(`${API}/auth.devSignIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { userId } }),
  });
  return (await r.json()).result.data.json.token;
}

const port = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dibbs-shoot-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await send('Page.enable');

const tokens = { [MAYA]: await token(MAYA), [JORDAN]: await token(JORDAN) };
const convs = await (await fetch(`${API}/conversation.list`, { headers: { Authorization: `Bearer ${tokens[MAYA]}` } })).json();
CONV = convs.result?.data?.json?.[0]?.id ?? CONV;
for (const s of shots) s[1] = s[1].replace('${CONV}', CONV);
let current = 'unset';
await send('Page.navigate', { url: WEB }); await sleep(8000); // first bundle load

for (const [file, route, who] of shots) {
  if (who !== current) {
    const v = who ? JSON.stringify(tokens[who]) : 'null';
    await send('Runtime.evaluate', {
      expression: `(() => { localStorage.clear(); ${who ? `localStorage.setItem('dibbs-auth-token', ${v});` : ''}
        localStorage.setItem('dibbs-tutorial-seen', '1'); })()`,
    });
    current = who;
  }
  await send('Page.navigate', { url: WEB + route });
  await sleep(4500);
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, `${file}.png`), Buffer.from(result.data, 'base64'));
  console.log('saved', file);
}
ws.close();
await new Promise((r) => { chrome.once('exit', r); chrome.kill(); });
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
