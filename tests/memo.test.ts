import { describe, expect, it } from 'vitest';
import { forget, memo } from '../worker/src/memo';
import { OVERALL_TTL_MS, overallSummary, topScores } from '../worker/src/leaders';
import { fakeD1 } from './fakeD1';

/** A database that counts the queries it is asked. */
function counting() {
  const db = fakeD1();
  const calls = { n: 0 };
  return {
    calls,
    db: {
      prepare(sql: string) {
        calls.n++;
        return db.prepare(sql);
      },
    },
  };
}
const add = (db: ReturnType<typeof fakeD1>, board: string, name: string, score: number) =>
  db.prepare('INSERT INTO scores (board, name, score, seconds, created_at) VALUES (?1, ?2, ?3, 0, 1)').bind(board, name, score).run();

describe('memo', () => {
  const db = fakeD1();
  it('reuses an answer until it is too old, then works it out again', async () => {
    let made = 0;
    const make = async () => ++made;
    expect(await memo(db, 'k', 1000, make, 0)).toBe(1);
    expect(await memo(db, 'k', 1000, make, 999)).toBe(1);
    expect(await memo(db, 'k', 1000, make, 1000)).toBe(2);
    expect(await memo(db, 'other', 1000, make, 1000)).toBe(3); // a different key is its own answer
  });
  it('lets requests that arrive together share one piece of work', async () => {
    let made = 0;
    const make = async () => (++made, 'x');
    const all = await Promise.all([memo(db, 'busy', 1000, make, 5), memo(db, 'busy', 1000, make, 5), memo(db, 'busy', 1000, make, 5)]);
    expect(all).toEqual(['x', 'x', 'x']);
    expect(made).toBe(1);
  });
  it('does not remember a failure', async () => {
    await expect(memo(db, 'bad', 1000, () => Promise.reject(new Error('down')), 0)).rejects.toThrow('down');
    await Promise.resolve();
    expect(await memo(db, 'bad', 1000, async () => 'fine', 1)).toBe('fine');
  });
  it('keeps each database separate, and can be told to forget', async () => {
    const a = fakeD1();
    const b = fakeD1();
    expect(await memo(a, 'k', 1000, async () => 'a', 0)).toBe('a');
    expect(await memo(b, 'k', 1000, async () => 'b', 0)).toBe('b');
    expect(await memo(a, 'k', 1000, async () => 'new', 1)).toBe('a');
    forget(a);
    expect(await memo(a, 'k', 1000, async () => 'new', 1)).toBe('new');
    expect(await memo(b, 'k', 1000, async () => 'new', 1)).toBe('b'); // the other database is untouched
  });
  it('does not trust a clock that went backwards', async () => {
    expect(await memo(db, 'clock', 1000, async () => 1, 5000)).toBe(1);
    expect(await memo(db, 'clock', 1000, async () => 2, 100)).toBe(2);
  });
});

describe('the Overall ranking', () => {
  it('is worked out once a minute, however many people look, and the other boards are not remembered', async () => {
    const { db, calls } = counting();
    await add(db as never, 'v0', 'Ann', 100);
    // `counting` wraps the same database, so its writes above went through prepare too
    calls.n = 0;
    for (let i = 0; i < 20; i++) await topScores(db as never, 'overall', 10, 1000);
    expect(calls.n).toBe(1);
    for (let i = 0; i < 3; i++) await topScores(db as never, 'v0', 10, 1000);
    expect(calls.n).toBe(4); // a grade board is a cheap, indexed read, so it is always fresh
    await topScores(db as never, 'overall', 10, 1000 + OVERALL_TTL_MS - 1);
    expect(calls.n).toBe(4);
    await topScores(db as never, 'overall', 10, 1000 + OVERALL_TTL_MS);
    expect(calls.n).toBe(5);
  });
  it('is up to a minute behind, then catches up', async () => {
    const db = fakeD1();
    await add(db, 'v0', 'Ann', 100);
    expect((await topScores(db, 'overall', 10, 0)).map((r) => r.name)).toEqual(['Ann']);
    await add(db, 'v0', 'Bob', 500);
    expect((await topScores(db, 'overall', 10, 1000)).map((r) => r.name)).toEqual(['Ann']);
    expect((await topScores(db, 'overall', 10, OVERALL_TTL_MS)).map((r) => r.name)).toEqual(['Bob', 'Ann']);
    expect(await overallSummary(db, OVERALL_TTL_MS)).toEqual({ entries: 2, top: 500 });
  });
  it('remembers different limits separately', async () => {
    const db = fakeD1();
    for (let i = 0; i < 5; i++) await add(db, 'v0', `P${i}`, 100 + i);
    expect(await topScores(db, 'overall', 2, 0)).toHaveLength(2);
    expect(await topScores(db, 'overall', 5, 0)).toHaveLength(5);
  });
});

describe('the Worker', () => {
  it('shows a new score in the Overall ranking straight away on the instance that took it', async () => {
    const { default: worker } = await import('../worker/src/index');
    const { gradeLevel } = await import('../src/game/levels');
    const { playBot } = await import('./bot');
    const env = { DB: fakeD1(), VERIFY_REPLAYS: '1' };
    const read = async () => ((await (await worker.fetch(new Request('https://api.example/scores?board=overall'), env)).json()) as { scores: { name: string }[] }).scores.map((s) => s.name);
    expect(await read()).toEqual([]); // now remembered as empty
    const level = gradeLevel(2);
    let played = playBot(level, 1);
    for (let s = 2; !(played.ended && played.score > 0); s++) played = playBot(level, s);
    const res = await worker.fetch(new Request('https://api.example/scores', { method: 'POST', headers: { Origin: 'https://thesecretstage.vip', 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'v2', name: 'Ann', score: 1, replay: played.replay }) }), env);
    expect(res.status).toBe(200);
    expect(await read()).toEqual(['Ann']);
  });
});
