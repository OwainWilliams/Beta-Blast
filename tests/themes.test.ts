import { beforeEach, describe, expect, it } from 'vitest';
import { currentTheme, nextTheme, themeById, THEMES } from '../src/game/themes';
import { setThemeId } from '../src/game/storage';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe('themes', () => {
  it('each theme has five distinct route colours', () => {
    for (const t of THEMES) {
      expect(t.holds).toHaveLength(5);
      expect(new Set(t.holds).size).toBe(5);
    }
  });
  it('theme ids are unique and unknown ids fall back to the first theme', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(themeById('nope').id).toBe('classic');
  });
  it('the choice is remembered, and cycling comes back round', () => {
    expect(currentTheme().id).toBe('classic');
    setThemeId('umbraco');
    expect(currentTheme().id).toBe('umbraco');
    expect(nextTheme('umbraco').id).toBe('classic');
    expect(nextTheme('classic').id).toBe('umbraco');
  });
  it('an old save without a theme still loads as Classic', () => {
    store.set('beta-blast.v1', JSON.stringify({ best: { v1: 5 } }));
    expect(currentTheme().id).toBe('classic');
  });
});
