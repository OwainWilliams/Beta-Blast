import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { allowedOrigin, cleanName as serverCleanName, MAX_SCORE, parseSubmission, POSTS_PER_MINUTE } from '../worker/src/rules';
import { boardFor, boardTitle, cleanName, fetchTop, postScore, todaysBoard } from '../src/game/leaderboard';

describe('the rules', () => {
  it('accepts a normal submission and tidies the name', () => {
    expect(parseSubmission({ board: 'v3', name: '  Owain   W ', score: 1200 })).toEqual({ board: 'v3', name: 'Owain W', score: 1200, seconds: 0 });
    expect(parseSubmission({ board: 'survival', name: 'Sam', score: 5000, seconds: 273 })).toMatchObject({ seconds: 273 });
    expect(parseSubmission({ board: 'daily-2026-10-12', name: 'Sam', score: 10 })).toMatchObject({ board: 'daily-2026-10-12' });
  });

  it.each([
    [{ board: 'nope', name: 'Sam', score: 10 }],
    [{ board: 'v3', name: 'Sam', score: 0 }],
    [{ board: 'v3', name: 'Sam', score: -5 }],
    [{ board: 'v3', name: 'Sam', score: 1.5 }],
    [{ board: 'v3', name: 'Sam', score: '10' }],
    [{ board: 'v3', name: 'Sam', score: MAX_SCORE + 1 }],
    [{ board: 'v3', name: 'Sam', score: 10, seconds: 5 }],
    [{ board: 'survival', name: 'Sam', score: 10, seconds: -1 }],
    [{ board: 'v3', name: '', score: 10 }],
    [{ board: 'v3', name: 'x'.repeat(13), score: 10 }],
    [{ board: 'v3', name: '<script>', score: 10 }],
    [{ board: 'v3', name: '-dash', score: 10 }],
    [null],
    ['text'],
  ])('refuses %j', (body) => expect(typeof parseSubmission(body)).toBe('string'));

  it('blocks rude names, even disguised', () => {
    expect(serverCleanName('Shit')).toBeNull();
    expect(serverCleanName('f.u c k')).toBeNull();
    expect(serverCleanName('sh1t')).toBeNull();
    expect(serverCleanName('Scunthorpe')).toBeNull(); // the known cost of matching inside words; the player can pick another name
    expect(serverCleanName('Climber_42')).toBe('Climber_42');
  });

  it('only allows the listed origins', () => {
    expect(allowedOrigin('https://thesecretstage.vip', 'https://thesecretstage.vip, http://localhost:5173')).toBe('https://thesecretstage.vip');
    expect(allowedOrigin('https://evil.example', 'https://thesecretstage.vip')).toBeNull();
    expect(allowedOrigin(null, 'https://thesecretstage.vip')).toBeNull();
  });
});

/** D1's interface on top of node's SQLite, so the real SQL in the Worker runs against the real schema. */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('worker/schema.sql', 'utf8'));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const st = {
      bind: (...a: unknown[]) => ((args = a), st),
      first: async () => (db.prepare(sql).get(...(args as never[])) as never) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...(args as never[])) as never[] }),
      run: async () => void db.prepare(sql).run(...(args as never[])),
    };
    return st;
  };
  return { prepare };
}

