import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { gradeLevel } from '../src/game/levels';
import { playBot } from './bot';
import { fakeD1 } from './fakeD1';
import { fakeProviders, googleClaims } from './providers';

const API = 'https://api.example';
const GAME = 'https://thesecretstage.vip';
const RETURN = `${GAME}/Beta-Blast/`;
// the secret the game keeps, and the hash of it that the server is told
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER)))].map((b) => b.toString(16).padStart(2, '0')).join('');
type Env = { DB: ReturnType<typeof fakeD1>; GH_CLIENT_ID?: string; GH_CLIENT_SECRET?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };

let env: Env;
const full = (): Env => ({ DB: fakeD1(), GH_CLIENT_ID: 'ghid', GH_CLIENT_SECRET: 'ghsecret', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });

// ---------- calls ----------

const call = (method: string, path: string, opts: { body?: unknown; token?: string; origin?: string | null; ip?: string } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.origin !== null) headers.Origin = opts.origin ?? GAME;
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.ip) headers['CF-Connecting-IP'] = opts.ip;
  return worker.fetch(new Request(`${API}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env);
};
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const start = (provider: string, returnTo: string | null = RETURN, ip?: string, challenge: string | null = CHALLENGE) =>
  call('GET', `/auth/${provider}/start?${new URLSearchParams({ ...(returnTo === null ? {} : { return_to: returnTo }), ...(challenge === null ? {} : { challenge }) })}`, { origin: null, ip });
const stateOf = (res: Response) => new URL(res.headers.get('Location')!).searchParams.get('state')!;
const callback = (provider: string, query: Record<string, string>) => call('GET', `/auth/${provider}/callback?${new URLSearchParams(query)}`, { origin: null });
const loginCodeOf = (res: Response) => new URLSearchParams(new URL(res.headers.get('Location')!).hash.slice(1)).get('login')!;

/** Sign in start to finish. Returns the session token. */
async function signIn(provider: 'github' | 'google' = 'github', code = provider === 'github' ? 'gh-good' : 'g-good'): Promise<string> {
  const state = stateOf(await start(provider));
  const back = await callback(provider, { code, state });
  const result = await json(await call('POST', '/auth/exchange', { body: { code: loginCodeOf(back), verifier: VERIFIER } }));
  return result.token;
}
const setName = (token: string, name: string) => call('PUT', '/me/name', { token, body: { name } });
const rows = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all()).results as Record<string, any>[];

beforeEach(() => {
  env = full();
  googleClaims.override = {};
  vi.stubGlobal('fetch', fakeProviders());
});
afterEach(() => vi.unstubAllGlobals());

describe('which providers are set up', () => {
  it('offers only the ones with their secrets in place', async () => {
    expect(await json(await call('GET', '/auth/providers', { origin: null }))).toEqual({ providers: ['github', 'google'] });
    env = { DB: env.DB, GH_CLIENT_ID: 'x', GH_CLIENT_SECRET: 'y' };
    expect((await json(await call('GET', '/auth/providers'))).providers).toEqual(['github']);
    env = { DB: env.DB, GH_CLIENT_ID: 'x' }; // an id without its secret is not set up
    expect((await json(await call('GET', '/auth/providers'))).providers).toEqual([]);
  });

  it('says so, rather than failing oddly, when sign-in is not set up', async () => {
    env = { DB: env.DB };
    const res = await start('github');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not set up');
  });
});

describe('starting a sign-in', () => {
  it('sends the browser to GitHub with a one-time state', async () => {
    const res = await start('github');
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('Location')!);
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(to.searchParams.get('client_id')).toBe('ghid');
    expect(to.searchParams.get('redirect_uri')).toBe(`${API}/auth/github/callback`);
    expect(to.searchParams.get('state')!.length).toBeGreaterThan(20);
    expect(to.searchParams.has('client_secret')).toBe(false);
  });

  it('asks Google for nothing but who the person is', async () => {
    const to = new URL((await start('google')).headers.get('Location')!);
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(to.searchParams.get('scope')).toBe('openid');
    expect(to.searchParams.get('response_type')).toBe('code');
    expect(to.searchParams.get('client_id')).toBe('gid');
  });

  it('gives every sign-in its own state', async () => {
    expect(stateOf(await start('github'))).not.toBe(stateOf(await start('github')));
  });

  it('only returns to the game\'s own sites', async () => {
    for (const bad of ['https://evil.example/', 'https://thesecretstage.vip.evil.example/', 'javascript:alert(1)', 'not a url', '', null]) expect((await start('github', bad)).status).toBe(400);
    for (const ok of [RETURN, 'https://owainwilliams.github.io/Beta-Blast/', 'http://localhost:5173/']) expect((await start('github', ok)).status).toBe(302);
  });

  it('needs the challenge that ties the sign-in to the browser that started it', async () => {
    for (const bad of [null, '', 'short', 'g'.repeat(64), CHALLENGE.toUpperCase(), `${CHALLENGE}0`]) expect((await start('github', RETURN, undefined, bad)).status).toBe(400);
  });

  it('knows only GitHub and Google', async () => {
    expect((await call('GET', '/auth/facebook/start', { origin: null })).status).toBe(404);
  });
});

describe('finishing a sign-in', () => {
  it('creates the account and hands the game a one-time code in the URL fragment', async () => {
    const state = stateOf(await start('github', `${RETURN}?x=1#old`));
    const back = await callback('github', { code: 'gh-good', state });
    expect(back.status).toBe(302);
    const to = new URL(back.headers.get('Location')!);
    expect(to.origin + to.pathname + to.search).toBe(`${GAME}/Beta-Blast/?x=1`);
    expect(to.hash).toMatch(/^#login=[A-Za-z0-9_-]{20,}$/);
    expect(await rows('SELECT provider, provider_id, name FROM users')).toEqual([{ provider: 'github', provider_id: '1001', name: null }]);
  });

  it('works the same with Google', async () => {
    const state = stateOf(await start('google'));
    const back = await callback('google', { code: 'g-good', state });
    expect(loginCodeOf(back).length).toBeGreaterThan(20);
    expect(await rows('SELECT provider, provider_id FROM users')).toEqual([{ provider: 'google', provider_id: 'google-sub-1' }]);
  });

  it('recognises the same person next time, and keeps different people apart', async () => {
    const a = await signIn('github');
    const b = await signIn('github');
    expect(a).not.toBe(b); // each sign-in is its own session
    expect(await rows('SELECT id FROM users')).toHaveLength(1);
    await signIn('github', 'gh-other');
    await signIn('google');
    expect(await rows('SELECT id FROM users')).toHaveLength(3);
  });

  it('refuses a state it did not give out, or one used twice', async () => {
    expect((await callback('github', { code: 'gh-good', state: 'made-up' })).status).toBe(400);
    expect((await callback('github', { code: 'gh-good' })).status).toBe(400);
    const state = stateOf(await start('github'));
    expect((await callback('github', { code: 'gh-good', state })).status).toBe(302);
    expect((await callback('github', { code: 'gh-good', state })).status).toBe(400);
  });

  it('refuses a state that is too old, or from the other provider', async () => {
    const old = stateOf(await start('github'));
    await env.DB.prepare('UPDATE oauth_states SET created_at = 1 WHERE state = ?1').bind(old).run();
    expect((await callback('github', { code: 'gh-good', state: old })).status).toBe(400);
    const gh = stateOf(await start('github'));
    expect((await callback('google', { code: 'g-good', state: gh })).status).toBe(400);
    expect(await rows('SELECT id FROM users')).toHaveLength(0);
  });

  it('sends the player back to the game when they say no, or the provider fails', async () => {
    const denied = await callback('github', { error: 'access_denied', state: stateOf(await start('github')) });
    expect(denied.headers.get('Location')).toBe(`${RETURN}#login_error=denied`);
    const bad = await callback('github', { code: 'wrong', state: stateOf(await start('github')) });
    expect(bad.headers.get('Location')).toBe(`${RETURN}#login_error=failed`);
    const noCode = await callback('google', { state: stateOf(await start('google')) });
    expect(noCode.headers.get('Location')).toBe(`${RETURN}#login_error=failed`);
    expect(await rows('SELECT id FROM users')).toHaveLength(0);
  });

  it('does not accept a Google token meant for someone else, or an out-of-date one', async () => {
    for (const claims of [{ aud: 'someone-else' }, { iss: 'https://evil.example' }, { exp: 1 }, { sub: '' }]) {
      googleClaims.override = claims;
      const res = await callback('google', { code: 'g-good', state: stateOf(await start('google')) });
      expect(res.headers.get('Location')).toBe(`${RETURN}#login_error=failed`);
    }
    expect(await rows('SELECT id FROM users')).toHaveLength(0);
  });

  it('keeps only the provider\'s id for the person: no email, no GitHub name', async () => {
    await signIn('github');
    expect(JSON.stringify(await rows('SELECT * FROM users'))).not.toContain('secret-login');
  });
});

