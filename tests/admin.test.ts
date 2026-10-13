import { beforeEach, describe, expect, it, vi } from 'vitest';
import admin from '../admin/src/index';
import { forgetKeys, teamDomain, verifyAccess } from '../admin/src/access';
import { addArcadeRun } from '../worker/src/arcade';
import { listAudit, listBans, listPlayers, removeAccount, removeArcadeRun, removePlayer, renamePlayer, undo, unban } from '../worker/src/moderation';
import { fakeD1 } from './fakeD1';

const TEAM = 'myteam.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const NOW = 1_800_000_000_000;

// ---------- a pretend Cloudflare Access: our own signing key, served at the certs address ----------

const b64 = (bytes: ArrayBuffer | Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const makeKey = async (kid: string) => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  return { kid, pair, jwk: { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid } };
};
const real = await makeKey('real');
const other = await makeKey('real'); // same name, different key: a forgery

async function token(claims: Record<string, unknown> = {}, key = real, header: Record<string, unknown> = {}): Promise<string> {
  const head = b64(JSON.stringify({ alg: 'RS256', kid: 'real', ...header }));
  const body = b64(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: 'me@example.com', exp: NOW / 1000 + 600, ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64(sig)}`;
}

let fetches = 0;
beforeEach(() => {
  forgetKeys();
  fetches = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', async (url: string) => {
    fetches++;
    expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: [real.jwk] });
  });
});

const env = (extra = {}) => ({ DB: fakeD1(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...extra });
const req = (headers: Record<string, string> = {}, path = '/', method = 'GET', body?: unknown) =>
  new Request(`https://admin.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

describe('checking the Cloudflare Access token', () => {
  it('accepts a good token and says who it is', async () => {
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token() }), env(), NOW)).toEqual({ email: 'me@example.com' });
  });
  it('accepts a service token too', async () => {
    const t = await token({ email: undefined, common_name: 'ci-bot' });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': t }), env(), NOW)).toEqual({ email: 'service:ci-bot' });
  });
  it('fails closed when it is not set up (a missing or odd team domain or AUD)', async () => {
    const t = await token();
    for (const e of [env({ ACCESS_AUD: undefined }), env({ ACCESS_TEAM_DOMAIN: undefined }), env({ ACCESS_TEAM_DOMAIN: 'evil.example.com' }), env({ ACCESS_TEAM_DOMAIN: '' })])
      expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': t }), e, NOW)).toMatchObject({ status: 503 });
    expect(fetches).toBe(0); // it never fetches keys from an address it was not told to trust
  });
  it('says which setting is wrong, so it can be fixed', async () => {
    const t = { 'Cf-Access-Jwt-Assertion': await token() };
    expect(await verifyAccess(req(t), env({ ACCESS_TEAM_DOMAIN: undefined }), NOW)).toMatchObject({ status: 503, error: expect.stringContaining('ACCESS_TEAM_DOMAIN is missing') });
    expect(await verifyAccess(req(t), env({ ACCESS_TEAM_DOMAIN: 'my team.example.org' }), NOW)).toMatchObject({ status: 503, error: expect.stringContaining('myteam.cloudflareaccess.com') });
    expect(await verifyAccess(req(t), env({ ACCESS_AUD: ' ' }), NOW)).toMatchObject({ status: 503, error: expect.stringContaining('ACCESS_AUD is missing') });
  });
  it('is forgiving about how the team domain was typed', async () => {
    for (const typed of ['myteam', 'MyTeam.CloudflareAccess.com', ' https://myteam.cloudflareaccess.com/ ', 'https://myteam.cloudflareaccess.com/cdn-cgi/access/certs', 'myteam.cloudflareaccess.com:443'])
      expect(teamDomain(typed)).toBe(TEAM);
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token() }), env({ ACCESS_TEAM_DOMAIN: 'MyTeam' }), NOW)).toEqual({ email: 'me@example.com' });
    for (const bad of [undefined, '', '   ', 'evil.example.com', 'myteam.cloudflareaccess.com.evil.com', 'my team', 'a.b.cloudflareaccess.com', '-x.cloudflareaccess.com']) expect(teamDomain(bad)).toBeNull();
  });
  it('refuses a request with no token, a mangled one, or one signed with another key', async () => {
    expect(await verifyAccess(req(), env(), NOW)).toMatchObject({ status: 401 });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': 'a.b' }), env(), NOW)).toMatchObject({ status: 401 });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': 'x.y.z' }), env(), NOW)).toMatchObject({ status: 401 });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token({}, other) }), env(), NOW)).toMatchObject({ status: 401 });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token({}, real, { kid: 'unknown' }) }), env(), NOW)).toMatchObject({ status: 401 });
  });
  it('refuses the wrong algorithm (including "none") even when the rest looks right', async () => {
    const forged = `${b64(JSON.stringify({ alg: 'none', kid: 'real' }))}.${b64(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: 'a@b.c', exp: NOW / 1000 + 600 }))}.`;
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': forged }), env(), NOW)).toMatchObject({ status: 401 });
  });
  it('refuses a token for another application or team, and an expired one', async () => {
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token({ aud: ['someone-elses-app'] }) }), env(), NOW)).toMatchObject({ status: 403 });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token({ iss: 'https://other.cloudflareaccess.com' }) }), env(), NOW)).toMatchObject({ status: 403 });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token({ exp: NOW / 1000 - 1 }) }), env(), NOW)).toMatchObject({ status: 401 });
    expect(await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token({ email: undefined }) }), env(), NOW)).toMatchObject({ status: 403 });
  });
  it('keeps Cloudflare\'s keys for a while instead of asking every time', async () => {
    const e = env();
    for (let i = 0; i < 3; i++) await verifyAccess(req({ 'Cf-Access-Jwt-Assertion': await token() }), e, NOW);
    expect(fetches).toBe(1);
  });
});

