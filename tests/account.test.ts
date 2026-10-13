// The game's account code against the real Worker (and its real SQL), with a pretend GitHub and Google in between.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { API_URL } from '../src/config';
import { availableProviders, chooseName, completeSignIn, deleteAccount, expireSession, onAccountChange, prepareSignIn, signInAddress, signOut, syncNow, syncSoon, takeNotice } from '../src/game/account';
import { gradeLevel } from '../src/game/levels';
import { postScore } from '../src/game/leaderboard';
import { getAuth, getCloudSave, getLookCode, getPlayerName, recordResult, recordTime, setAuth, setLookCode, setPlayerName } from '../src/game/storage';
import { playBot } from './bot';
import { fakeD1 } from './fakeD1';
import { fakeProviders } from './providers';

const GAME = 'https://thesecretstage.vip';
const PAGE = { origin: GAME, pathname: '/Beta-Blast/' };

type Env = { DB: ReturnType<typeof fakeD1>; GH_CLIENT_ID: string; GH_CLIENT_SECRET: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
let env: Env;
let store: Map<string, string>;
let serverCalls: string[];

/** The browser: sends calls for the API to the Worker (as the game's own site) and everything else to the pretend providers. */
function stubBrowser() {
  const providers = fakeProviders();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(API_URL)) return providers(input, init);
      serverCalls.push(`${init?.method ?? 'GET'} ${url.slice(API_URL.length).split('?')[0]}`);
      return worker.fetch(new Request(url, { ...init, headers: { Origin: GAME, ...(init?.headers as Record<string, string>) } }), env);
    }),
  );
}

/** Do the browser's trip to the provider and back. Returns the address the game is opened at afterwards. */
async function comeBackFromProvider(provider: 'github' | 'google' = 'github', code = provider === 'github' ? 'gh-good' : 'g-good') {
  const challenge = await prepareSignIn(); // also keeps the secret in this browser's storage
  const start = await worker.fetch(new Request(signInAddress(provider, challenge, PAGE)), env);
  const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
  const back = await worker.fetch(new Request(`${API_URL}/auth/${provider}/callback?${new URLSearchParams({ code, state })}`), env);
  const to = new URL(back.headers.get('Location')!);
  return { hash: to.hash, pathname: to.pathname, search: to.search };
}
const history = () => ({ replaceState: vi.fn() });
const signIn = async (provider: 'github' | 'google' = 'github', code?: string) => completeSignIn(await comeBackFromProvider(provider, code), history());
const dbRows = async (sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all()).results as Record<string, any>[];

