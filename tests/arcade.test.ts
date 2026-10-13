import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../worker/src/index';
import { addArcadeRun, arcadeTop, parseArcadeRun } from '../worker/src/arcade';
import { boardView, listBoards } from '../worker/src/v1';
import { ARCADE_SIZE, arcadeBoard, arcadeLevel, arcadeWeek, cleanInitials, isArcadeBoard, makesTable, nextReset, resetsIn, stepChar } from '../src/game/arcade';
import { boardFor } from '../src/game/leaderboard';
import { survivalLevel } from '../src/game/levels';
import { playBot } from './bot';
import { fakeD1 } from './fakeD1';

const MONDAY = Date.UTC(2026, 9, 12, 0, 0, 0); // 12 Oct 2026 is a Monday

describe('the week', () => {
  it('starts on Monday (UTC) and is the same all week', () => {
    expect(arcadeWeek(MONDAY)).toBe('2026-10-12');
    expect(arcadeWeek(MONDAY + 3 * 86_400_000 + 5_000)).toBe('2026-10-12'); // Thursday
    expect(arcadeWeek(MONDAY + 7 * 86_400_000 - 1)).toBe('2026-10-12'); // Sunday 23:59:59
    expect(arcadeWeek(MONDAY + 7 * 86_400_000)).toBe('2026-10-19'); // the table has cleared
    expect(arcadeWeek(MONDAY - 1)).toBe('2026-10-05');
    expect(arcadeBoard(MONDAY)).toBe('arcade-2026-10-12');
  });
  it('knows when it clears', () => {
    expect(nextReset(MONDAY + 86_400_000)).toBe(MONDAY + 7 * 86_400_000);
    expect(resetsIn(MONDAY + 86_400_000)).toBe('6 days');
    expect(resetsIn(MONDAY + 7 * 86_400_000 - 5 * 3_600_000)).toBe('5 hours');
    expect(resetsIn(MONDAY + 7 * 86_400_000 - 10 * 60_000)).toBe('10 minutes');
  });
  it('recognises Arcade board ids', () => {
    expect(isArcadeBoard('arcade-2026-10-12')).toBe(true);
    expect(isArcadeBoard('arcade')).toBe(false);
    expect(isArcadeBoard('arcade-2026-13-45')).toBe(false);
    expect(isArcadeBoard('v3')).toBe(false);
  });
});

describe('initials', () => {
  it('are three letters or numbers, upper-cased', () => {
    expect(cleanInitials('ace')).toBe('ACE');
    expect(cleanInitials('A1b')).toBe('A1B');
    for (const bad of ['', 'AB', 'ABCD', 'A B', 'A-B', '<s>', 'é12', 5, null, undefined]) expect(cleanInitials(bad)).toBeNull();
  });
  it('refuse the rude ones', () => {
    for (const bad of ['ass', 'FUK', 'kkk', 'Sex']) expect(cleanInitials(bad)).toBeNull();
  });
  it('scroll through A-Z then 0-9 and wrap round', () => {
    expect(stepChar('A', 1)).toBe('B');
    expect(stepChar('Z', 1)).toBe('0');
    expect(stepChar('9', 1)).toBe('A');
    expect(stepChar('A', -1)).toBe('9');
    expect(stepChar('0', -1)).toBe('Z');
    expect(stepChar('?', 1)).toBe('B'); // anything unknown starts from A
  });
});

describe('what makes the table', () => {
  const full = Array.from({ length: ARCADE_SIZE }, (_, i) => ({ score: 1000 - i * 100 })); // 1000 down to 100
  it('is anything while there is room, but never nothing', () => {
    expect(makesTable([], 5)).toBe(true);
    expect(makesTable([], 0)).toBe(false);
    expect(makesTable(full.slice(0, 9), 1)).toBe(true);
  });
  it('is beating 10th place once the table is full', () => {
    expect(makesTable(full, 101)).toBe(true);
    expect(makesTable(full, 100)).toBe(false); // a tie goes to the run that got there first
    expect(makesTable(full, 50)).toBe(false);
  });
});

