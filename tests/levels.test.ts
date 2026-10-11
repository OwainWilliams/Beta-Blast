import { describe, expect, it } from 'vitest';
import { Engine } from '../src/game/engine';
import { dropIntervalFor, gradeLevel } from '../src/game/levels';

describe('endless grades', () => {
  it('builds a playable level for any grade', () => {
    for (const g of [0, 5, 10, 11, 25, 60, 200]) {
      const level = gradeLevel(g);
      const e = new Engine(level);
      expect(level.label).toBe(`V${g}`);
      expect(e.grid.count()).toBeGreaterThan(20);
      expect(e.grid.presentTypes().length).toBeGreaterThanOrEqual(3);
      expect(e.grid.lowestRow()).toBeLessThan(12); // never starts on the red line
    }
  });

  it('gives every grade its own wall', () => {
    const wall = (g: number) => new Engine(gradeLevel(g)).grid.rows.map((r) => r.map((h) => h?.type)).join('|');
    const walls = new Set([20, 21, 22, 23, 24, 25].map(wall));
    expect(walls.size).toBe(6);
  });

  it('never gets easier as the grade goes up', () => {
    for (let g = 0; g < 80; g++) {
      const a = gradeLevel(g);
      const b = gradeLevel(g + 1);
      expect(b.dropInterval!).toBeLessThanOrEqual(a.dropInterval!);
      expect(b.shotsPerDrop).toBeLessThanOrEqual(a.shotsPerDrop);
      expect(b.volumeRate!).toBeGreaterThanOrEqual(a.volumeRate!);
      expect(b.slickRate!).toBeGreaterThanOrEqual(a.slickRate!);
      expect(b.rows).toBeGreaterThanOrEqual(a.rows);
    }
  });

  it('speeds up the rows with the grade, down to a floor', () => {
    expect(dropIntervalFor(0)).toBe(90);
    expect(dropIntervalFor(10)).toBeLessThan(dropIntervalFor(5));
    expect(dropIntervalFor(5)).toBeLessThan(dropIntervalFor(0));
    expect(dropIntervalFor(500)).toBe(20);
  });

  it('keeps the tuned V0 to V10 settings', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((g) => gradeLevel(g).shotsPerDrop)).toEqual([8, 8, 7, 7, 7, 7, 6, 6, 5, 5, 4]);
    expect(gradeLevel(8).volumeRate).toBeCloseTo(0.12);
    expect(gradeLevel(10).slickRate).toBeCloseTo(0.08);
  });
});
