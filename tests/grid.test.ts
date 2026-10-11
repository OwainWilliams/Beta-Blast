import { describe, expect, it } from 'vitest';
import { BOMB, COLS, D, Grid } from '../src/game/grid';

function filled(rows: number, type = 0): Grid {
  const g = new Grid();
  for (let r = 0; r < rows; r++) {
    g.ensureRow(r);
    for (let c = 0; c < g.rowLength(r); c++) g.set(r, c, { type });
  }
  return g;
}

describe('hex geometry', () => {
  it('alternates row lengths', () => {
    const g = new Grid();
    expect(g.rowLength(0)).toBe(COLS);
    expect(g.rowLength(1)).toBe(COLS - 1);
  });

  it('neighbours are symmetric and exactly one hold-width apart', () => {
    const g = new Grid();
    for (let r = 0; r < 6; r++) {
      g.ensureRow(r);
      for (let c = 0; c < g.rowLength(r); c++) {
        for (const [nr, nc] of g.neighbors(r, c)) {
          const dist = Math.hypot(g.cellX(r, c) - g.cellX(nr, nc), g.cellY(r) - g.cellY(nr));
          expect(dist).toBeCloseTo(D, 5);
          expect(g.neighbors(nr, nc).some(([a, b]) => a === r && b === c)).toBe(true);
        }
      }
    }
  });

  it('interior cells have six neighbours', () => {
    const g = new Grid();
    g.ensureRow(4);
    expect(g.neighbors(2, 4)).toHaveLength(6);
    expect(g.neighbors(3, 4)).toHaveLength(6);
  });
});

describe('matching', () => {
  it('finds a connected same-colour group', () => {
    const g = new Grid();
    g.set(0, 0, { type: 1 });
    g.set(0, 1, { type: 1 });
    g.set(0, 2, { type: 2 });
    g.set(1, 0, { type: 1 });
    expect(g.findMatches(0, 0)).toHaveLength(3);
    expect(g.findMatches(0, 2)).toHaveLength(1);
  });

  it('chalk bomb clears itself and touching holds', () => {
    const g = filled(3);
    g.set(1, 3, { type: BOMB });
    expect(g.blast(1, 3)).toHaveLength(7);
  });
});

describe('floating holds', () => {
  it('finds holds cut off from the top row', () => {
    const g = new Grid();
    g.set(0, 0, { type: 0 });
    g.set(1, 0, { type: 1 });
    g.set(2, 0, { type: 2 });
    g.set(4, 3, { type: 3 });
    expect(g.findFloating()).toEqual([[4, 3]]);
    g.set(1, 0, null);
    expect(g.findFloating()).toHaveLength(2);
  });
});

describe('snapping', () => {
  it('snaps into the top row at the ceiling', () => {
    const g = new Grid();
    g.ensureRow(0);
    const [r, c] = g.nearestEmpty(g.cellX(0, 4) + 3, 25)!;
    expect([r, c]).toEqual([0, 4]);
  });

  it('snaps below a hold, never into thin air', () => {
    const g = new Grid();
    g.set(0, 4, { type: 0 });
    const [r] = g.nearestEmpty(g.cellX(0, 4), g.cellY(2))!;
    expect(r).toBe(1);
  });

  it('detects collisions with holds only when close', () => {
    const g = new Grid();
    g.set(0, 4, { type: 0 });
    expect(g.collides(g.cellX(0, 4), g.cellY(0) + D * 0.8)).toBe(true);
    expect(g.collides(g.cellX(0, 4), g.cellY(0) + D * 1.3)).toBe(false);
  });
});

describe('adding a row on top', () => {
  it('keeps existing holds in place relative to each other', () => {
    const g = filled(3);
    const before = g.cellX(1, 2);
    g.addRowTop([1, 2, 3]);
    expect(g.cellX(2, 2)).toBe(before);
    expect(g.rows[0]).toHaveLength(g.rowLength(0));
    expect(g.rows.every((row, r) => row.length === g.rowLength(r))).toBe(true);
    // new top row must be attached to the old one
    expect(g.findFloating()).toHaveLength(0);
  });
});