const ORIGIN = 'https://thesecretstage.vip';
const call = (env: { DB: ReturnType<typeof fakeD1> }, method: string, path: string, body?: unknown, headers: Record<string, string> = { Origin: ORIGIN }) =>
  worker.fetch(new Request(`https://api.example${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

describe('the Worker', () => {
  let env: { DB: ReturnType<typeof fakeD1> };
  beforeEach(() => {
    env = { DB: fakeD1() };
  });

  it('starts empty, ranks scores, and keeps each player’s best', async () => {
    const empty = await call(env, 'GET', '/scores?board=v3');
    expect(await empty.json()).toEqual({ board: 'v3', scores: [] });
    expect(empty.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    const post = async (name: string, score: number) => (await (await call(env, 'POST', '/scores', { board: 'v3', name, score })).json()) as { rank: number; best: number };
    expect(await post('Ann', 500)).toEqual({ rank: 1, best: 500 });
    expect(await post('Bob', 900)).toEqual({ rank: 1, best: 900 });
    expect(await post('ann', 700)).toEqual({ rank: 2, best: 700 }); // names match regardless of case
    expect(await post('Ann', 100)).toEqual({ rank: 2, best: 700 }); // a lower score doesn't replace the best

    const top = (await (await call(env, 'GET', '/scores?board=v3')).json()) as { scores: { name: string; score: number }[] };
    expect(top.scores.map((s) => [s.name, s.score])).toEqual([['Bob', 900], ['Ann', 700]]);
  });

  it('keeps boards apart, stores survival time, and returns only the top 10', async () => {
    await call(env, 'POST', '/scores', { board: 'survival', name: 'Sam', score: 5000, seconds: 273 });
    await call(env, 'POST', '/scores', { board: 'v1', name: 'Sam', score: 40 });
    const s = (await (await call(env, 'GET', '/scores?board=survival')).json()) as { scores: unknown[] };
    expect(s.scores).toEqual([{ name: 'Sam', score: 5000, seconds: 273 }]);
    for (let i = 0; i < 12; i++) await call(env, 'POST', '/scores', { board: 'v2', name: `P${i}`, score: 100 + i }, { Origin: ORIGIN, 'CF-Connecting-IP': `10.0.0.${i}` });
    const v2 = (await (await call(env, 'GET', '/scores?board=v2')).json()) as { scores: { score: number }[] };
    expect(v2.scores).toHaveLength(10);
    expect(v2.scores[0].score).toBe(111);
  });

  it('refuses bad requests', async () => {
    expect((await call(env, 'GET', '/scores?board=bad')).status).toBe(400);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', score: 99999999 })).status).toBe(400);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', score: 5 }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', score: 5 }, {})).status).toBe(403);
    expect((await call(env, 'GET', '/other')).status).toBe(404);
    expect((await call(env, 'DELETE', '/scores')).status).toBe(405);
    const junk = await worker.fetch(new Request('https://api.example/scores', { method: 'POST', headers: { Origin: ORIGIN }, body: '{nope' }), env);
    expect(junk.status).toBe(400);
  });

  it('answers the browser’s preflight, only for known origins', async () => {
    const ok = await call(env, 'OPTIONS', '/scores');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect((await call(env, 'OPTIONS', '/scores', undefined, { Origin: 'https://evil.example' })).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rate limits posts per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < POSTS_PER_MINUTE + 2; i++) statuses.push((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', score: i + 1 }, { Origin: ORIGIN, 'CF-Connecting-IP': '1.2.3.4' })).status);
    expect(statuses.slice(0, POSTS_PER_MINUTE).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(POSTS_PER_MINUTE)).toEqual([429, 429]);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Other', score: 5 }, { Origin: ORIGIN, 'CF-Connecting-IP': '5.6.7.8' })).status).toBe(200);
  });
});

describe('the game’s side', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('picks a board per level and cleans names the same way the server does', () => {
    expect(boardFor({ id: 'v3' })).toBe('v3');
    expect(boardFor({ id: 'survival' })).toBe('survival');
    expect(boardFor({ id: 'custom', custom: true })).toBeNull();
    expect(boardFor({ id: 'versus', versus: true })).toBeNull();
    expect(boardTitle('survival')).toBe('Survival');
    expect(boardTitle('v12')).toBe('V12');
    expect(boardTitle(todaysBoard())).toBe('Daily Boulder');
    expect(cleanName('  <b>Owain</b>  W ')).toBe('bOwainb W');
    expect(cleanName('!!!')).toBeNull();
    expect(cleanName('a'.repeat(30))).toHaveLength(12);
  });

  it('fetches the top scores, and gives null when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ scores: [{ name: 'Ann', score: 5, seconds: 0 }] })));
    expect(await fetchTop('v3')).toEqual([{ name: 'Ann', score: 5, seconds: 0 }]);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await fetchTop('v3')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await fetchTop('v3')).toBeNull();
  });

  it('posts a score and reports how it went', async () => {
    const f = vi.fn(async () => Response.json({ rank: 3, best: 900 }));
    vi.stubGlobal('fetch', f);
    expect(await postScore('v3', 'Ann', 900)).toEqual({ ok: true, message: 'Leaderboard rank #3' });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ board: 'v3', name: 'Ann', score: 900, seconds: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ rank: 2, best: 1500 })));
    expect((await postScore('v3', 'Ann', 900)).message).toBe('Your best here is 1500 (rank #2)');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'That name is not allowed.' }, { status: 400 })));
    expect(await postScore('v3', 'x', 5)).toEqual({ ok: false, message: 'That name is not allowed.' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await postScore('v3', 'Ann', 5)).toEqual({ ok: false, message: "Couldn't reach the leaderboard" });
  });

  it('only sends a time for survival', async () => {
    const f = vi.fn(async () => Response.json({ rank: 1, best: 5 }));
    vi.stubGlobal('fetch', f);
    await postScore('survival', 'Ann', 5, 119.6);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).seconds).toBe(120);
  });
});
