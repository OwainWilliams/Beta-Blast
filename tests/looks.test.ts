import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colourOf, decodeLook, DEFAULT_LOOK, encodeLook, isUnlocked, lighten, lookOrDefault, NO_PROGRESS, Progress, SLOTS, SWATCHES, unlockedCount, unlockHint } from '../src/game/looks';
import { getLookCode, getProgress, recordResult, recordTime, setLookCode } from '../src/game/storage';

function fakeStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe('look codes', () => {
  it('round trips every combination of swatches', () => {
    for (let a = 0; a < SWATCHES.beanie.length; a++)
      for (let b = 0; b < SWATCHES.shirt.length; b++)
        for (let c = 0; c < SWATCHES.bag.length; c++) {
          const look = { beanie: a, shirt: b, bag: c };
          expect(decodeLook(encodeLook(look))).toEqual(look);
        }
  });

  it('refuses anything that is not a look', () => {
    for (const bad of ['', '12', '1234', 'abc', '-12', '8 0', '900', '099', 5, null, undefined, {}]) expect(decodeLook(bad)).toBeNull();
    expect(lookOrDefault('nope')).toEqual(DEFAULT_LOOK);
    expect(lookOrDefault('123')).toEqual({ beanie: 1, shirt: 2, bag: 3 });
  });

  it('has the same number of swatches in every slot, so a look code is three digits', () => {
    for (const slot of SLOTS) expect(SWATCHES[slot].length).toBeLessThanOrEqual(10);
    expect(encodeLook(DEFAULT_LOOK)).toBe('000');
  });

  it('gives each swatch in a slot its own colour, and starts every slot with a free one', () => {
    for (const slot of SLOTS) {
      expect(new Set(SWATCHES[slot].map((s) => s.colour)).size).toBe(SWATCHES[slot].length);
      expect(SWATCHES[slot][0].unlock).toEqual({ kind: 'free' });
    }
    expect(colourOf('beanie', { beanie: 1, shirt: 0, bag: 0 })).toBe(SWATCHES.beanie[1].colour);
  });

  it('lightens a colour towards white', () => {
    expect(lighten(0x000000, 0.5)).toBe(0x808080);
    expect(lighten(0xffffff)).toBe(0xffffff);
  });
});

describe('unlocking', () => {
  const p = (over: Partial<Progress>): Progress => ({ ...NO_PROGRESS, ...over });

  it('starts with just the free outfit', () => {
    expect(unlockedCount(NO_PROGRESS)).toEqual({ have: 3, total: 24 });
  });

  it('unlocks as the player progresses', () => {
    const grades = SWATCHES.shirt[1].unlock; // send 1 grade
    expect(isUnlocked(grades, p({ gradesSent: 0 }))).toBe(false);
    expect(isUnlocked(grades, p({ gradesSent: 1 }))).toBe(true);
    const v5 = SWATCHES.shirt[4].unlock;
    expect(isUnlocked(v5, p({ topGrade: 4 }))).toBe(false);
    expect(isUnlocked(v5, p({ topGrade: 5 }))).toBe(true);
    expect(isUnlocked(SWATCHES.beanie[4].unlock, p({ dailiesSent: 3 }))).toBe(true);
    expect(isUnlocked(SWATCHES.beanie[6].unlock, p({ survivalSeconds: 179 }))).toBe(false);
    expect(isUnlocked(SWATCHES.beanie[6].unlock, p({ survivalSeconds: 180 }))).toBe(true);
    expect(isUnlocked(SWATCHES.shirt[7].unlock, p({ bestScore: 5000 }))).toBe(true);
    expect(unlockedCount(p({ gradesSent: 99, topGrade: 99, dailiesSent: 99, survivalSeconds: 9999, bestScore: 1e6 }))).toEqual({ have: 24, total: 24 });
  });

  it('says how to earn each one', () => {
    for (const slot of SLOTS) for (const s of SWATCHES[slot]) expect(unlockHint(s.unlock).length).toBeGreaterThan(3);
    expect(unlockHint({ kind: 'survival', seconds: 90 })).toBe('Survive 1:30 in Survival');
    expect(unlockHint({ kind: 'grades', n: 1 })).toBe('Send 1 grade');
    expect(unlockHint({ kind: 'grades', n: 3 })).toBe('Send 3 grades');
    expect(unlockHint({ kind: 'grade', g: 8 })).toBe('Send V8');
  });
});

describe('the save', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));

  it('remembers the look, starting from the default', () => {
    expect(getLookCode()).toBe('000');
    setLookCode('142');
    expect(getLookCode()).toBe('142');
  });

  it('works out progress from what has been played', () => {
    expect(getProgress()).toEqual(NO_PROGRESS);
    recordResult('v0', 300, true);
    recordResult('v3', 900, true);
    recordResult('v7', 500, false); // fell: not sent
    recordResult('daily-2026-10-12', 700, true);
    recordResult('daily-2026-10-13', 400, false);
    recordResult('survival', 6000, false);
    recordTime('survival', 130.4);
    expect(getProgress()).toEqual({ gradesSent: 2, topGrade: 3, dailiesSent: 1, survivalSeconds: 130, bestScore: 6000 });
  });
});
