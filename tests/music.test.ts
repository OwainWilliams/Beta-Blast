import { describe, expect, it } from 'vitest';
import { buildPattern, STEPS, tempoFor } from '../src/game/music';

describe('music', () => {
  it('speeds up with the grade and tops out', () => {
    expect(tempoFor(0)).toBe(96);
    expect(tempoFor(10)).toBe(136);
    expect(tempoFor(13)).toBe(148);
    expect(tempoFor(14)).toBe(150);
    expect(tempoFor(500)).toBe(150);
    for (let g = 0; g < 30; g++) expect(tempoFor(g + 1)).toBeGreaterThanOrEqual(tempoFor(g));
  });

  it('builds the same loop for the same grade, and a different one for another', () => {
    expect(buildPattern(7)).toEqual(buildPattern(7));
    expect(buildPattern(7).pcs).not.toEqual(buildPattern(8).pcs);
    expect(buildPattern(7).lead).not.toEqual(buildPattern(11).lead); // same chords, different melody
    expect(buildPattern(7).pcs).toEqual(buildPattern(11).pcs);
  });

  it('is four bars with a beat to dance to', () => {
    for (const g of [0, 3, 9, 40]) {
      const p = buildPattern(g);
      for (const track of [p.bass, p.arp, p.lead, p.kick, p.snare, p.hat]) expect(track).toHaveLength(STEPS);
      for (let bar = 0; bar < 4; bar++) {
        expect(p.kick[bar * 16]).toBe(true); // kick on the one
        expect(p.snare[bar * 16 + 4]).toBe(true); // snare on the two
        expect(p.snare[bar * 16 + 12]).toBe(true); // and the four
        expect(p.bass[bar * 16]).not.toBeNull();
        expect(p.lead[bar * 16]).not.toBeNull();
      }
    }
  });

  it('keeps every note in a comfortable range', () => {
    for (let g = 0; g < 40; g++) {
      const p = buildPattern(g);
      for (const n of p.bass) if (n !== null) expect(n).toBeGreaterThanOrEqual(40), expect(n).toBeLessThanOrEqual(76);
      for (const n of p.arp) if (n !== null) expect(n).toBeGreaterThanOrEqual(55), expect(n).toBeLessThanOrEqual(75);
      for (const n of p.lead) if (n !== null) expect(n).toBeGreaterThanOrEqual(67), expect(n).toBeLessThanOrEqual(86);
    }
  });
});
