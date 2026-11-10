import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../worker/src/index';
import { formatCountdown, msUntilNextDay } from '../src/game/daily';
import { dailyLevel, gradeLevel } from '../src/game/levels';
import { dailyUsed, markDailyStarted, recordResult } from '../src/game/storage';
import { playBot } from './bot';
import { fakeD1 } from './fakeD1';

describe('the clock to the next Daily Boulder', () => {
  it('counts down to the next local midnight', () => {
    expect(msUntilNextDay(new Date(2026, 0, 15, 23, 59, 0))).toBe(60_000);
    expect(msUntilNextDay(new Date(2026, 0, 15, 12, 0, 0))).toBe(12 * 3_600_000);
    expect(msUntilNextDay(new Date(2026, 0, 15, 0, 0, 0))).toBe(24 * 3_600_000); // a new day has just begun
    expect(msUntilNextDay(new Date(2026, 0, 15, 0, 0, 1))).toBe(24 * 3_600_000 - 1000);
    expect(msUntilNextDay(new Date(2026, 0, 31, 23, 0, 0))).toBe(3_600_000); // over a month end
    expect(msUntilNextDay(new Date(2026, 11, 31, 23, 0, 0))).toBe(3_600_000); // and a year end
  });
  it('lands on the moment dailyLevel() changes', () => {
    const now = new Date(2026, 5, 10, 18, 30, 0);
    const next = new Date(now.getTime() + msUntilNextDay(now));
    expect(dailyLevel(next).id).not.toBe(dailyLevel(now).id);
    expect(dailyLevel(new Date(next.getTime() - 1)).id).toBe(dailyLevel(now).id);
  });
  it('is never more than a day and a bit, even on a day the clocks change', () => {
    for (const day of [[2026, 2, 29], [2026, 9, 25], [2026, 2, 8], [2026, 10, 1]]) {
      const ms = msUntilNextDay(new Date(day[0], day[1], day[2], 0, 30, 0));
      expect(ms).toBeGreaterThan(22 * 3_600_000);
      expect(ms).toBeLessThanOrEqual(25 * 3_600_000);
    }
  });
  it('is shown as hours, minutes and seconds, rounding up', () => {
    expect(formatCountdown(0)).toBe('0:00:00');
    expect(formatCountdown(-5)).toBe('0:00:00');
    expect(formatCountdown(1)).toBe('0:00:01'); // never 0:00:00 while there is still time
    expect(formatCountdown(59_001)).toBe('0:01:00');
    expect(formatCountdown(3_661_000)).toBe('1:01:01');
    expect(formatCountdown(86_400_000)).toBe('24:00:00');
  });
});

// ---------- one attempt a day, on this device ----------

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe('one attempt a day', () => {
  const today = 'daily-2026-11-10';
  it('is free until the first shot, then used', () => {
    expect(dailyUsed(today)).toBe(false);
    markDailyStarted(today);
    expect(dailyUsed(today)).toBe(true);
  });
  it('is per day: yesterday being used does not use today', () => {
    markDailyStarted('daily-2026-11-09');
    expect(dailyUsed('daily-2026-11-09')).toBe(true);
    expect(dailyUsed(today)).toBe(false);
    markDailyStarted(today);
    expect(dailyUsed(today)).toBe(true);
  });
  it('is also used when there is a score for it, which an account\'s other devices get through the cloud save', () => {
    recordResult(today, 1200, false);
    expect(dailyUsed(today)).toBe(true);
    expect(dailyUsed('daily-2026-11-11')).toBe(false);
    recordResult('daily-2026-11-11', 0, true); // sent, whatever the score
    expect(dailyUsed('daily-2026-11-11')).toBe(true);
  });
  it('treats a save from before the rule as unused', () => {
    store.set('beta-blast.v1', JSON.stringify({ best: { v1: 5 }, sent: { v1: true } }));
    expect(dailyUsed(today)).toBe(false);
  });
});

// ---------- and on the server ----------

describe('the Daily Boulder on the leaderboard', () => {
  const ORIGIN = 'https://thesecretstage.vip';
  it('keeps the first score posted under a name, and refuses a second', async () => {
    const env = { DB: fakeD1(), VERIFY_REPLAYS: '1' };
    const level = dailyLevel();
    const post = (name: string, replay: unknown, board = level.id) =>
      worker.fetch(new Request('https://api.example/scores', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ board, name, score: 1, replay }) }), env);
    const play = (lvl: ReturnType<typeof dailyLevel>, from: number) => {
      for (let s = from; ; s++) {
        const p = playBot(lvl, s, 0.9 - (s % 3) * 0.3, 3);
        if (p.ended && p.score > 0) return p;
      }
    };
    const first = play(level, 1);
    const second = play(level, 50);
    expect(second.score).not.toBe(first.score);
    const better = first.score > second.score ? first : second;
    const worse = better === first ? second : first;

    expect((await post('Ann', worse.replay)).status).toBe(200);
    const again = await post('Ann', better.replay); // a better second try is still refused
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/already posted/);
    expect((await post('ann', better.replay)).status).toBe(409); // whatever the capitals
    const board = (await (await worker.fetch(new Request(`https://api.example/scores?board=${level.id}`), env)).json()) as { scores: { name: string; score: number }[] };
    expect(board.scores).toEqual([expect.objectContaining({ name: 'Ann', score: worse.score })]); // the first score stands
    expect((await post('Bob', better.replay)).status).toBe(200); // somebody else is unaffected

    // grades still keep your best, and can be posted again
    const grade = gradeLevel(2);
    const g1 = play(grade, 1);
    expect((await post('Ann', g1.replay, 'v2')).status).toBe(200);
    expect((await post('Ann', g1.replay, 'v2')).status).toBe(200);
  });
});