// ---------- the admin Worker ----------

const ORIGIN = 'https://admin.example';
async function call(e: ReturnType<typeof env>, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const t = await token();
  const post = body !== undefined;
  return admin.fetch(req({ 'Cf-Access-Jwt-Assertion': t, ...(post ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...headers }, path, post ? 'POST' : 'GET', body), e);
}
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const add = (e: ReturnType<typeof env>, board: string, name: string, score: number) => e.DB.prepare('INSERT INTO scores (board, name, score, seconds, created_at) VALUES (?1, ?2, ?3, 0, ?4)').bind(board, name, score, NOW).run();

describe('the admin Worker', () => {
  it('refuses everyone without a valid Access token, including for the page itself', async () => {
    const e = env();
    expect((await admin.fetch(req(), e)).status).toBe(401);
    expect((await admin.fetch(req({}, '/api/players'), e)).status).toBe(401);
    expect((await admin.fetch(req({ Origin: ORIGIN, 'Content-Type': 'application/json' }, '/api/players/remove', 'POST', { name: 'X' }), e)).status).toBe(401);
    expect((await admin.fetch(req({ 'Cf-Access-Jwt-Assertion': await token() }), env({ ACCESS_AUD: undefined }))).status).toBe(503);
  });

  it('serves the page with a locked-down policy and does not put the email in as HTML', async () => {
    const res = await admin.fetch(req({ 'Cf-Access-Jwt-Assertion': await token({ email: '<img src=x onerror=alert(1)>@e.com' }) }), env());
    expect(res.status).toBe(200);
    const html = await res.text();
    const csp = res.headers.get('Content-Security-Policy')!;
    const nonce = /nonce-([A-Za-z0-9+/=]+)/.exec(csp)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).not.toContain('<img');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('Beta Blast admin');
  });

  it('lists and searches names, with sign-in and ban markers', async () => {
    const e = env();
    await add(e, 'v1', 'Ann', 500);
    await add(e, 'survival', 'Ann', 900);
    await add(e, 'v1', 'Bob_100%', 5);
    await e.DB.prepare("INSERT INTO users (id, provider, provider_id, name, created_at) VALUES ('u1', 'github', '1', 'Ann', 1)").run();
    await e.DB.prepare("INSERT INTO banned_names (name, reason, created_at) VALUES ('bob_100%', '', 1)").run();
    const all = (await json(await call(e, '/api/players'))).players;
    expect(all.map((p: any) => p.name).sort()).toEqual(['Ann', 'Bob_100%']);
    expect(all.find((p: any) => p.name === 'Ann')).toMatchObject({ boards: 2, best: 900, provider: 'github', banned: false });
    expect(all.find((p: any) => p.name === 'Bob_100%')).toMatchObject({ provider: null, banned: true });
    expect((await json(await call(e, '/api/players?q=an'))).players.map((p: any) => p.name)).toEqual(['Ann']);
    expect((await json(await call(e, '/api/players?q=%25'))).players.map((p: any) => p.name)).toEqual(['Bob_100%']); // a % in the search is just a %
    expect((await json(await call(e, '/api/players?q=_'))).players.map((p: any) => p.name)).toEqual(['Bob_100%']);
  });

  it('only changes things for requests that come from its own page', async () => {
    const e = env();
    await add(e, 'v1', 'Rude', 5);
    const t = await token();
    const post = (headers: Record<string, string>) => admin.fetch(req({ 'Cf-Access-Jwt-Assertion': t, ...headers }, '/api/players/remove', 'POST', { name: 'Rude' }), e);
    expect((await post({ 'Content-Type': 'application/json' })).status).toBe(403); // no Origin
    expect((await post({ Origin: 'https://evil.example', 'Content-Type': 'application/json' })).status).toBe(403);
    expect((await post({ Origin: ORIGIN, 'Content-Type': 'text/plain' })).status).toBe(403);
    expect((await listPlayers(e.DB, '')).map((p) => p.name)).toEqual(['Rude']); // still there
    expect((await post({ Origin: ORIGIN, 'Content-Type': 'application/json' })).status).toBe(200);
    expect(await listPlayers(e.DB, '')).toEqual([]);
  });

  it('removes scores (and can ban the name), and the log shows who did it and can undo it', async () => {
    const e = env();
    await add(e, 'v1', 'Rude', 500);
    await add(e, 'survival', 'Rude', 700);
    await add(e, 'v1', 'Fine', 5);
    await e.DB.prepare("INSERT INTO players (name, look, updated_at) VALUES ('Rude', '123', 1)").run();
    expect(await json(await call(e, '/api/players/remove', { name: 'Rude', ban: true, reason: 'offensive' }))).toEqual({ removed: 2 });
    expect((await listPlayers(e.DB, '')).map((p) => p.name)).toEqual(['Fine']);
    expect(await e.DB.prepare('SELECT 1 AS x FROM players').first()).toBeNull();
    expect((await listBans(e.DB)).names).toMatchObject([{ name: 'Rude', reason: 'offensive' }]);
    const log = (await json(await call(e, '/api/audit'))).entries;
    expect(log[0]).toMatchObject({ actor: 'me@example.com', action: 'remove-scores', target: 'Rude', canUndo: true });

    expect((await json(await call(e, '/api/audit/undo', { id: log[0].id }))).ok).toBe(true);
    expect((await listPlayers(e.DB, 'rude')).map((p) => [p.name, p.boards, p.best, p.banned])).toEqual([['Rude', 2, 700, false]]); // back, and no longer banned
    expect((await e.DB.prepare("SELECT look FROM players WHERE name = 'Rude'").first()) as any).toEqual({ look: '123' });
    expect((await call(e, '/api/audit/undo', { id: log[0].id })).status).toBe(409); // only once
    const after = (await json(await call(e, '/api/audit'))).entries;
    expect(after.map((a: any) => a.action)).toEqual(['undo', 'remove-scores']);
    expect(after[1]).toMatchObject({ undone: true, canUndo: false });
  });

  it('renames a name to something neutral, taking its scores and an account\'s name along', async () => {
    const e = env();
    await add(e, 'v1', 'Rude', 500);
    await e.DB.prepare("INSERT INTO users (id, provider, provider_id, name, created_at) VALUES ('u1', 'github', '1', 'Rude', 1)").run();
    const r = await json(await call(e, '/api/players/rename', { name: 'Rude' }));
    expect(r.name).toMatch(/^Climber \d{4}$/);
    expect((await listPlayers(e.DB, '')).map((p) => [p.name, p.best, p.provider])).toEqual([[r.name, 500, 'github']]);
    expect(((await e.DB.prepare('SELECT name FROM users').first()) as any).name).toBe(r.name);
    const named = await json(await call(e, '/api/players/rename', { name: r.name, to: 'Pip' }));
    expect(named.name).toBe('Pip');
    expect((await call(e, '/api/players/rename', { name: 'Pip', to: 'fuck' })).status).toBe(409); // not an allowed name
  });

  it('will not rename onto a name that is already taken', async () => {
    const e = env();
    await add(e, 'v1', 'Rude', 5);
    await add(e, 'v1', 'Taken', 5);
    expect(await renamePlayer(e.DB, 'a', 'Rude', 'taken')).toEqual({ error: 'That name is taken' });
    await e.DB.prepare("INSERT INTO banned_names (name, created_at) VALUES ('Nope', 1)").run();
    expect(await renamePlayer(e.DB, 'a', 'Rude', 'Nope')).toEqual({ error: 'That name is taken' });
  });

  it('deletes an account with everything it holds, and can block that login for good', async () => {
    const e = env();
    await add(e, 'v1', 'Fake', 9);
    await e.DB.prepare("INSERT INTO users (id, provider, provider_id, name, created_at) VALUES ('u1', 'google', 'sub-1', 'Fake', 1)").run();
    await e.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', 'u1', 1, 9e12)").run();
    await e.DB.prepare("INSERT INTO saves (user_id, data, updated_at) VALUES ('u1', '{}', 1)").run();
    expect((await call(e, '/api/accounts/delete', { name: 'Nobody', ban: true })).status).toBe(404);
    expect((await call(e, '/api/accounts/delete', { name: 'Fake', ban: true, reason: 'bot' })).status).toBe(200);
    for (const t of ['users', 'sessions', 'saves', 'scores']) expect(await e.DB.prepare(`SELECT 1 AS x FROM ${t}`).first()).toBeNull();
    expect(await e.DB.prepare('SELECT provider, provider_id, reason FROM banned_accounts').first()).toEqual({ provider: 'google', provider_id: 'sub-1', reason: 'bot' });
    expect((await listAudit(e.DB))[0]).toMatchObject({ action: 'delete-account', target: 'Fake', canUndo: false });
    expect((await undo(e.DB, 'a', (await listAudit(e.DB))[0].id)).ok).toBe(false);
  });

  it('removes a single Arcade run, and can put it back', async () => {
    const e = env();
    await addArcadeRun(e.DB, { initials: 'ACE', score: 700, seconds: 80 });
    await addArcadeRun(e.DB, { initials: 'OOO', score: 300, seconds: 40 });
    const { runs } = await json(await call(e, '/api/arcade'));
    expect(runs.map((r: any) => r.initials)).toEqual(['ACE', 'OOO']);
    expect(await removeArcadeRun(e.DB, 'a', 99999)).toEqual({ ok: false });
    expect((await call(e, '/api/arcade/remove', { id: runs[1].id })).status).toBe(200);
    expect((await json(await call(e, '/api/arcade'))).runs.map((r: any) => r.initials)).toEqual(['ACE']);
    const entry = (await listAudit(e.DB))[0];
    expect(entry).toMatchObject({ action: 'remove-arcade-run', target: 'OOO', canUndo: true });
    await undo(e.DB, 'a', entry.id);
    expect((await json(await call(e, '/api/arcade'))).runs.map((r: any) => r.initials)).toEqual(['ACE', 'OOO']);
  });

  it('lets a banned name be allowed again', async () => {
    const e = env();
    await removePlayer(e.DB, 'a', 'Rude', { ban: true });
    expect((await listBans(e.DB)).names).toHaveLength(1);
    expect((await call(e, '/api/bans/remove', { name: 'rude' })).status).toBe(200);
    expect((await listBans(e.DB)).names).toHaveLength(0);
    expect((await json(await call(e, '/api/bans'))).accounts).toBe(0);
    await unban(e.DB, 'a', 'x');
  });

  it('rejects bad requests and unknown routes', async () => {
    const e = env();
    expect((await call(e, '/api/players/remove', {})).status).toBe(400);
    expect((await call(e, '/api/players/remove', { name: 'x'.repeat(41) })).status).toBe(400);
    expect((await call(e, '/api/arcade/remove', { id: 'one' })).status).toBe(400);
    expect((await call(e, '/api/nope', {})).status).toBe(404);
    expect((await call(e, '/api/nope')).status).toBe(404);
    expect((await admin.fetch(req({ 'Cf-Access-Jwt-Assertion': await token() }, '/api/players', 'DELETE'), e)).status).toBe(405);
    expect((await removeAccount(e.DB, 'a', 'Ghost')).ok).toBe(false);
  });
});