beforeEach(() => {
  env = { DB: fakeD1(), GH_CLIENT_ID: 'ghid', GH_CLIENT_SECRET: 'ghsecret', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' };
  store = new Map();
  serverCalls = [];
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  stubBrowser();
  takeNotice();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('asks again if no provider was set up yet, so setting sign-in up does not need a reload', async () => {
    const saved = { ...env };
    delete (env as Partial<Env>).GH_CLIENT_ID;
    delete (env as Partial<Env>).GOOGLE_CLIENT_ID;
    expect(await availableProviders()).toEqual([]);
    Object.assign(env, saved); // the secrets are added
    expect(await availableProviders()).toEqual(['github', 'google']);
  });

  it('offers the providers the server has set up, and the address that starts a sign-in', async () => {
    expect(await availableProviders()).toEqual(['github', 'google']);
    expect(signInAddress('google', 'ab'.repeat(32), PAGE)).toBe(`${API_URL}/auth/google/start?return_to=${encodeURIComponent('https://thesecretstage.vip/Beta-Blast/')}&challenge=${'ab'.repeat(32)}`);
  });

  it('completes a GitHub sign-in: the code in the address becomes a session on this device', async () => {
    const heard = vi.fn();
    onAccountChange(heard);
    const h = history();
    await completeSignIn(await comeBackFromProvider('github'), h);
    expect(getAuth()).toMatchObject({ provider: 'github', name: null });
    expect(getAuth()!.token.length).toBeGreaterThan(30);
    expect(h.replaceState).toHaveBeenCalledWith(null, '', '/Beta-Blast/'); // the one-time code is taken out of the address bar
    expect(takeNotice()).toBe('Signed in with GitHub');
    expect(takeNotice()).toBe(''); // shown once
    expect(heard).toHaveBeenCalled();
  });

  it('works with Google too', async () => {
    await signIn('google');
    expect(getAuth()?.provider).toBe('google');
  });

  it('does nothing for an ordinary page load', async () => {
    const h = history();
    await completeSignIn({ hash: '', pathname: '/Beta-Blast/', search: '' }, h);
    await completeSignIn({ hash: '#something-else', pathname: '/Beta-Blast/', search: '' }, h);
    expect(h.replaceState).not.toHaveBeenCalled();
    expect(getAuth()).toBeNull();
    expect(serverCalls).toEqual([]);
  });

  it('says what happened when the player says no, or the provider fails', async () => {
    await completeSignIn({ hash: '#login_error=denied', pathname: '/', search: '?x=1' }, history());
    expect(takeNotice()).toBe('Sign-in cancelled');
    await completeSignIn({ hash: '#login_error=failed', pathname: '/', search: '' }, history());
    expect(takeNotice()).toMatch(/try again/);
    expect(getAuth()).toBeNull();
  });

  it('keeps its secret to itself: only a hash goes to the server, and each secret works once', async () => {
    const challenge = await prepareSignIn();
    const secret = store.get('beta-blast.verifier')!;
    expect(secret).not.toBe(challenge);
    expect(challenge).toMatch(/^[a-f0-9]{64}$/);
    expect(secret.length).toBeGreaterThanOrEqual(40);
    expect(await prepareSignIn()).not.toBe(challenge); // a new secret each time
    await signIn();
    expect(store.has('beta-blast.verifier')).toBe(false); // used up
  });

  it('refuses to finish a sign-in this browser did not start', async () => {
    const back = await comeBackFromProvider('github');
    store.delete('beta-blast.verifier'); // as if the link were opened on another device or browser
    serverCalls.length = 0;
    await completeSignIn(back, history());
    expect(getAuth()).toBeNull();
    expect(takeNotice()).toMatch(/Start again/);
    expect(serverCalls).toEqual([]);

    // or one that someone else started: this browser holds a different secret
    const theirs = await comeBackFromProvider('github');
    store.set('beta-blast.verifier', 'u'.repeat(43));
    await completeSignIn(theirs, history());
    expect(getAuth()).toBeNull();
    expect(takeNotice()).toMatch(/expired/);
  });

  it('copes with a code that has been used, or was made up', async () => {
    const back = await comeBackFromProvider('github');
    await completeSignIn(back, history());
    setAuth(null);
    takeNotice();
    await prepareSignIn(); // even with a fresh secret in hand
    await completeSignIn(back, history()); // the same code again
    expect(getAuth()).toBeNull();
    expect(takeNotice()).toMatch(/expired/);
    await prepareSignIn();
    await completeSignIn({ hash: '#login=not-a-real-code-at-all-1234', pathname: '/', search: '' }, history());
    expect(getAuth()).toBeNull();
  });
});

describe('keeping the save in step', () => {
  it('merges this device with the account both ways', async () => {
    recordResult('v1', 300, true);
    recordTime('survival', 100);
    await signIn(); // syncs as part of signing in
    // the account now has this device's progress...
    expect((await dbRows('SELECT data FROM saves'))[0].data).toContain('"v1":300');

    // ...and a second device, signed in as the same person, adds its own and receives the first's
    const first = getAuth()!;
    store.clear();
    setAuth(first); // the other device has the session but a fresh, different save
    recordResult('v2', 900, true);
    recordResult('v1', 100, false);
    await syncNow();
    expect(getCloudSave()).toMatchObject({ best: { v1: 300, v2: 900 }, bestTime: { survival: 100 }, sent: { v1: true, v2: true } });
    expect(JSON.parse((await dbRows('SELECT data FROM saves'))[0].data).best).toEqual({ v1: 300, v2: 900 });
  });

  it('only changes the account\'s outfit if this player has picked one', async () => {
    setLookCode('123');
    await signIn();
    expect(JSON.parse((await dbRows('SELECT data FROM saves'))[0].data).look).toBe('123');
    const token = getAuth()!;
    store.clear();
    setAuth(token); // another device that has never picked an outfit
    await syncNow();
    expect(getLookCode()).toBe('123'); // it takes the account's outfit...
    expect(JSON.parse((await dbRows('SELECT data FROM saves'))[0].data).look).toBe('123'); // ...and doesn't overwrite it with the default
  });

  it('skips the upload when the cloud already has everything', async () => {
    recordResult('v1', 300, true);
    await signIn();
    serverCalls.length = 0;
    await syncNow();
    expect(serverCalls).toEqual(['GET /me', 'GET /me/save']);
  });

  it('copies changes to the account a few seconds after they happen, once', async () => {
    await signIn();
    vi.useFakeTimers();
    serverCalls.length = 0;
    recordResult('v1', 100, false);
    recordResult('v1', 200, false);
    recordResult('v2', 50, true);
    expect(serverCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(3500); // the timer fires and the sync starts...
    vi.useRealTimers();
    await vi.waitFor(() => expect(serverCalls).toContain('PUT /me/save')); // ...and finishes (hashing happens outside the fake clock)
    expect(serverCalls.filter((c) => c === 'PUT /me/save')).toHaveLength(1);
    expect(JSON.parse((await dbRows('SELECT data FROM saves'))[0].data).best).toEqual({ v1: 200, v2: 50 });
  });

  it('does not talk to the server at all when playing as a guest', async () => {
    vi.useFakeTimers();
    recordResult('v1', 100, true);
    syncSoon();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await syncNow()).toBe(false);
    expect(serverCalls).toEqual([]);
  });

  it('carries on as a guest if the session has run out', async () => {
    recordResult('v1', 100, true);
    await signIn();
    takeNotice();
    await env.DB.prepare('DELETE FROM sessions').run();
    expect(await syncNow()).toBe(false);
    expect(getAuth()).toBeNull();
    expect(takeNotice()).toMatch(/expired/);
    expect(getCloudSave().best).toEqual({ v1: 100 }); // nothing lost
  });

  it('survives the server being unreachable', async () => {
    await signIn();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await syncNow()).toBe(false);
    expect(getAuth()).not.toBeNull(); // offline is not the same as signed out
  });

  it('can be told the session is gone', () => {
    setAuth({ token: 'x', name: null, provider: 'github' });
    const heard = vi.fn();
    onAccountChange(heard);
    expireSession();
    expireSession(); // a second time does nothing more
    expect(getAuth()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('the account\'s name and the leaderboard', () => {
  it('uses the account name once there is one, and says it is taken if it is', async () => {
    await signIn();
    setPlayerName('Walker'); // a name typed as a guest
    expect(getPlayerName()).toBe('Walker');
    expect(await chooseName('Ann')).toEqual({ ok: true, message: 'You are Ann' });
    expect(getAuth()?.name).toBe('Ann');
    expect(getPlayerName()).toBe('Ann'); // the account's name now wins

    // someone else, on another device, can't have it
    setAuth(null);
    await signIn('github', 'gh-other');
    expect(await chooseName('ann')).toEqual({ ok: false, message: 'That name is taken' });
    expect(getAuth()?.name).toBeNull();
  });

  it('posts a score under the account name with the session, and marks it as theirs', async () => {
    await signIn();
    await chooseName('Ann');
    const level = gradeLevel(3);
    let round = playBot(level, 1);
    for (let s = 2; !(round.ended && round.score > 0); s++) round = playBot(level, s);
    const result = await postScore('v3', 'Ann', round.score, 0, '123', round.replay);
    expect(result.ok).toBe(true);
    const board = (await (await worker.fetch(new Request(`${API_URL}/scores?board=v3`), env)).json()) as { scores: { name: string; verified: boolean }[] };
    expect(board.scores).toEqual([expect.objectContaining({ name: 'Ann', verified: true })]);
  });

  it('forgets a session the server turns down when posting', async () => {
    setAuth({ token: 'x'.repeat(43), name: 'Ann', provider: 'github' });
    const level = gradeLevel(3);
    let round = playBot(level, 1);
    for (let s = 2; !(round.ended && round.score > 0); s++) round = playBot(level, s);
    const result = await postScore('v3', 'Ann', round.score, 0, '000', round.replay);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/expired/) });
    expect(getAuth()).toBeNull();
  });
});

describe('signing out and deleting', () => {
  it('signs out but keeps the save on the device', async () => {
    recordResult('v1', 100, true);
    await signIn();
    await signOut();
    expect(getAuth()).toBeNull();
    expect(takeNotice()).toBe('Signed out');
    expect(getCloudSave().best).toEqual({ v1: 100 });
    expect(await dbRows('SELECT 1 FROM sessions')).toHaveLength(0); // and the session is ended on the server
  });

  it('deletes the account and what the server held, but not the local save', async () => {
    recordResult('v1', 100, true);
    await signIn();
    await chooseName('Ann');
    expect(await deleteAccount()).toEqual({ ok: true, message: 'Account deleted' });
    expect(getAuth()).toBeNull();
    for (const t of ['users', 'sessions', 'saves']) expect(await dbRows(`SELECT 1 FROM ${t}`)).toHaveLength(0);
    expect(getCloudSave().best).toEqual({ v1: 100 });
  });

  it('keeps the account if the server could not delete it', async () => {
    await signIn();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect((await deleteAccount()).ok).toBe(false);
    expect(getAuth()).not.toBeNull();
  });
});
