import { describe, expect, it } from 'vitest';
import { Engine } from '../src/game/engine';
import { dropIntervalFor, gradeLevel, speedBonus, speedBonusMax, speedBonusSeconds, speedPointsPerSecond } from '../src/game/levels';
import { SCORE_BASE } from '../src/game/replay';

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

describe('the speed bonus curve', () => {
  it('is largest for an instant send and runs out at the par time', () => {
    for (const g of [0, 3, 10, 25]) {
      expect(speedBonus(g, 0)).toBe(speedBonusMax(g));
      expect(speedBonus(g, speedBonusSeconds(g))).toBe(0);
      expect(speedBonus(g, speedBonusSeconds(g) * 5)).toBe(0);
    }
  });

  it('only ever goes down as the time goes up', () => {
    for (const g of [0, 5, 12]) {
      let last = Infinity;
      for (let t = 0; t <= speedBonusSeconds(g) + 10; t += 3) {
        const b = speedBonus(g, t);
        expect(b).toBeLessThanOrEqual(last);
        expect(b).toBeGreaterThanOrEqual(0);
        last = b;
      }
    }
  });

  it('asks for more time and pays more on harder grades, and stops growing at the top', () => {
    expect(speedBonusMax(5)).toBeGreaterThan(speedBonusMax(0));
    expect(speedBonusSeconds(5)).toBeGreaterThan(speedBonusSeconds(0));
    expect(speedBonusMax(40)).toBe(speedBonusMax(20));
    expect(speedBonusSeconds(40)).toBe(speedBonusSeconds(12));
  });

  it('is a whole number, falls by the same amount every second, and is half the maximum at half the par time', () => {
    expect(Number.isInteger(speedBonus(3, 17.3))).toBe(true);
    for (const g of [0, 4, 9]) {
      expect(Math.abs(speedBonus(g, 10) - speedBonus(g, 11) - speedPointsPerSecond(g))).toBeLessThanOrEqual(1); // to the nearest point
      expect(speedBonus(g, speedBonusSeconds(g) / 2)).toBeCloseTo(speedBonusMax(g) / 2, 0);
    }
  });

  it('is worth more per second than the extra points a slow game collects from the rows the timer adds', () => {
    // measured on bot play: a second of delay was worth about 7 to 16 points of extra popping
    expect(speedPointsPerSecond(0)).toBeGreaterThanOrEqual(12);
    expect(speedPointsPerSecond(8)).toBeGreaterThanOrEqual(24);
    expect(speedBonusSeconds(0)).toBeGreaterThanOrEqual(120); // and it lasts as long as slow games do
  });

  it('stays inside the score ceiling used to check leaderboard posts', () => {
    for (const g of [0, 10, 30]) expect(speedBonusMax(g) + 100 * (g + 1) + 500).toBeLessThan(SCORE_BASE);
  });
});