describe('the one-time code and the session', () => {
  async function loginCode() {
    return loginCodeOf(await callback('github', { code: 'gh-good', state: stateOf(await start('github')) }));
  }

  it('swaps the code for a session token, once', async () => {
    const code = await loginCode();
    const res = await call('POST', '/auth/exchange', { body: { code, verifier: VERIFIER } });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.token.length).toBeGreaterThan(30);
    expect(body.user).toEqual({ name: null, provider: 'github' });
    expect((await call('POST', '/auth/exchange', { body: { code, verifier: VERIFIER } })).status).toBe(401);
  });

  it('refuses codes that are wrong, old, or not codes', async () => {
    const code = await loginCode();
    await env.DB.prepare('UPDATE login_codes SET expires_at = 1').run();
    expect((await call('POST', '/auth/exchange', { body: { code, verifier: VERIFIER } })).status).toBe(401);
    for (const bad of ['', 'short', 'x'.repeat(40), 123, null, undefined, { a: 1 }]) expect((await call('POST', '/auth/exchange', { body: { code: bad, verifier: VERIFIER } })).status).toBe(401);
    expect((await call('POST', '/auth/exchange', { body: 'nope' as unknown as object })).status).toBe(401);
  });

  it('will not give a session to someone who did not start the sign-in (login CSRF)', async () => {
    // an attacker starts a sign-in with their own secret and gets the one-time code for their account...
    const code = await loginCode();
    // ...then tricks someone into opening the finished sign-in, in a browser that holds a different secret (or none)
    expect((await call('POST', '/auth/exchange', { body: { code, verifier: 'w'.repeat(43) } })).status).toBe(401);
    expect((await call('POST', '/auth/exchange', { body: { code, verifier: VERIFIER } })).status).toBe(401); // and the code is spent either way
    const another = await loginCode();
    expect((await call('POST', '/auth/exchange', { body: { code: another } })).status).toBe(401); // no secret at all
    for (const bad of ['', 'short', 5, null, {}]) expect((await call('POST', '/auth/exchange', { body: { code: await loginCode(), verifier: bad } })).status).toBe(401);
    expect(await rows('SELECT 1 FROM sessions')).toHaveLength(0);
  });

  it('stores only a hash of the token and of the code', async () => {
    const code = await loginCode();
    const { token } = await json(await call('POST', '/auth/exchange', { body: { code, verifier: VERIFIER } }));
    const dump = JSON.stringify([await rows('SELECT * FROM sessions'), await rows('SELECT * FROM login_codes')]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(code);
  });

  it('only talks to the game\'s own sites', async () => {
    const code = await loginCode();
    expect((await call('POST', '/auth/exchange', { body: { code, verifier: VERIFIER }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/auth/exchange', { body: { code, verifier: VERIFIER }, origin: null })).status).toBe(403);
  });

  it('knows who is signed in, until they sign out or the session runs out', async () => {
    const token = await signIn();
    expect(await json(await call('GET', '/me', { token }))).toEqual({ user: { name: null, provider: 'github' } });
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/me', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await call('GET', '/me', { token: 'bad token!' })).status).toBe(401);
    await env.DB.prepare('UPDATE sessions SET expires_at = 1').run();
    expect((await call('GET', '/me', { token })).status).toBe(401);
    const second = await signIn();
    expect((await call('POST', '/me/logout', { token: second })).status).toBe(200);
    expect((await call('GET', '/me', { token: second })).status).toBe(401);
  });

  it('keeps accounts private to the game\'s own sites', async () => {
    const token = await signIn();
    expect((await call('GET', '/me', { token, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', '/me', { token, origin: null })).status).toBe(403);
    const pre = await worker.fetch(new Request(`${API}/me/save`, { method: 'OPTIONS', headers: { Origin: GAME, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization' } }), env);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(GAME);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    const evil = await worker.fetch(new Request(`${API}/me/save`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' } }), env);
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('slows down sign-in attempts from one address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await start('github', RETURN, '7.7.7.7')).status);
    expect(statuses.slice(0, 30).every((s) => s === 302)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
    expect((await start('github', RETURN, '8.8.8.8')).status).toBe(302);
  });
});

describe('choosing a name', () => {
  it('sets it, and says it is theirs', async () => {
    const token = await signIn();
    expect(await json(await setName(token, '  Ann  Climbs '))).toEqual({ name: 'Ann Climbs' });
    expect((await json(await call('GET', '/me', { token }))).user.name).toBe('Ann Climbs');
  });

  it('refuses names that are not allowed', async () => {
    const token = await signIn();
    for (const bad of ['', 'x'.repeat(13), '<script>', 'sh1t', '-dash', 123, null]) expect((await setName(token, bad as string)).status).toBe(400);
    expect((await call('PUT', '/me/name', { token, body: {} })).status).toBe(400);
  });

  it('keeps names unique, whatever the case', async () => {
    const a = await signIn('github');
    const b = await signIn('github', 'gh-other');
    expect((await setName(a, 'Ann')).status).toBe(200);
    expect((await setName(b, 'ann')).status).toBe(409);
    expect((await setName(b, 'Bob')).status).toBe(200);
    expect((await setName(a, 'Ann')).status).toBe(200); // their own name again is fine
  });

  const addScore = (board: string, name: string, score: number, seconds = 0) => env.DB.prepare('INSERT INTO scores (board, name, score, seconds, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(board, name, score, seconds, score).run();

  it('lets a name be changed, and takes the scores and the outfit along', async () => {
    const token = await signIn();
    await setName(token, 'Ann');
    await addScore('v1', 'Ann', 500);
    await addScore('survival', 'Ann', 4000, 200);
    await env.DB.prepare("INSERT INTO players (name, look, updated_at) VALUES ('Ann', '123', 1)").run();

    expect(await json(await setName(token, 'Annabel'))).toEqual({ name: 'Annabel' });
    expect((await json(await call('GET', '/me', { token }))).user.name).toBe('Annabel');
    expect(await rows('SELECT board, name, score, seconds FROM scores ORDER BY board')).toEqual([
      { board: 'survival', name: 'Annabel', score: 4000, seconds: 200 },
      { board: 'v1', name: 'Annabel', score: 500, seconds: 0 },
    ]);
    expect(await rows('SELECT name, look FROM players')).toEqual([{ name: 'Annabel', look: '123' }]);
    const board = await json(await call('GET', '/scores?board=v1', { origin: null }));
    expect(board.scores[0]).toMatchObject({ name: 'Annabel', score: 500, look: '123', verified: true });
  });

  it('frees the old name, and lets someone else have it', async () => {
    const a = await signIn('github');
    const b = await signIn('github', 'gh-other');
    await setName(a, 'Ann');
    await setName(a, 'Anna');
    expect((await setName(b, 'Ann')).status).toBe(200);
  });

  it('keeps the higher score when the new name already has one on the same board', async () => {
    const token = await signIn();
    await setName(token, 'Ann');
    await addScore('v1', 'Ann', 500);
    await addScore('v2', 'Ann', 300);
    await addScore('v1', 'Walker', 900); // someone playing as a guest under the new name
    await addScore('v2', 'Walker', 100);
    await addScore('v3', 'Walker', 50);
    await setName(token, 'Walker');
    expect(await rows("SELECT board, score FROM scores WHERE name = 'Walker' ORDER BY board")).toEqual([{ board: 'v1', score: 900 }, { board: 'v2', score: 300 }, { board: 'v3', score: 50 }]);
    expect(await rows("SELECT 1 FROM scores WHERE name = 'Ann'")).toHaveLength(0);
  });

  it('can change just the capital letters, without losing anything', async () => {
    const token = await signIn();
    await setName(token, 'ann');
    await addScore('v1', 'ann', 500);
    expect((await setName(token, 'Ann')).status).toBe(200);
    expect(await rows('SELECT name, score FROM scores')).toEqual([{ name: 'Ann', score: 500 }]);
  });

  it('changes nothing if the new name is not allowed or is taken', async () => {
    const a = await signIn('github');
    const b = await signIn('github', 'gh-other');
    await setName(a, 'Ann');
    await setName(b, 'Bob');
    await addScore('v1', 'Ann', 500);
    expect((await setName(a, 'bob')).status).toBe(409);
    expect((await setName(a, 'sh1t')).status).toBe(400);
    expect((await json(await call('GET', '/me', { token: a }))).user.name).toBe('Ann');
    expect(await rows('SELECT name FROM scores')).toEqual([{ name: 'Ann' }]);
  });

  it('lets someone claim a name that has anonymous scores, which then show as theirs', async () => {
    await env.DB.prepare("INSERT INTO scores (board, name, score, seconds, created_at) VALUES ('v1', 'Owain', 500, 0, 1)").run();
    const token = await signIn();
    expect((await setName(token, 'owain')).status).toBe(200);
    expect((await json(await call('GET', '/scores?board=v1', { origin: null }))).scores[0]).toMatchObject({ name: 'Owain', verified: true });
  });
});

describe('posting scores', () => {
  const round = (grade: number) => {
    const level = gradeLevel(grade);
    for (let s = 1; ; s++) {
      const p = playBot(level, s);
      if (p.ended && p.score > 0) return { replay: p.replay, score: p.score };
    }
  };
  const post = (opts: { token?: string; name?: string; board?: string; ip?: string }) => {
    const r = round(3);
    return call('POST', '/scores', { token: opts.token, ip: opts.ip, body: { board: opts.board ?? 'v3', name: opts.name ?? 'Anon', score: r.score, look: '123', replay: r.replay } });
  };

  it('puts a signed-in player\'s score under their account name, whatever the post says', async () => {
    const token = await signIn();
    await setName(token, 'Ann');
    expect((await post({ token, name: 'Somebody Else' })).status).toBe(200);
    const board = await json(await call('GET', '/scores?board=v3', { origin: null }));
    expect(board.scores).toHaveLength(1);
    expect(board.scores[0]).toMatchObject({ name: 'Ann', verified: true, look: '123' });
    const v1 = await json(await call('GET', '/v1/boards/v3', { origin: null }));
    expect(v1.scores[0]).toMatchObject({ name: 'Ann', verified: true });
    expect(await json(await call('GET', '/v1/players/ann', { origin: null }))).toMatchObject({ name: 'Ann', verified: true });
  });

  it('asks a signed-in player with no name to choose one first', async () => {
    const token = await signIn();
    const res = await post({ token });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/name first/);
  });

  it('tells a player whose session has run out to sign in again', async () => {
    const token = await signIn();
    await setName(token, 'Ann');
    await env.DB.prepare('UPDATE sessions SET expires_at = 1').run();
    expect((await post({ token })).status).toBe(401);
  });

  it('still lets anyone post anonymously, with their score unverified', async () => {
    expect((await post({ name: 'Walker' })).status).toBe(200);
    expect((await json(await call('GET', '/scores?board=v3', { origin: null }))).scores[0]).toMatchObject({ name: 'Walker', verified: false });
  });

  it('keeps anonymous players off a name an account has claimed', async () => {
    const token = await signIn();
    await setName(token, 'Ann');
    for (const name of ['Ann', 'ann', 'ANN']) {
      const res = await post({ name, ip: `1.1.1.${name.length}${name.charCodeAt(0)}` });
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/signed-in/);
    }
    expect((await post({ name: 'Anna', ip: '2.2.2.2' })).status).toBe(200); // a different name is fine
  });
});

describe('the cloud save', () => {
  const put = (token: string, save: unknown) => call('PUT', '/me/save', { token, body: { save } });

  it('starts empty', async () => {
    expect(await json(await call('GET', '/me/save', { token: await signIn() }))).toEqual({ save: null, updatedAt: null });
  });

  it('keeps the best of everything sent from different devices', async () => {
    const token = await signIn();
    await put(token, { best: { v1: 100 }, bestTime: { survival: 60 }, sent: { v1: true }, hints: { aim: true }, look: '111' });
    const res = await put(token, { best: { v1: 50, v2: 30 }, bestTime: { survival: 90 }, sent: { v2: true }, hints: { pump: true }, look: '222' });
    expect((await json(res)).save).toEqual({ best: { v1: 100, v2: 30 }, bestTime: { survival: 90 }, sent: { v1: true, v2: true }, hints: { aim: true, pump: true }, look: '222' });
    expect((await json(await call('GET', '/me/save', { token }))).save.best).toEqual({ v1: 100, v2: 30 });
  });

  it('keeps each person\'s save to themselves', async () => {
    const a = await signIn('github');
    const b = await signIn('github', 'gh-other');
    await put(a, { best: { v1: 100 } });
    expect((await json(await call('GET', '/me/save', { token: b }))).save).toBeNull();
  });

  it('drops anything that does not belong in a save', async () => {
    const token = await signIn();
    const res = await put(token, { best: { v1: 5, 'not a board': 9, v2: -4, v3: 1.5, v4: '7', v5: 2e9 }, sent: { v1: true, v2: 'yes', survival: false }, hints: { aim: true, 'BAD KEY': true }, look: '999', extra: 'x' });
    expect((await json(res)).save).toEqual({ best: { v1: 5 }, bestTime: {}, sent: { v1: true }, hints: { aim: true } });
    expect((await put(token, 'nonsense')).status).toBe(200); // junk in is an empty save, not a crash
  });

  it('needs a session', async () => {
    expect((await call('GET', '/me/save')).status).toBe(401);
    expect((await call('PUT', '/me/save', { body: { save: {} } })).status).toBe(401);
  });
});

describe('deleting an account', () => {
  it('removes the account, its scores and its save, and frees the name', async () => {
    const token = await signIn();
    await setName(token, 'Ann');
    await call('PUT', '/me/save', { token, body: { save: { best: { v1: 5 } } } });
    await env.DB.prepare("INSERT INTO scores (board, name, score, seconds, created_at) VALUES ('v1', 'Ann', 5, 0, 1), ('v1', 'Other', 9, 0, 2)").run();
    await env.DB.prepare("INSERT INTO players (name, look, updated_at) VALUES ('Ann', '123', 1)").run();

    expect((await call('DELETE', '/me', { token })).status).toBe(200);
    expect((await call('GET', '/me', { token })).status).toBe(401);
    for (const table of ['users', 'sessions', 'saves', 'players']) expect(await rows(`SELECT 1 FROM ${table}`)).toHaveLength(0);
    expect((await rows('SELECT name FROM scores')).map((r) => r.name)).toEqual(['Other']); // only theirs go
    const again = await signIn();
    expect((await setName(again, 'Ann')).status).toBe(200); // the name is free
  });
});

describe('names and accounts an admin has banned', () => {
  const asAdmin = (fn: (m: typeof import('../worker/src/moderation')) => Promise<unknown>) => import('../worker/src/moderation').then(fn);

  it('cannot sign in again once the account is banned, and its sessions are gone', async () => {
    const token = await signIn();
    await setName(token, 'Fakey');
    await asAdmin((m) => m.removeAccount(env.DB, 'admin@example.com', 'Fakey', { ban: true, reason: 'offensive' }));
    expect((await call('GET', '/me', { token })).status).toBe(401);
    const back = await callback('github', { code: 'gh-good', state: stateOf(await start('github')) });
    expect(back.headers.get('Location')).toBe(`${RETURN}#login_error=banned`);
    expect(await rows('SELECT 1 FROM users')).toHaveLength(0);
    // somebody else can still sign in
    expect(await signIn('github', 'gh-other')).toBeTruthy();
  });

  it('is only banned if asked to: deleting an account alone lets the person come back', async () => {
    const token = await signIn();
    await setName(token, 'Fakey');
    await asAdmin((m) => m.removeAccount(env.DB, 'admin@example.com', 'Fakey'));
    expect(await signIn()).toBeTruthy();
  });

  it('refuses a banned name when choosing a name and when posting a score', async () => {
    await asAdmin((m) => m.removePlayer(env.DB, 'admin@example.com', 'Rude Name', { ban: true }));
    const token = await signIn();
    expect((await setName(token, 'rude name')).status).toBe(400); // any capitals
    expect((await setName(token, 'Polite')).status).toBe(200);
    const level = gradeLevel(3);
    let played = playBot(level, 1);
    for (let s = 2; !(played.ended && played.score > 0); s++) played = playBot(level, s);
    const res = await call('POST', '/scores', { body: { board: 'v3', name: 'RUDE NAME', score: played.score, replay: played.replay } });
    expect(res.status).toBe(403);
    expect((await json(await call('GET', '/scores?board=v3', { origin: null }))).scores).toEqual([]);
  });
});