describe('the Arcade level', () => {
  it('plays exactly like Survival, but has its own table', () => {
    const a = arcadeLevel(7);
    expect({ ...a, id: 'survival', label: 'Survival', arcade: undefined }).toEqual({ ...survivalLevel(7), arcade: undefined });
    expect(a.survival).toBe(true);
    expect(boardFor(a)).toBeNull(); // no normal leaderboard post
    expect(boardFor(survivalLevel(7))).toBe('survival');
  });
});

const ORIGIN = 'https://thesecretstage.vip';
type Env = { DB: ReturnType<typeof fakeD1>; VERIFY_REPLAYS?: string };
const call = (env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = { Origin: ORIGIN }) =>
  worker.fetch(new Request(`https://api.example${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe('the Arcade routes', () => {
  let env: Env;
  const SEED = 4242;
  const played = playBot(survivalLevel(SEED), SEED, 0.7, 4);
  const replay = { ...played.replay, seed: SEED };
  const run = (initials: string, extra: Record<string, unknown> = {}) => ({ initials, score: 1, seconds: Math.max(1, Math.round(played.seconds)), replay, ...extra });

  beforeEach(() => {
    env = { DB: fakeD1(), VERIFY_REPLAYS: '1' }; // the score the game claims is ignored: the Worker replays the run
  });

  it('starts empty, then lists a run under its initials with the score the replay gives', async () => {
    expect(await json(await call(env, 'GET', '/arcade'))).toMatchObject({ week: arcadeWeek(), scores: [] });
    const res = await call(env, 'POST', '/arcade', run('ace'));
    expect(await json(res)).toEqual({ qualified: true, rank: 1 });
    const table = await json(await call(env, 'GET', '/arcade'));
    expect(table.scores).toEqual([{ name: 'ACE', score: played.score, seconds: Math.round(played.seconds), look: '', verified: false }]);
    expect(table.resetsAt).toBe(new Date(nextReset()).toISOString());
  });

  it('lets the same initials appear again and again', async () => {
    for (let i = 0; i < 3; i++) await call(env, 'POST', '/arcade', run('ACE'), { Origin: ORIGIN, 'CF-Connecting-IP': `10.0.0.${i}` });
    const table = await json(await call(env, 'GET', '/arcade'));
    expect(table.scores.map((s: { name: string }) => s.name)).toEqual(['ACE', 'ACE', 'ACE']);
  });

  it('refuses bad or rude initials, other websites, a made-up score and a run that was not played', async () => {
    expect((await call(env, 'POST', '/arcade', run('AB'))).status).toBe(400);
    expect((await call(env, 'POST', '/arcade', run('FUK'))).status).toBe(400);
    expect((await call(env, 'POST', '/arcade', run('ACE'), { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, 'POST', '/arcade', run('ACE'), {})).status).toBe(403);
    expect((await call(env, 'POST', '/arcade', run('ACE', { replay: { ...replay, shots: replay.shots.slice(0, -1) } }))).status).toBe(400);
    expect((await call(env, 'POST', '/arcade', run('ACE', { replay: { ...replay, seed: undefined } }))).status).toBe(400);
    expect((await call(env, 'POST', '/arcade', { initials: 'ACE', score: 5, seconds: 5 })).status).toBe(400);
    expect((await json(await call(env, 'GET', '/arcade'))).scores).toEqual([]);
  });

  it('without replaying, still refuses a score too high for the moves', async () => {
    env = { DB: fakeD1() };
    expect((await call(env, 'POST', '/arcade', run('ACE', { score: 5_000_000 }))).status).toBe(400);
    expect((await call(env, 'POST', '/arcade', run('ACE', { score: 10 }))).status).toBe(200);
  });

  it('keeps Arcade out of the normal boards', async () => {
    await call(env, 'POST', '/arcade', run('ACE'));
    expect((await call(env, 'GET', '/scores?board=arcade')).status).toBe(400);
    expect((await call(env, 'POST', '/scores', { board: 'arcade', name: 'Sam', replay })).status).toBe(400);
    expect((await json(await call(env, 'GET', '/scores?board=survival'))).scores).toEqual([]);
    expect((await json(await call(env, 'GET', '/scores?board=overall'))).scores).toEqual([]); // Arcade scores are nobody's, so they are not in anyone's total
  });

  it('answers a browser asking whether it may read the table', async () => {
    const res = await call(env, 'GET', '/arcade', undefined, {});
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await call(env, 'GET', '/arcade?week=nonsense')).status).toBe(400);
  });
});

describe('the table itself', () => {
  it('keeps the top ten of a week, pushes the tenth off, and turns away a run that is too low', async () => {
    const db = fakeD1();
    for (let i = 1; i <= 10; i++) expect(await addArcadeRun(db, { initials: `P${i}`.padEnd(3, 'X'), score: i * 100, seconds: 60 }, MONDAY)).toMatchObject({ qualified: true });
    expect((await arcadeTop(db, '2026-10-12')).map((r) => r.score)).toEqual([1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]);
    expect(await addArcadeRun(db, { initials: 'LOW', score: 50, seconds: 5 }, MONDAY)).toEqual({ qualified: false, rank: null });
    expect(await addArcadeRun(db, { initials: 'TIE', score: 100, seconds: 5 }, MONDAY)).toEqual({ qualified: false, rank: null }); // the earlier 100 keeps its place
    expect(await addArcadeRun(db, { initials: 'TOP', score: 5000, seconds: 5 }, MONDAY)).toEqual({ qualified: true, rank: 1 });
    const top = await arcadeTop(db, '2026-10-12');
    expect(top).toHaveLength(10);
    expect(top[0].name).toBe('TOP');
    expect(top.at(-1)?.score).toBe(200); // the old tenth (100) was pushed off
    const count = await db.prepare('SELECT COUNT(*) AS n FROM arcade_scores').first<{ n: number }>();
    expect(count?.n).toBe(10); // nothing extra is kept
  });

  it('starts a fresh table each Monday and keeps the old one readable', async () => {
    const db = fakeD1();
    await addArcadeRun(db, { initials: 'OLD', score: 900, seconds: 60 }, MONDAY + 2 * 86_400_000);
    expect(await addArcadeRun(db, { initials: 'NEW', score: 10, seconds: 5 }, MONDAY + 7 * 86_400_000)).toEqual({ qualified: true, rank: 1 });
    expect((await arcadeTop(db, '2026-10-12')).map((r) => r.name)).toEqual(['OLD']);
    expect((await arcadeTop(db, '2026-10-19')).map((r) => r.name)).toEqual(['NEW']);
  });

  it('rejects a malformed body', () => {
    expect(parseArcadeRun(null)).toBe('Bad request');
    expect(parseArcadeRun({ initials: 'ACE', replay: { shots: [], tail: 0 }, score: 0, seconds: 5 })).toBe('Score out of range');
    expect(parseArcadeRun({ initials: 'ACE', replay: { shots: [], tail: 0 }, score: 5, seconds: 0 })).toBe('Time out of range');
  });
});

describe('the public API', () => {
  it('shows the Arcade table as /v1/boards/arcade, and lists it as an alias', async () => {
    const db = fakeD1();
    await addArcadeRun(db, { initials: 'ACE', score: 700, seconds: 80 });
    const view = await boardView(db, 'arcade', 10);
    expect(view).toMatchObject({ board: arcadeBoard(), title: 'Arcade', kind: 'arcade', scores: [{ rank: 1, name: 'ACE', score: 700, seconds: 80, verified: false }] });
    expect(await boardView(db, arcadeBoard(), 10)).toMatchObject({ scores: [{ name: 'ACE' }] });
    expect((await listBoards(db)).aliases.arcade).toBe(arcadeBoard());
  });
});
