import { describe, expect, it } from 'vitest';
import { cleanSave, EMPTY_SAVE, MAX_ENTRIES, mergeSaves, sameSave } from '../src/game/saveMerge';

describe('cleaning a save', () => {
  it('keeps what belongs and drops the rest', () => {
    expect(cleanSave({ best: { v1: 5, daily: 3, 'daily-2026-10-12': 9, nope: 1, v2: -1, v3: 2.5, v4: '8' }, bestTime: { survival: 60 }, sent: { v1: true, v2: false, v3: 1 }, hints: { aim: true, 'No Good': true }, look: '123', stray: 1 })).toEqual({
      best: { v1: 5, 'daily-2026-10-12': 9 },
      bestTime: { survival: 60 },
      sent: { v1: true },
      hints: { aim: true },
      look: '123',
    });
  });

  it('turns anything that is not a save into an empty one', () => {
    for (const junk of [null, undefined, 'x', 5, [], [1, 2]]) expect(cleanSave(junk)).toEqual(EMPTY_SAVE);
    expect(cleanSave({ look: '999' }).look).toBeUndefined();
    expect(cleanSave({ look: 5 }).look).toBeUndefined();
  });

  it('caps how much one save can hold', () => {
    const best = Object.fromEntries(Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => [`v${i}`, 1]));
    expect(Object.keys(cleanSave({ best }).best)).toHaveLength(MAX_ENTRIES);
  });
});

describe('merging', () => {
  const a = { best: { v1: 100, v2: 5 }, bestTime: { survival: 60 }, sent: { v1: true }, hints: { aim: true }, look: '111' };
  const b = { best: { v1: 50, v3: 9 }, bestTime: { survival: 90 }, sent: { v3: true }, hints: { pump: true }, look: '222' };

  it('keeps the higher scores and everything sent or seen', () => {
    expect(mergeSaves(a, b, 'a')).toEqual({ best: { v1: 100, v2: 5, v3: 9 }, bestTime: { survival: 90 }, sent: { v1: true, v3: true }, hints: { aim: true, pump: true }, look: '111' });
  });

  it('takes the outfit from whoever is asked, falling back to the other', () => {
    expect(mergeSaves(a, b, 'b').look).toBe('222');
    expect(mergeSaves(a, { ...b, look: undefined }, 'b').look).toBe('111');
    expect(mergeSaves({ ...a, look: undefined }, { ...b, look: undefined }, 'a')).not.toHaveProperty('look');
  });

  it('gives the same result whichever way round, apart from the outfit', () => {
    expect({ ...mergeSaves(a, b, 'a'), look: 0 }).toEqual({ ...mergeSaves(b, a, 'a'), look: 0 });
  });

  it('does not change what it was given', () => {
    const copy = JSON.stringify([a, b]);
    mergeSaves(a, b, 'a');
    expect(JSON.stringify([a, b])).toBe(copy);
  });

  it('knows when two saves are the same, however the keys are ordered', () => {
    expect(sameSave({ ...EMPTY_SAVE, best: { v1: 1, v2: 2 } }, { ...EMPTY_SAVE, best: { v2: 2, v1: 1 } })).toBe(true);
    expect(sameSave(a, b)).toBe(false);
  });
});
