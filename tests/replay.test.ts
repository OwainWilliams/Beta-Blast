import { describe, expect, it } from 'vitest';
import { Engine } from '../src/game/engine';
import { dailyLevel, dateKey, gradeLevel, survivalLevel } from '../src/game/levels';
import { levelForBoard, MAX_AIM_MILLI, MAX_SHOTS, parseReplay, playReplay, Recorder, Replay, STEP, toMilli } from '../src/game/replay';
import { playBot } from './bot';

describe('replays play back exactly', () => {
  it.each([0, 1, 2, 4, 7, 10, 15])('V%i: the score, result and time match what the bot reached', (grade) => {
    for (const seed of [1, 2, 3]) {
      const level = gradeLevel(grade);
      const played = playBot(level, seed * 977 + grade);
      const out = playReplay(level, played.replay);
      if (!played.ended) {
        expect(out.ok).toBe(false); // an unfinished round is not accepted
        continue;
      }
      expect(out).toMatchObject({ ok: true, won: played.won, score: played.score });
      expect(out.seconds).toBeCloseTo(played.seconds, 9);
    }
  });

  it('survival replays carry their seed and play back to the same time and score', () => {
    for (const seed of [11, 4242, 987654]) {
      const level = survivalLevel(seed);
      const played = playBot(level, seed, 0.7, 4);
      expect(played.ended).toBe(true);
      expect(played.replay.seed).toBe(seed);
      expect(playReplay(level, played.replay)).toMatchObject({ ok: true, won: false, score: played.score, seconds: played.seconds });
    }
  });

  it('a round the row timer ended while aiming still plays back (the tail)', () => {
    // a player who never shoots: the wall just drops until they fall
    const level = gradeLevel(3);
    const e = new Engine(level);
    let quiet = 0;
    while (!e.tick(STEP)?.lost) quiet++; // steps before the one that drops the wall to the bottom
    expect(playReplay(level, { shots: [], tail: quiet })).toMatchObject({ ok: true, won: false, score: 0 });
    expect(playReplay(level, { shots: [], tail: quiet - 1 })).toMatchObject({ ok: false }); // not there yet
    expect(playReplay(level, { shots: [], tail: quiet + 1 })).toMatchObject({ ok: false }); // already over
  });
});

describe('replays that were tampered with are refused or change the score', () => {
  const level = gradeLevel(3);
  const played = playBot(level, 5);
  const honest = playReplay(level, played.replay);

  it('starts from a real finished round', () => {
    expect(played.ended).toBe(true);
    expect(honest.ok).toBe(true);
  });

  it('refuses a replay cut short, or with shots after the end', () => {
    expect(playReplay(level, { ...played.replay, shots: played.replay.shots.slice(0, -1) })).toMatchObject({ ok: false });
    expect(playReplay(level, { ...played.replay, shots: [...played.replay.shots, [0, 0, 0]] })).toMatchObject({ ok: false });
    expect(playReplay(level, { ...played.replay, tail: played.replay.tail + 5 })).toMatchObject({ ok: false });
  });

  it('cannot give a better score by editing a move: the score is whatever the edited game scores', () => {
    const shots = played.replay.shots.map((s) => [...s] as Replay['shots'][number]);
    shots[0][2] = shots[0][2] === 0 ? 100 : 0;
    const out = playReplay(level, { ...played.replay, shots });
    if (out.ok) expect(out.score).not.toBe(honest.score + 1_000_000); // it is a different, real game
    else expect(out.reason).toBeTruthy();
  });

  it('refuses a replay played on a different wall', () => {
    const other = playReplay(gradeLevel(4), played.replay);
    expect(other.ok && other.score === honest.score && other.won === honest.won).toBe(false);
  });

  it('refuses runs that are too long', () => {
    expect(playReplay(level, { shots: [[600_001, 0, 0]], tail: 0 })).toMatchObject({ ok: false, reason: 'Run too long' });
    expect(playReplay(level, { shots: [], tail: 600_001 })).toMatchObject({ ok: false, reason: 'Run too long' });
  });
});

describe('boards and shapes', () => {
  const noSeed: Replay = { shots: [], tail: 0 };
  const now = Date.UTC(2026, 9, 12, 12);

  it('maps boards to levels', () => {
    expect(levelForBoard('v3', noSeed)?.id).toBe('v3');
    expect(levelForBoard('v999', noSeed)?.id).toBe('v999');
    expect(levelForBoard('survival', noSeed)).toBeNull();
    expect(levelForBoard('survival', { ...noSeed, seed: 77 })?.seed).toBe(77);
    expect(levelForBoard('survival', { ...noSeed, seed: -1 })).toBeNull();
    expect(levelForBoard('survival', { ...noSeed, seed: 2 ** 31 })).toBeNull();
    expect(levelForBoard('nope', noSeed)).toBeNull();
  });

  it('only opens Daily boards for about today', () => {
    expect(levelForBoard('daily-2026-10-12', noSeed, now)?.id).toBe('daily-2026-10-12');
    expect(levelForBoard('daily-2026-10-13', noSeed, now)).not.toBeNull();
    expect(levelForBoard('daily-2026-10-10', noSeed, now)).not.toBeNull();
    expect(levelForBoard('daily-2026-10-09', noSeed, now)).toBeNull();
    expect(levelForBoard('daily-2026-10-20', noSeed, now)).toBeNull();
    expect(levelForBoard('daily-2026-13-45', noSeed, now)).toBeNull();
    // the level matches the one the game builds for that day
    const key = dateKey();
    expect(levelForBoard(`daily-${key}`, noSeed)).toEqual(dailyLevel());
  });

  it('records and rounds aims the way a replay reads them', () => {
    const r = new Recorder();
    r.aimed();
    r.aimed();
    r.swap();
    expect(r.fire(0.12345)).toBe(0.123);
    r.swap();
    r.swap();
    r.aimed();
    expect(r.fire(-9)).toBe(-MAX_AIM_MILLI / 1000);
    expect(r.shots).toEqual([[2, 1, 123], [1, 0, -MAX_AIM_MILLI]]);
    expect(r.tail).toBe(0);
    r.aimed();
    expect(r.tail).toBe(1);
    expect(toMilli(0.0004)).toBe(0);
  });

  it('rejects malformed replays', () => {
    expect(parseReplay({ shots: [[1, 0, 5]], tail: 0 })).toEqual({ seed: undefined, shots: [[1, 0, 5]], tail: 0 });
    for (const bad of [
      null,
      'x',
      {},
      { shots: [], tail: -1 },
      { shots: [], tail: 1.5 },
      { shots: 'x', tail: 0 },
      { shots: [[1, 0]], tail: 0 },
      { shots: [[-1, 0, 0]], tail: 0 },
      { shots: [[1.5, 0, 0]], tail: 0 },
      { shots: [[1, 2, 0]], tail: 0 },
      { shots: [[1, 0, MAX_AIM_MILLI + 1]], tail: 0 },
      { shots: [[1, 0, 0.5]], tail: 0 },
      { shots: [['1', 0, 0]], tail: 0 },
      { shots: [], tail: 0, seed: 1.5 },
      { shots: Array.from({ length: MAX_SHOTS + 1 }, () => [0, 0, 0]), tail: 0 },
    ])
      expect(typeof parseReplay(bad)).toBe('string');
  });
});
