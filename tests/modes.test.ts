import { describe, expect, it } from 'vitest';
import { CONTROLS, MODES, modeInfo } from '../src/game/modes';

describe('the how-to-play pages', () => {
  it('cover every way to play once, each with a title, a tagline, some rules and a button label', () => {
    expect(MODES.map((m) => m.id).sort()).toEqual(['arcade', 'daily', 'grades', 'survival', 'versus']);
    for (const m of MODES) {
      expect(m.title.length).toBeGreaterThan(2);
      expect(m.tagline.length).toBeGreaterThan(10);
      expect(m.lines.length).toBeGreaterThanOrEqual(3);
      expect(m.go.length).toBeGreaterThan(2);
      for (const line of m.lines) expect(line.length).toBeLessThan(200); // the page has room for about five short lines
    }
    expect(CONTROLS.length).toBeLessThan(120);
  });
  it('look a mode up by id', () => {
    expect(modeInfo('arcade').title).toBe('ARCADE');
    expect(modeInfo('versus').title).toBe('2 PLAYER');
  });
});
