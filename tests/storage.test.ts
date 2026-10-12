import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBest, getMusic, isSent, recordResult, setMusic } from '../src/game/storage';

/** A tiny in-memory localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    keys: () => [...data.keys()],
  };
}

const oldSave = JSON.stringify({ best: { v3: 1200, survival: 5000 }, bestTime: { survival: 200 }, sent: { v3: true }, muted: true, shake: false, music: false, hints: { aim: true } });

describe('saves survive the rename', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('reads a save made under the old name', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'crimp-and-pop.v1': oldSave }));
    expect(getBest('v3')).toBe(1200);
    expect(getBest('survival')).toBe(5000);
    expect(isSent('v3')).toBe(true);
    expect(getMusic()).toBe(false);
  });

  it('moves it to the new name the next time anything is saved', () => {
    const store = fakeStorage({ 'crimp-and-pop.v1': oldSave });
    vi.stubGlobal('localStorage', store);
    recordResult('v4', 900, true);
    expect(store.keys()).toEqual(['beta-blast.v1']);
    expect(getBest('v3')).toBe(1200); // old scores came along
    expect(getBest('v4')).toBe(900);
    expect(isSent('v4')).toBe(true);
  });

  it('prefers a save under the new name', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'crimp-and-pop.v1': oldSave, 'beta-blast.v1': JSON.stringify({ best: { v3: 77 } }) }));
    expect(getBest('v3')).toBe(77);
  });

  it('starts fresh with no save, and survives a corrupt one', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(getBest('v0')).toBe(0);
    expect(getMusic()).toBe(true);
    vi.stubGlobal('localStorage', fakeStorage({ 'beta-blast.v1': '{not json' }));
    expect(getBest('v0')).toBe(0);
    setMusic(false);
    expect(getMusic()).toBe(false);
  });
});
