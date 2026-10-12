import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { allowedOrigin, cleanName as serverCleanName, parseSubmission, POSTS_PER_MINUTE } from '../worker/src/rules';
import { gradeLevel, survivalLevel } from '../src/game/levels';
import { playReplay, Replay } from '../src/game/replay';
import { playBot } from './bot';
import { boardFor, boardTitle, cleanName, fetchTop, lastPlayedBoard, postScore, rememberBoard, todaysBoard } from '../src/game/leaderboard';

/** A finished round on a grade, as a replay, with the score the engine gives it. */
function round(grade: number, seed: number) {
  const level = gradeLevel(grade);
  for (let s = seed; ; s++) {
    const played = playBot(level, s);
    if (played.ended && played.score > 0) return { replay: played.replay, score: played.score };
  }
}
const REPLAY: Replay = { shots: [[1, 0, 5]], tail: 0 };

describe('the rules', () => {
  it('accepts a normal submission and tidies the name', () => {
    expect(parseSubmission({ board: 'v3', name: '  Owain   W ', replay: REPLAY })).toEqual({ board: 'v3', name: 'Owain W', replay: { seed: undefined, ...REPLAY } });
    expect(parseSubmission({ board: 'survival', name: 'Sam', replay: { ...REPLAY, seed: 9 } })).toMatchObject({ replay: { seed: 9 } });
    expect(parseSubmission({ board: 'daily-2026-10-12', name: 'Sam', replay: REPLAY })).toMatchObject({ board: 'daily-2026-10-12' });
  });

  it('tells old copies of the game to reload', () => {
    expect(parseSubmission({ board: 'v3', name: 'Sam', score: 100 })).toMatch(/out of date/);
  });

  it.each([
    [{ board: 'nope', name: 'Sam', replay: REPLAY }],
    [{ board: 'v3', name: 'Sam' }],
    [{ board: 'v3', name: 'Sam', replay: { shots: 'x', tail: 0 } }],
    [{ board: 'v3', name: '', replay: REPLAY }],
    [{ board: 'v3', name: 'x'.repeat(13), replay: REPLAY }],
    [{ board: 'v3', name: '<script>', replay: REPLAY }],
    [{ board: 'v3', name: '-dash', replay: REPLAY }],
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

  it('starts empty, works the score out itself, ranks it, and keeps each player’s best', async () => {
    const empty = await call(env, 'GET', '/scores?board=v3');
    expect(await empty.json()).toEqual({ board: 'v3', scores: [] });
    expect(empty.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    const low = round(3, 1);
    let high = round(3, 50);
    for (let seed = 51; high.score <= low.score && seed < 400; seed++) high = round(3, seed);
    expect(high.score).toBeGreaterThan(low.score);

    type Posted = { rank: number; best: number; score: number };
    const post = async (name: string, r: { replay: Replay }, extra: object = {}) => (await (await call(env, 'POST', '/scores', { board: 'v3', name, replay: r.replay, ...extra })).json()) as Posted;
    expect(await post('Ann', low)).toEqual({ rank: 1, best: low.score, score: low.score });
    expect(await post('Bob', high)).toEqual({ rank: 1, best: high.score, score: high.score });
    expect(await post('ann', high)).toEqual({ rank: 1, best: high.score, score: high.score }); // names match regardless of case
    expect(await post('Ann', low)).toMatchObject({ rank: 1, best: high.score, score: low.score }); // a lower score doesn't replace the best
    // a score claimed in the body is ignored
    expect(await post('Cat', low, { score: 99999, seconds: 5 })).toMatchObject({ score: low.score, best: low.score, rank: 3 });

    const top = (await (await call(env, 'GET', '/scores?board=v3')).json()) as { scores: { name: string; score: number }[] };
    expect(top.scores.map((s) => [s.name, s.score])).toEqual([['Bob', high.score], ['Ann', high.score], ['Cat', low.score]]);
  });

  it('keeps boards apart, stores the survival time, and returns only the top 10', async () => {
    const level = survivalLevel(4242);
    const played = playBot(level, 4242, 0.7, 4);
    expect(played.ended).toBe(true);
    await call(env, 'POST', '/scores', { board: 'survival', name: 'Sam', replay: played.replay });
    const s = (await (await call(env, 'GET', '/scores?board=survival')).json()) as { scores: unknown[] };
    expect(s.scores).toEqual([{ name: 'Sam', score: played.score, seconds: Math.round(played.seconds) }]);
    expect(((await (await call(env, 'GET', '/scores?board=v1')).json()) as { scores: unknown[] }).scores).toEqual([]);

    const r = round(2, 7);
    for (let i = 0; i < 12; i++) await call(env, 'POST', '/scores', { board: 'v2', name: `P${i}`, replay: r.replay }, { Origin: ORIGIN, 'CF-Connecting-IP': `10.0.0.${i}` });
    const v2 = (await (await call(env, 'GET', '/scores?board=v2')).json()) as { scores: unknown[] };
    expect(v2.scores).toHaveLength(10);
  });

  it('refuses replays that are fake, for the wrong wall, or unfinished', async () => {
    const r = round(3, 1);
    const post = async (body: object) => call(env, 'POST', '/scores', { name: 'Sam', ...body });
    const wrongWall = await post({ board: 'v4', replay: r.replay });
    const outcome = playReplay(gradeLevel(4), r.replay);
    // the same moves on another wall are a different game: either refused, or scored as whatever they really score
    expect(wrongWall.status).toBe(outcome.ok && outcome.score > 0 ? 200 : 400);

    expect((await post({ board: 'v3', replay: { ...r.replay, shots: r.replay.shots.slice(0, -1) } })).status).toBe(400);
    expect((await post({ board: 'v3', replay: { shots: [], tail: 5 } })).status).toBe(400);
    const noScore = await post({ board: 'v3', replay: { shots: [], tail: 120 * 3600 } });
    expect(noScore.status).toBe(400);
    expect((await post({ board: 'survival', replay: r.replay })).status).toBe(400); // survival needs its seed
    expect((await post({ board: 'daily-2001-01-01', replay: r.replay })).status).toBe(400); // long gone
    expect(((await (await post({ board: 'v3', replay: { shots: [[1, 0, 5]], tail: 0 } })).json()) as { error: string }).error).toMatch(/Replay rejected/);
  });

  it('refuses bad requests', async () => {
    const r = round(3, 1);
    expect((await call(env, 'GET', '/scores?board=bad')).status).toBe(400);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', replay: r.replay }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', replay: r.replay }, {})).status).toBe(403);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', score: 5000 })).status).toBe(400);
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
    const r = round(3, 1);
    for (let i = 0; i < POSTS_PER_MINUTE + 2; i++) statuses.push((await call(env, 'POST', '/scores', { board: 'v3', name: 'Sam', replay: r.replay }, { Origin: ORIGIN, 'CF-Connecting-IP': '1.2.3.4' })).status);
    expect(statuses.slice(0, POSTS_PER_MINUTE).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(POSTS_PER_MINUTE)).toEqual([429, 429]);
    expect((await call(env, 'POST', '/scores', { board: 'v3', name: 'Other', replay: r.replay }, { Origin: ORIGIN, 'CF-Connecting-IP': '5.6.7.8' })).status).toBe(200);
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

  it('remembers the board of the last round, so the Leaderboard screen can open on it', () => {
    expect(lastPlayedBoard()).toBeNull();
    rememberBoard('v4');
    expect(lastPlayedBoard()).toBe('v4');
  });

  it('posts a replay and reports how it went', async () => {
    const f = vi.fn(async () => Response.json({ rank: 3, best: 900, score: 900 }));
    vi.stubGlobal('fetch', f);
    expect(await postScore('v3', 'Ann', REPLAY)).toEqual({ ok: true, message: 'Leaderboard rank #3' });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ board: 'v3', name: 'Ann', replay: REPLAY });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ rank: 2, best: 1500, score: 900 })));
    expect((await postScore('v3', 'Ann', REPLAY)).message).toBe('Your best here is 1500 (rank #2)');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Replay rejected: The run did not finish' }, { status: 400 })));
    expect(await postScore('v3', 'x', REPLAY)).toEqual({ ok: false, message: 'Replay rejected: The run did not finish' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await postScore('v3', 'Ann', REPLAY)).toEqual({ ok: false, message: "Couldn't reach the leaderboard" });
  });
});
