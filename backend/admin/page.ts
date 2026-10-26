/**
 * HTML for /admin. Self-contained (no external scripts or fonts). The
 * dashboard fills itself from /admin/stats.json and /admin/users.json and
 * only ever writes user-supplied text (display names, emails) with
 * textContent, never innerHTML.
 */

const STYLE = `
:root{--bg:#FCF8F7;--surface:#fff;--muted-surface:#F5F0EE;--ink:#161513;--muted:#6F6A62;--line:#E8E1DE;--accent:#DE2F26;--soft:#FDEAE8}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--surface:#1E1B19;--muted-surface:#2A2623;--ink:#F4EFEC;--muted:#A69F97;--line:#332E2A;--accent:#F0473D;--soft:#3A1E1B}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 16px 64px}
.brand{font-weight:800;font-size:20px;color:var(--accent);letter-spacing:-.3px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:24px}
h1{font-size:28px;margin:4px 0 0;letter-spacing:-.5px}
.muted{color:var(--muted)}.small{font-size:12px}
.grid{display:grid;gap:14px}
@media(min-width:760px){.grid.cols{grid-template-columns:1.2fr 1fr}}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px}
.card h2{font-size:15px;margin:0 0 2px}
.hero{font-size:56px;font-weight:800;color:var(--accent);letter-spacing:-1.5px;line-height:1.1;margin:6px 0;font-variant-numeric:tabular-nums}
.num{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.chart{display:flex;align-items:flex-end;gap:3px;height:140px;margin-top:14px}
.bar{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;position:relative}
.bar.zero{opacity:.2}
.bar:hover::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translate(-50%,-6px);background:var(--ink);color:var(--bg);font-size:11px;padding:3px 6px;border-radius:6px;white-space:nowrap}
.axis{display:flex;justify-content:space-between;margin-top:6px}
.track{height:8px;border-radius:99px;background:var(--muted-surface);overflow:hidden;margin-top:6px}
.fill{height:100%;background:var(--accent);border-radius:99px}
.between{display:flex;justify-content:space-between;gap:8px;margin-top:14px}
.person{display:flex;align-items:center;gap:10px;margin-top:12px}
.av{width:30px;height:30px;border-radius:50%;background:var(--muted-surface);display:grid;place-items:center;font-weight:700;font-size:13px;flex:none;overflow:hidden}
.av img{width:100%;height:100%;object-fit:cover}
.name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.place{margin-top:14px}.place b{display:block;font-weight:600}
a{color:var(--accent)}
button,input{font:inherit}
.btn{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:600;cursor:pointer}
.ghost{background:none;border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:7px 12px;cursor:pointer}
input[type=password]{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);margin:10px 0 12px}
.login{max-width:360px;margin:12vh auto 0}
.err{background:var(--soft);color:var(--accent);padding:8px 12px;border-radius:8px;margin-top:10px}
.search{display:flex;gap:8px;margin:14px 0 4px}
input[type=search],select{padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit}
input[type=search]{flex:1;min-width:0}
.acct{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.acct:first-child{border-top:0}
.acct .who{flex:1;min-width:0}
.acct .who b,.acct .who div{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--muted-surface);color:var(--muted);flex:none}
.pill.approved{background:var(--soft);color:var(--accent)}
.pill.blocked{background:var(--ink);color:var(--bg)}
`;

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title}</title><style>${STYLE}</style></head>
<body>${body}</body></html>`;

export function loginPage(error?: string): string {
  return shell(
    'Dibbs Admin',
    `<main><form class="card login" method="post" action="/admin/login">
  <div class="brand">Dibbs</div>
  <h1>Admin</h1>
  <p class="muted small">Founder dashboard. You'll stay signed in on this browser.</p>
  <label for="pw" class="small muted">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
  <button class="btn" type="submit">Sign in</button>
  ${error ? `<div class="err small">${error}</div>` : ''}
</form></main>`,
  );
}

export function dashboardPage(): string {
  return shell(
    'Dibbs Admin',
    `<main>
<header>
  <div><div class="brand">Dibbs</div><h1>Dashboard</h1><div id="updated" class="muted small">Loading…</div></div>
  <form method="post" action="/admin/logout"><button class="ghost small" type="submit">Sign out</button></form>
