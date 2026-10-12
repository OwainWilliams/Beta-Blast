import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { allowedOrigin, cleanName as serverCleanName, parseSubmission, POSTS_PER_MINUTE } from '../worker/src/rules';
import { gradeLevel, survivalLevel } from '../src/game/levels';
import { plausible, playReplay, Replay, SCORE_BASE, SCORE_PER_SHOT } from '../src/game/replay';
import { playBot } from './bot';
import { fakeD1 } from './fakeD1';
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
const BODY = { score: 100, replay: REPLAY };

describe('the rules', () => {
  it('accepts a normal submission and tidies the name', () => {
    expect(parseSubmission({ board: 'v3', name: '  Owain   W ', ...BODY })).toEqual({ board: 'v3', name: 'Owain W', score: 100, seconds: 0, replay: { seed: undefined, ...REPLAY } });
    expect(parseSubmission({ board: 'survival', name: 'Sam', score: 5, seconds: 60, replay: { ...REPLAY, seed: 9 } })).toMatchObject({ seconds: 60, replay: { seed: 9 } });
    expect(parseSubmission({ board: 'daily-2026-10-12', name: 'Sam', ...BODY })).toMatchObject({ board: 'daily-2026-10-12' });
  });

  it('tells old copies of the game to reload', () => {
    expect(parseSubmission({ board: 'v3', name: 'Sam', score: 100 })).toMatch(/out of date/);
  });

  it.each([
    [{ board: 'nope', name: 'Sam', ...BODY }],
    [{ board: 'v3', name: 'Sam' }],
    [{ board: 'v3', name: 'Sam', score: 100, replay: { shots: 'x', tail: 0 } }],
    [{ board: 'v3', name: '', ...BODY }],
    [{ board: 'v3', name: 'x'.repeat(13), ...BODY }],
    [{ board: 'v3', name: '<script>', ...BODY }],
    [{ board: 'v3', name: '-dash', ...BODY }],
    [{ board: 'v3', name: 'Sam', replay: REPLAY }],
    [{ board: 'v3', name: 'Sam', score: 0, replay: REPLAY }],
    [{ board: 'v3', name: 'Sam', score: 1.5, replay: REPLAY }],
    [{ board: 'v3', name: 'Sam', score: '100', replay: REPLAY }],
    [{ board: 'v3', name: 'Sam', score: 1e10, replay: REPLAY }],
    [{ board: 'v3', name: 'Sam', score: 5, seconds: -1, replay: REPLAY }],
    [{ board: 'v3', name: 'Sam', look: '999', ...BODY }],
    [{ board: 'v3', name: 'Sam', look: '20', ...BODY }],
    [{ board: 'v3', name: 'Sam', look: 203, ...BODY }],
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

const ORIGIN = 'https://thesecretstage.vip';
type Env = { DB: ReturnType<typeof fakeD1>; VERIFY_REPLAYS?: string };
const call = (env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = { Origin: ORIGIN }) =>
  worker.fetch(new Request(`https://api.example${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(method === 'POST' && body && typeof body === 'object' && 'replay' in body ? { score: 1, ...body } : body) }), env);

describe('the Worker, replaying every post (VERIFY_REPLAYS=1)', () => {
  let env: Env;
  beforeEach(() => {
    env = { DB: fakeD1(), VERIFY_REPLAYS: '1' }; // the score claimed in a body is ignored, so posts here claim 1
  });

  it('starts empty, works the score out itself, ranks it, and keeps each player’s best', async () => {
    const empty = await call(env, 'GET', '/scores?board=v3');
    expect(await empty.json()).toEqual({ board: 'v3', scores: [] });
    expect(empty.headers.get('Access-Control-Allow-Origin')).toBe('*'); // reading is open to every site

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
    expect(await post('Cat', low, { score: 99999 })).toMatchObject({ score: low.score, best: low.score, rank: 3 });

    const top = (await (await call(env, 'GET', '/scores?board=v3')).json()) as { scores: { name: string; score: number }[] };
    expect(top.scores.map((s) => [s.name, s.score])).toEqual([['Bob', high.score], ['Ann', high.score], ['Cat', low.score]]);
  });

  it('keeps boards apart, stores the survival time, and returns only the top 10', async () => {
    const level = survivalLevel(4242);
    const played = playBot(level, 4242, 0.7, 4);
    expect(played.ended).toBe(true);
    await call(env, 'POST', '/scores', { board: 'survival', name: 'Sam', replay: played.replay });
    const s = (await (await call(env, 'GET', '/scores?board=survival')).json()) as { scores: unknown[] };
    expect(s.scores).toEqual([{ name: 'Sam', score: played.score, seconds: Math.round(played.seconds), look: '', verified: false }]);
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

describe('the Worker, checking scores are believable (the default)', () => {
  let env: Env;
  beforeEach(() => {
    env = { DB: fakeD1() };
  });
  const post = async (body: object, headers?: Record<string, string>) => call(env, 'POST', '/scores', { name: 'Sam', ...body }, headers);

  it('takes a score that matches a real round, and stores what the game claimed', async () => {
    const r = round(3, 1);
    const res = await post({ board: 'v3', score: r.score, replay: r.replay });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rank: 1, best: r.score, score: r.score });
    const top = (await (await call(env, 'GET', '/scores?board=v3')).json()) as { scores: unknown[] };
    expect(top.scores).toEqual([{ name: 'Sam', score: r.score, seconds: 0, look: '', verified: false }]);
  });

  it('refuses absurd scores, however they are packaged', async () => {
    const r = round(3, 1);
    const shots = r.replay.shots.length;
    expect((await post({ board: 'v3', score: SCORE_BASE + SCORE_PER_SHOT * shots + 1, replay: r.replay })).status).toBe(400);
    expect((await post({ board: 'v3', score: 999_999, replay: r.replay })).status).toBe(400);
    expect((await post({ board: 'v3', score: 999_999, replay: { shots: [[1, 0, 5]], tail: 0 } })).status).toBe(400); // one shot can't be worth that
    expect((await post({ board: 'v3', score: 100 })).status).toBe(400); // no replay at all
  });

  it('checks the survival time against the moves, and needs the run’s seed', async () => {
    const level = survivalLevel(4242);
    const played = playBot(level, 4242, 0.7, 4);
    const seconds = Math.round(played.seconds);
    expect((await post({ board: 'survival', score: played.score, seconds, replay: played.replay })).status).toBe(200);
    expect((await post({ board: 'survival', name: 'Fast', score: played.score, seconds: Math.round(seconds / 4), replay: played.replay })).status).toBe(400);
    expect((await post({ board: 'survival', name: 'Slow', score: played.score, seconds: seconds * 4, replay: played.replay })).status).toBe(400);
    expect((await post({ board: 'survival', name: 'Zero', score: played.score, seconds: 0, replay: played.replay })).status).toBe(400);
    expect((await post({ board: 'survival', name: 'NoSeed', score: played.score, seconds, replay: { ...played.replay, seed: undefined } })).status).toBe(400);
    expect((await post({ board: 'v3', name: 'Timed', score: 100, seconds: 30, replay: played.replay })).status).toBe(400); // only survival has a time
  });

  it('stores each player\'s look, shows it on every board, and keeps the latest', async () => {
    const r = round(3, 1);
    const r2 = round(2, 1);
    await post({ board: 'v3', name: 'Ann', score: r.score, look: '203', replay: r.replay });
    await post({ board: 'v3', name: 'Bob', score: r.score, replay: r.replay }, { Origin: ORIGIN, 'CF-Connecting-IP': '9.9.9.9' }); // no look sent
    await post({ board: 'v2', name: 'ann', score: r2.score, look: '715', replay: r2.replay }); // same player, new outfit, different case
    const looks = async (board: string) => ((await (await call(env, 'GET', `/scores?board=${board}`)).json()) as { scores: { name: string; look: string }[] }).scores.map((e) => [e.name, e.look]);
    expect(await looks('v2')).toEqual([['ann', '715']]);
    expect(await looks('v3')).toEqual([['Ann', '715'], ['Bob', '']]); // the newest look follows the player everywhere
    expect((await post({ board: 'v3', name: 'Cat', score: r.score, look: '999', replay: r.replay })).status).toBe(400);
  });

  it('closes old Daily boards', async () => {
    const r = round(3, 1);
    expect((await post({ board: 'daily-2001-01-01', score: r.score, replay: r.replay })).status).toBe(400);
  });

  it('tells an out-of-date copy of the game to reload', async () => {
    const res = await post({ board: 'v3', score: 100 });
    expect(((await res.json()) as { error: string }).error).toMatch(/out of date/);
  });

  it('accepts what the honest bots reach, across grades and survival (no false alarms)', () => {
    for (const grade of [0, 5, 14, 20])
      for (let seed = 1; seed <= 4; seed++) {
        const p = playBot(gradeLevel(grade), seed * 13 + grade, 1, 1);
        if (p.ended && p.score > 0) expect(plausible(`v${grade}`, p.replay, p.score, 0)).toBeNull();
      }
    for (let seed = 1; seed <= 4; seed++) {
      const p = playBot(survivalLevel(seed), seed, 1, seed % 2 ? 1 : 4, 600);
      if (p.ended) expect(plausible('survival', p.replay, p.score, Math.round(p.seconds))).toBeNull();
    }
  }, 60_000);
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
    expect(await postScore('v3', 'Ann', 900, 0, '203', REPLAY)).toEqual({ ok: true, message: 'Leaderboard rank #3' });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ board: 'v3', name: 'Ann', score: 900, seconds: 0, look: '203', replay: REPLAY });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ rank: 2, best: 1500, score: 900 })));
    expect((await postScore('v3', 'Ann', 900, 0, '203', REPLAY)).message).toBe('Your best here is 1500 (rank #2)');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Replay rejected: The run did not finish' }, { status: 400 })));
    expect(await postScore('v3', 'x', 5, 0, '000', REPLAY)).toEqual({ ok: false, message: 'Replay rejected: The run did not finish' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await postScore('v3', 'Ann', 900, 0, '203', REPLAY)).toEqual({ ok: false, message: "Couldn't reach the leaderboard" });
  });
});
