import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { boardView, latestDaily, listBoards, outfitOf, utcDay } from '../worker/src/v1';
import { fakeD1 } from './fakeD1';

type Env = { DB: ReturnType<typeof fakeD1> };
const ELSEWHERE = 'https://someones-blog.example';

let env: Env;
let clock = 1_000;
const add = (board: string, name: string, score: number, seconds = 0) => env.DB.prepare('INSERT INTO scores (board, name, score, seconds, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(board, name, score, seconds, clock++).run();
const wear = (name: string, look: string) => env.DB.prepare('INSERT INTO players (name, look, updated_at) VALUES (?1, ?2, 1)').bind(name, look).run();
const get = (path: string, headers: Record<string, string> = { Origin: ELSEWHERE }, ctx?: { waitUntil(p: Promise<unknown>): void }) => worker.fetch(new Request(`https://api.example${path}`, { headers }), env, ctx);
const json = async (res: Response) => (await res.json()) as Record<string, any>;

beforeEach(() => {
  env = { DB: fakeD1() };
});
afterEach(() => vi.unstubAllGlobals());

describe('the public read API', () => {
  it('describes itself', async () => {
    const res = await get('/v1');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.version).toBe(1);
    expect(body.endpoints).toContain('GET /v1/boards');
    expect((await get('/')).status).toBe(200);
    expect((await get('/v1/')).status).toBe(200);
  });

  it('can be read from any website, and says it may be cached for 30 seconds', async () => {
    const res = await get('/v1/boards/v3');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
    expect((await get('/v1/boards/v3', {})).headers.get('Access-Control-Allow-Origin')).toBe('*'); // no Origin, e.g. a server
  });

  it('answers a browser asking whether it may read, from anywhere, but not whether it may post', async () => {
    const read = await worker.fetch(new Request('https://api.example/v1/boards', { method: 'OPTIONS', headers: { Origin: ELSEWHERE, 'Access-Control-Request-Method': 'GET' } }), env);
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(read.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    const post = await worker.fetch(new Request('https://api.example/scores', { method: 'OPTIONS', headers: { Origin: ELSEWHERE, 'Access-Control-Request-Method': 'POST' } }), env);
    expect(post.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('still refuses posts from other websites', async () => {
    const res = await worker.fetch(new Request('https://api.example/scores', { method: 'POST', headers: { Origin: ELSEWHERE, 'Content-Type': 'application/json' }, body: '{}' }), env);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('lists boards in a sensible order, with the Daily alias', async () => {
    const today = utcDay();
    await add('v10', 'A', 10);
    await add('v2', 'A', 20);
    await add('v2', 'B', 30);
    await add('survival', 'A', 500, 60);
    await add(`daily-${today}`, 'A', 70);
    await add('daily-2020-01-01', 'A', 5);
    const body = await json(await get('/v1/boards'));
    expect(body.boards.map((b: { id: string }) => b.id)).toEqual(['v2', 'v10', 'survival', `daily-${today}`, 'daily-2020-01-01']);
    expect(body.boards[0]).toEqual({ id: 'v2', title: 'V2', kind: 'grade', entries: 2, topScore: 30 });
    expect(body.boards[3]).toMatchObject({ title: 'Daily Boulder', kind: 'daily' });
    expect(body.boards[4].title).toBe('Daily 2020-01-01');
    expect(body.aliases.daily).toBe(`daily-${today}`);
  });

  it('shows a board with ranks, times and climber colours', async () => {
    await add('v3', 'Ann', 900);
    await add('v3', 'Bob', 700);
    await add('v3', 'Cat', 700); // a tie: whoever got there first stays ahead
    await wear('ann', '741'); // players match names regardless of case
    const res = await get('/v1/boards/v3');
    const body = await json(res);
    expect(body).toMatchObject({ board: 'v3', title: 'V3', kind: 'grade' });
    expect(body.scores.map((s: { rank: number; name: string }) => [s.rank, s.name])).toEqual([[1, 'Ann'], [2, 'Bob'], [3, 'Cat']]);
    expect(body.scores[0]).toEqual({ rank: 1, name: 'Ann', score: 900, seconds: 0, look: '741', outfit: { beanie: '#f5c518', shirt: '#a05cf0', bag: '#2f6fdd' }, verified: false });
    expect(body.scores[1].look).toBe('');
    expect(body.scores[1].outfit).toEqual(outfitOf('000')); // someone with no look gets the starting outfit
  });

  it('shows survival times', async () => {
    await add('survival', 'Ann', 5210, 273);
    expect((await json(await get('/v1/boards/survival'))).scores[0]).toMatchObject({ score: 5210, seconds: 273 });
  });

  it('limits how many scores it returns, and ignores a silly limit', async () => {
    for (let i = 0; i < 12; i++) await add('v1', `P${i}`, 100 + i);
    const n = async (q: string) => (await json(await get(`/v1/boards/v1${q}`))).scores.length;
    expect(await n('')).toBe(10);
    expect(await n('?limit=3')).toBe(3);
    expect(await n('?limit=999')).toBe(10);
    expect(await n('?limit=0')).toBe(1);
    expect(await n('?limit=-5')).toBe(1);
    expect(await n('?limit=abc')).toBe(10);
    expect(await n('?limit=2.9')).toBe(2);
  });

  it('opens "daily" on the newest Daily board that has scores', async () => {
    await add('daily-2020-01-01', 'Old', 1);
    expect((await json(await get('/v1/boards/daily'))).board).toBe('daily-2020-01-01');
    const today = utcDay();
    await add(`daily-${today}`, 'New', 2);
    const body = await json(await get('/v1/boards/daily'));
    expect(body).toMatchObject({ board: `daily-${today}`, title: 'Daily Boulder' });
    // a board dated far in the future (nobody can post to those) is not picked
    await add('daily-2099-01-01', 'Future', 3);
    expect((await json(await get('/v1/boards/daily'))).board).toBe(`daily-${today}`);
  });

  it('opens "daily" even before anyone has played, with an empty list', async () => {
    const body = await json(await get('/v1/boards/daily'));
    expect(body.board).toBe(`daily-${utcDay()}`);
    expect(body.scores).toEqual([]);
  });

  it('refuses boards that do not exist', async () => {
    for (const path of ['/v1/boards/nope', '/v1/boards/v', '/v1/boards/daily-2026-1-1', '/v1/boards/%E0%A4%A']) {
      const res = await get(path);
      expect([404, 500]).toContain(res.status); // a broken % escape must not crash the Worker
    }
    expect((await get('/v1/boards/nope')).status).toBe(404);
    expect((await get('/v1/nothing')).status).toBe(404);
    expect((await get('/elsewhere')).status).toBe(404);
  });

  it('shows a player\'s best on every board, with their rank there', async () => {
    await add('v1', 'Zed', 900);
    await add('v1', 'Ann', 500);
    await add('v1', 'Bob', 100);
    await add('survival', 'Ann', 4000, 200);
    await wear('Ann', '503');
    const body = await json(await get('/v1/players/ann'));
    expect(body).toMatchObject({ name: 'Ann', look: '503', outfit: outfitOf('503') });
    expect(body.bests).toEqual([
      { board: 'survival', title: 'Survival', kind: 'survival', score: 4000, seconds: 200, rank: 1 },
      { board: 'v1', title: 'V1', kind: 'grade', score: 500, seconds: 0, rank: 2 },
    ]);
  });

  it('says nothing about players who have no scores, or names that cannot be players', async () => {
    await add('v1', 'Ann', 5);
    expect((await get('/v1/players/Nobody')).status).toBe(404);
    expect((await get('/v1/players/%3Cscript%3E')).status).toBe(404);
    expect((await get('/v1/players/' + 'x'.repeat(40))).status).toBe(404);
  });

  it('works out board views and the Daily alias directly, for a given day', async () => {
    const now = Date.UTC(2026, 9, 12, 12);
    await add('daily-2026-10-12', 'A', 1);
    await add('daily-2026-10-13', 'B', 2); // tomorrow in UTC: a player in Auckland may already be on it
    await add('daily-2026-10-14', 'C', 3); // too far ahead
    expect(await latestDaily(env.DB, now)).toBe('daily-2026-10-13');
    expect((await listBoards(env.DB, now)).aliases.daily).toBe('daily-2026-10-13');
    expect((await boardView(env.DB, 'daily-2026-10-12', 10, now))?.title).toBe('Daily Boulder');
    expect((await boardView(env.DB, 'daily-2026-10-13', 10, now))?.title).toBe('Daily 2026-10-13');
    expect(await boardView(env.DB, 'nope', 10, now)).toBeNull();
  });

  it('turns a look code into CSS colours', () => {
    expect(outfitOf('000')).toEqual({ beanie: '#2f6fdd', shirt: '#e5484d', bag: '#d9622b' });
    expect(outfitOf('')).toEqual(outfitOf('000'));
    expect(outfitOf('999')).toEqual(outfitOf('000')); // not a look: the starting one
  });

  it('keeps the game\'s own leaderboard call fresh, not cached', async () => {
    await add('v3', 'Ann', 900);
    const res = await get('/scores?board=v3');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await json(res)).scores[0]).toMatchObject({ name: 'Ann', score: 900 });
  });
});

describe('the edge cache', () => {
  /** A stand-in for Cloudflare's caches.default. */
  function stubCache() {
    const store = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (r: Request) => store.get(r.url)?.clone()),
      put: vi.fn(async (r: Request, res: Response) => void store.set(r.url, res)),
    };
    vi.stubGlobal('caches', { default: cache });
    const pending: Promise<unknown>[] = [];
    return { cache, ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) }, settle: () => Promise.all(pending) };
  }

  it('answers repeat calls from the cache, so the database is not asked again', async () => {
    const { cache, ctx, settle } = stubCache();
    await add('v3', 'Ann', 900);
    const first = await json(await get('/v1/boards/v3', undefined, ctx));
    await settle();
    await add('v3', 'Bob', 1000); // a new top score arrives
    const second = await json(await get('/v1/boards/v3', undefined, ctx));
    expect(second).toEqual(first); // still the cached answer
    expect(second.scores).toHaveLength(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('caches each address separately', async () => {
    const { ctx, settle } = stubCache();
    await add('v3', 'Ann', 900);
    await add('v4', 'Bob', 500);
    await get('/v1/boards/v3', undefined, ctx);
    await settle();
    expect((await json(await get('/v1/boards/v4', undefined, ctx))).scores[0].name).toBe('Bob');
    expect((await json(await get('/v1/boards/v3?limit=1', undefined, ctx))).scores).toHaveLength(1);
  });

  it('does not cache errors, or the game\'s own calls', async () => {
    const { cache, ctx, settle } = stubCache();
    await get('/v1/boards/nope', undefined, ctx);
    await get('/v1/players/Nobody', undefined, ctx);
    await get('/scores?board=v3', undefined, ctx);
    await settle();
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.match).toHaveBeenCalledTimes(2); // the two /v1 calls looked, the game's call did not
  });

  it('works without an edge cache (a plain Worker, or tests)', async () => {
    await add('v3', 'Ann', 900);
    expect((await get('/v1/boards/v3')).status).toBe(200);
  });
});