</header>
<div class="grid" id="app" hidden>
  <div class="grid cols">
    <div class="card">
      <div class="muted small">Accounts created</div>
      <div class="hero" id="total"></div>
      <div class="muted small" id="excluded"></div>
    </div>
    <div class="row">
      <div class="card"><div class="num" id="today"></div><div class="muted small">Today</div></div>
      <div class="card"><div class="num" id="week"></div><div class="muted small">Last 7 days</div></div>
      <div class="card"><div class="num" id="month"></div><div class="muted small">Last 30 days</div></div>
    </div>
  </div>
  <div class="card">
    <h2>New accounts per day</h2><div class="muted small">Last 30 days, Arizona time</div>
    <div class="chart" id="chart"></div>
    <div class="axis muted small"><span id="first"></span><span id="peak"></span><span id="last"></span></div>
  </div>
  <div class="grid cols">
    <div class="card"><h2>Who signed up</h2><div id="breakdown"></div></div>
    <div class="card"><h2>Newest accounts</h2><div id="recent"></div></div>
  </div>
  <div class="row">
    <div class="card"><div class="num" id="listings"></div><div class="muted small">Listings</div></div>
    <div class="card"><div class="num" id="posts"></div><div class="muted small">Posts</div></div>
    <div class="card"><div class="num" id="messages"></div><div class="muted small">Messages</div></div>
  </div>
  <div class="card">
    <h2>Posting access</h2>
    <div class="muted small">Who can buy, sell, make offers, book and post. Default: any verified email can trade (campus or not); a phone-only account needs a campus email. Approved: a phone-only account can trade without one (not a campus, student or ID check; shows as "Approved seller"). Blocked: can't buy, sell or post at all.</div>
    <form class="search" id="access-form" role="search">
      <input type="search" id="access-q" placeholder="Email or name" maxlength="100" autocomplete="off" aria-label="Search accounts by email or name">
      <button class="ghost" type="submit">Search</button>
    </form>
    <div class="muted small" id="access-note"></div>
    <div id="access-list"></div>
  </div>
  <div class="card"><h2>Where the data is saved</h2><div id="storage"></div></div>
</div>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const fmtN = (n) => Number(n).toLocaleString();
const ACCESS_LABEL = { default: 'Default', approved: 'Approved', blocked: 'Blocked' };
const shortDay = (d) => { const [, m, day] = d.split('-'); return Number(m) + '/' + Number(day); };
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; const h = Math.round(m / 60); return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago'; };

