// The admin page: one self-contained HTML document. Names come from players, so everything is put on the page
// with textContent (never as HTML).
export const ADMIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Beta Blast admin</title>
<style nonce="__NONCE__">
:root{color-scheme:light dark;--bg:#14171f;--fg:#e9ecf5;--mut:#9aa6cf;--card:#1d2230;--line:#2c3350;--accent:#ffd166;--bad:#ff6b6b;--ok:#7ae6dc}
@media (prefers-color-scheme:light){:root{--bg:#f4f5f9;--fg:#171b2a;--mut:#5b6486;--card:#fff;--line:#d8dcea;--accent:#8a5a00;--bad:#c0262d;--ok:#0d7d73}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px}
h1{font-size:22px;margin:8px 0;color:var(--accent)} .who{color:var(--mut);font-size:13px}
nav{display:flex;gap:6px;margin:12px 0;flex-wrap:wrap}
button,input{font:inherit;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:6px 10px}
button{cursor:pointer} button:hover{border-color:var(--accent)} nav button[aria-pressed=true]{background:var(--accent);color:#14171f;border-color:var(--accent)}
button.danger{border-color:var(--bad);color:var(--bad)} button:disabled{opacity:.5;cursor:default}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:middle} th{color:var(--mut);font-weight:600;font-size:13px}
td.actions button{margin:2px 4px 2px 0} .tag{font-size:12px;padding:1px 6px;border-radius:10px;border:1px solid var(--line);color:var(--mut)}
.tag.ban{color:var(--bad);border-color:var(--bad)} .tag.acct{color:var(--ok);border-color:var(--ok)}
#msg{min-height:22px;margin:8px 0;color:var(--ok)} #msg.err{color:var(--bad)} .empty{color:var(--mut);padding:16px}
.bar{display:flex;gap:8px;margin-bottom:10px} .bar input{flex:1}
</style></head><body><main>
<header><h1>Beta Blast admin</h1><span class="who">Signed in as __EMAIL__</span></header>
<nav id="tabs"></nav><div id="msg" role="status"></div><div id="view"></div>
</main>
<script nonce="__NONCE__">
const $ = (s) => document.querySelector(s);
const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids) e.append(k); return e; };
const when = (t) => new Date(t).toLocaleString();
let tab = 'players';
const say = (text, err) => { const m = $('#msg'); m.textContent = text || ''; m.className = err ? 'err' : ''; };
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
async function act(label, path, body, again) {
  try { say('Working…'); await api(path, body); say(label); await again(); } catch (e) { say(e.message, true); }
}
const TABS = { players: 'Players', arcade: 'Arcade', bans: 'Banned', log: 'Log' };
function tabs() {
  const nav = $('#tabs'); nav.replaceChildren();
  for (const [id, label] of Object.entries(TABS)) nav.append(el('button', { textContent: label, onclick: () => { tab = id; say(''); show(); } }, ''));
  [...nav.children].forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(TABS)[i] === tab)));
}
function table(head, rows, empty) {
  if (!rows.length) return el('div', { className: 'empty', textContent: empty });
  const t = el('table'); const tr = el('tr'); for (const h of head) tr.append(el('th', { textContent: h })); t.append(el('thead', {}, tr));
  const tb = el('tbody'); for (const r of rows) tb.append(r); t.append(tb); return t;
}
const cell = (v) => el('td', { textContent: String(v) });
const btn = (label, fn, danger) => el('button', { textContent: label, className: danger ? 'danger' : '', onclick: fn });

async function loadPlayers(q = '') {
  const { players: list } = await api('/api/players?q=' + encodeURIComponent(q));
  const box = el('div'); const input = el('input', { placeholder: 'Search names…', value: q });
  box.append(el('div', { className: 'bar' }, input, btn('Search', () => reload())));
  const reload = () => loadPlayers(input.value);
  input.onkeydown = (e) => { if (e.key === 'Enter') reload(); };
  const rows = list.map((p) => {
    const tr = el('tr'); const name = el('td'); name.append(p.name);
    if (p.provider) name.append(' ', el('span', { className: 'tag acct', textContent: 'signed in (' + p.provider + ')' }));
    if (p.banned) name.append(' ', el('span', { className: 'tag ban', textContent: 'banned' }));
    const acts = el('td', { className: 'actions' });
    acts.append(
      btn('Rename', () => { const to = prompt('New name for "' + p.name + '"? Leave empty for a neutral "Climber 1234" name.', ''); if (to !== null) act('Renamed', '/api/players/rename', { name: p.name, to }, reload); }),
      btn('Remove scores', () => { if (confirm('Remove all scores for "' + p.name + '"? You can undo this from the Log.')) act('Scores removed', '/api/players/remove', { name: p.name }, reload); }, true),
      btn('Remove + ban name', () => { const why = prompt('Remove all scores for "' + p.name + '" and stop anyone using the name. Reason (optional):', ''); if (why !== null) act('Removed and banned', '/api/players/remove', { name: p.name, ban: true, reason: why }, reload); }, true),
    );
    if (p.provider) acts.append(btn('Delete account + ban', () => { if (confirm('Delete the ' + p.provider + ' account that owns "' + p.name + '" and stop that login being used again? This cannot be undone.')) act('Account deleted', '/api/accounts/delete', { name: p.name, ban: true }, reload); }, true));
    tr.append(name, cell(p.boards), cell(p.best), cell(when(p.last)), acts); return tr;
  });
  box.append(table(['Name', 'Boards', 'Best', 'Last played', ''], rows, 'No names found.'));
  $('#view').replaceChildren(box);
}
async function loadArcade() {
  const { week, runs } = await api('/api/arcade');
  const rows = runs.map((r) => { const tr = el('tr'); tr.append(cell(r.initials), cell(r.score), cell(r.seconds + 's'), el('td', {}, btn('Remove', () => { if (confirm('Remove ' + r.initials + ' (' + r.score + ')? You can undo this from the Log.')) act('Removed', '/api/arcade/remove', { id: r.id }, loadArcade); }, true))); return tr; });
  $('#view').replaceChildren(el('p', { className: 'who', textContent: 'Arcade table for the week starting ' + week }), table(['Initials', 'Score', 'Time', ''], rows, 'No Arcade runs this week.'));
}
async function loadBans() {
  const { names, accounts } = await api('/api/bans');
  const rows = names.map((b) => { const tr = el('tr'); tr.append(cell(b.name), cell(b.reason || '-'), cell(when(b.created_at)), el('td', {}, btn('Allow again', () => act('Name allowed again', '/api/bans/remove', { name: b.name }, loadBans)))); return tr; });
  $('#view').replaceChildren(el('p', { className: 'who', textContent: accounts + ' sign-in(s) are blocked.' }), table(['Name', 'Reason', 'Banned', ''], rows, 'No banned names.'));
}
async function loadLog() {
  const { entries } = await api('/api/audit');
  const rows = entries.map((e) => { const tr = el('tr'); tr.append(cell(when(e.at)), cell(e.actor), cell(e.action), cell(e.target), el('td', {}, e.undone ? el('span', { className: 'tag', textContent: 'undone' }) : e.canUndo ? btn('Undo', () => act('Undone', '/api/audit/undo', { id: e.id }, loadLog)) : '')); return tr; });
  $('#view').replaceChildren(table(['When', 'Who', 'Action', 'Target', ''], rows, 'Nothing yet.'));
}
function show() { tabs(); ({ players: loadPlayers, arcade: loadArcade, bans: loadBans, log: loadLog })[tab]().catch((e) => say(e.message, true)); }
show();
</script></body></html>`;