function render(s) {
  const a = s.accounts;
  $('total').textContent = fmtN(a.total);
  $('excluded').textContent = 'Real people only. ' + a.demo + ' demo and ' + a.closed + ' closed accounts not counted.';
  $('today').textContent = fmtN(a.today); $('week').textContent = fmtN(a.last7Days); $('month').textContent = fmtN(a.last30Days);

  const max = Math.max(1, ...s.daily.map((d) => d.count));
  $('chart').replaceChildren(...s.daily.map((d) => {
    const b = el('div', 'bar' + (d.count ? '' : ' zero'));
    b.style.height = d.count ? (d.count / max * 100) + '%' : '2px';
    b.dataset.tip = shortDay(d.day) + ': ' + d.count;
    return b;
  }));
  $('first').textContent = shortDay(s.daily[0].day); $('last').textContent = shortDay(s.daily[s.daily.length - 1].day);
  $('peak').textContent = 'peak ' + max + '/day';

  $('breakdown').replaceChildren(...[
    ['Verified campus email', a.verifiedCampusEmail], ['Verified phone', a.verifiedPhone], ['Added a photo or bio', a.withProfile],
  ].map(([label, v]) => {
    const pct = a.total ? Math.round(v / a.total * 100) : 0;
    const wrap = el('div');
    const top = el('div', 'between'); top.append(el('span', '', label), el('span', 'muted', v + ' · ' + pct + '%'));
    const track = el('div', 'track'); const fill = el('div', 'fill'); fill.style.width = pct + '%'; track.append(fill);
    wrap.append(top, track); return wrap;
  }));

  $('recent').replaceChildren(...(s.recent.length ? s.recent.map((u) => {
    const row = el('div', 'person');
    const av = el('div', 'av', u.avatarUrl ? null : (u.displayName.trim()[0] || '?').toUpperCase());
    if (u.avatarUrl && /^https?:\\/\\//.test(u.avatarUrl)) { const img = el('img'); img.src = u.avatarUrl; img.alt = ''; av.append(img); }
    row.append(av, el('span', 'name', u.displayName));
    if (u.postingAccess && u.postingAccess !== 'default') row.append(el('span', 'pill ' + u.postingAccess, ACCESS_LABEL[u.postingAccess]));
    row.append(el('span', 'muted small', ago(u.createdAt)));
    return row;
  }) : [el('p', 'muted', 'No sign-ups yet.')]));

  $('listings').textContent = fmtN(s.activity.listings); $('posts').textContent = fmtN(s.activity.communityPosts); $('messages').textContent = fmtN(s.activity.messages);

  const place = (title, detail, sub, href) => {
    const p = el('div', 'place'); p.append(el('div', 'muted small', title), el('b', '', detail));
    if (sub) { const n = href ? el('a', 'small', sub) : el('div', 'muted small', sub); if (href) { n.href = href; n.target = '_blank'; n.rel = 'noopener'; } p.append(n); }
    return p;
  };
  const st = s.storage;
  $('storage').replaceChildren(
    place('Accounts, listings, messages', st.database.provider, st.database.host),
    place('Photos', st.photos.provider, st.photos.location),
    place('Sign-in codes', st.signInEmail === 'live' ? 'Emailed via Resend' : 'Simulated, printed to the server log'),
    place('Old waitlist sign-ups', 'Netlify Forms (separate from accounts)', 'Open in Netlify', 'https://app.netlify.com/sites/518e5a16-46f6-4d9f-a48b-a162b0f3616b/forms'),
  );
  $('updated').textContent = 'Updated ' + new Date(s.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · refreshes every minute';
  $('app').hidden = false;
}

async function load() {
  try {
    const r = await fetch('/admin/stats.json', { credentials: 'same-origin' });
    if (r.status === 401) { location.reload(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    render(await r.json());
  } catch (e) { $('updated').textContent = 'Could not load stats (' + e.message + '). Retrying…'; }
}
load(); setInterval(load, 60000);

const joined = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

function accessRow(u) {
  const row = el('div', 'acct');
  const who = el('div', 'who');
  who.append(el('b', '', u.displayName), el('div', 'muted small', u.email || 'No email (phone sign-in)'));
  const facts = [u.campusEmailVerified ? 'Campus email verified' : 'No campus email', 'Joined ' + joined(u.createdAt)];
  if (u.isDemo) facts.push('Demo account');
  who.append(el('div', 'muted small', facts.join(' · ')));
  const pick = el('select');
  pick.setAttribute('aria-label', 'Posting access for ' + u.displayName);
  for (const v of ['default', 'approved', 'blocked']) { const o = el('option', '', ACCESS_LABEL[v]); o.value = v; pick.append(o); }
  pick.value = u.postingAccess;
  const status = el('span', 'muted small');
  pick.addEventListener('change', async () => {
    const next = pick.value; pick.disabled = true; status.textContent = 'Saving…';
    try {
      const r = await fetch('/admin/users/access', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, access: next }),
      });
      if (r.status === 401) { location.reload(); return; }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      u.postingAccess = data.user.postingAccess; status.textContent = 'Saved';
    } catch (e) { pick.value = u.postingAccess; status.textContent = 'Not saved: ' + e.message; }
    pick.disabled = false;
  });
  row.append(who, status, pick);
  return row;
}

async function loadAccess(q) {
  $('access-note').textContent = 'Loading…';
  try {
    const r = await fetch('/admin/users.json?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
    if (r.status === 401) { location.reload(); return; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    $('access-list').replaceChildren(...data.users.map(accessRow));
    $('access-note').textContent = q
      ? (data.users.length ? 'Showing up to 20 matches.' : 'No open accounts match.')
      : (data.users.length ? 'Accounts set to Approved or Blocked. Search to find anyone else.' : 'Everyone is on Default. Search by email or name to change someone.');
  } catch (e) { $('access-note').textContent = 'Could not search (' + e.message + ').'; }
}
$('access-form').addEventListener('submit', (e) => { e.preventDefault(); loadAccess($('access-q').value.trim()); });
loadAccess('');
</script>
</main>`,
  );
}
