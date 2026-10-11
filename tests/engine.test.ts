import { describe, expect, it } from 'vitest';
import { Engine } from '../src/game/engine';
import { BOMB, SLICK, VOLUME, WILD } from '../src/game/grid';
import { gradeLevel, LevelSpec } from '../src/game/levels';
import { emptyLayout } from '../src/game/routes';

function custom(build: (l: number[][]) => void, extra: Partial<LevelSpec> = {}): Engine {
  const layout = emptyLayout();
  build(layout);
  return new Engine({ ...gradeLevel(0), rows: 0, layout, bombs: false, wilds: false, ...extra });
}

/** Land a ball of `type` right under the hold at (r, c). */
function shootAt(e: Engine, type: number, r: number, c: number, bounces = 0) {
  return e.land(type, e.grid.cellX(r, c), e.grid.cellY(r + 1), bounces);
}

describe('engine setup', () => {
  it('generates the same wall for the same seed', () => {
    const a = new Engine(gradeLevel(5));
    const b = new Engine(gradeLevel(5));
    expect(a.grid.rows.map((r) => r.map((h) => h?.type))).toEqual(b.grid.rows.map((r) => r.map((h) => h?.type)));
  });

  it('adds obstacles only at higher grades', () => {
    const types = (g: number) => new Engine(gradeLevel(g)).grid.cells().map(([r, c]) => new Engine(gradeLevel(g)).grid.get(r, c)!.type);
    expect(types(0).some((t) => t === VOLUME || t === SLICK)).toBe(false);
    expect(types(9).some((t) => t === VOLUME)).toBe(true);
  });

  it('drops holds that hang in mid-air in a hand-built route', () => {
    const e = custom((l) => {
      l[0][0] = 0;
      l[5][5] = 1; // floating
    });
    expect(e.grid.count()).toBe(1);
  });

  it('only queues colours that are on the wall', () => {
    const e = custom((l) => {
      l[0][0] = 3;
      l[0][1] = 3;
    });
    expect([e.cur, e.nxt]).toEqual([3, 3]);
  });
});

describe('shots', () => {
  it('pops three in a row and scores them', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
      l[0][5] = 2; // keeps the route going
    });
    const res = shootAt(e, 1, 0, 0);
    expect(res.popped).toHaveLength(3);
    expect(res.pop).toBe(30);
    expect(res.won).toBe(false);
    expect(e.score).toBe(30);
    expect(e.misses).toBe(0);
  });

  it('counts a miss when nothing pops', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][5] = 2;
    });
    const res = shootAt(e, 3, 0, 0);
    expect(res.popped).toHaveLength(0);
    expect(e.misses).toBe(1);
    expect(e.combo).toBe(0);
  });

  it('drops a row after too many misses', () => {
    const e = custom(
      (l) => {
        l[0][0] = 1;
        l[0][5] = 2;
      },
      { shotsPerDrop: 3 },
    );
    shootAt(e, 3, 0, 0);
    shootAt(e, 3, 0, 9);
    const res = shootAt(e, 3, 0, 5);
    expect(res.newRow).not.toBeNull();
    expect(e.drops).toBe(1);
    expect(e.misses).toBe(0);
  });

  it('cuts off holds that lose their anchor', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
      l[1][0] = 2; // hangs from (0,0) / (0,1)
      l[1][1] = 2;
    });
    const res = e.land(1, e.grid.cellX(0, 2), e.grid.cellY(0), 0); // extends the row of 1s
    expect(res.popped).toHaveLength(3);
    expect(res.fallen).toHaveLength(2);
    expect(res.fall).toBe(60); // 20 + 40
  });

  it('builds a combo across consecutive pops and resets on a miss', () => {
    const e = custom((l) => {
      for (let c = 0; c < 10; c++) l[0][c] = c % 2 ? 1 : 2;
      l[1][0] = 3;
      l[1][1] = 3;
      l[1][7] = 4;
      l[1][8] = 4;
    });
    e.land(3, e.grid.cellX(1, 0), e.grid.cellY(2), 0);
    expect(e.combo).toBe(1);
    e.land(4, e.grid.cellX(1, 7), e.grid.cellY(2), 0);
    expect(e.combo).toBe(2);
    e.land(1, e.grid.cellX(1, 3), e.grid.cellY(1), 0); // only pairs up with one hold
    expect(e.combo).toBe(0);
    expect(e.bestCombo).toBe(2);
  });

  it('adds a bank bonus per wall bounce', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
      l[0][5] = 2;
    });
    expect(shootAt(e, 1, 0, 0, 2).bank).toBe(50);
  });

  it('is sent when the last colour goes, even with obstacles left', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
      l[0][9] = VOLUME;
    });
    const res = shootAt(e, 1, 0, 0);
    expect(res.won).toBe(true);
    expect(res.leftover).toHaveLength(1);
    expect(e.grid.count()).toBe(0);
    expect(e.finishWin()).toEqual({ bonus: 100 + 500, flash: true });
  });

  it('loses when the wall reaches the red line', () => {
    const e = custom(
      (l) => {
        for (let r = 0; r < 10; r++) l[r][0] = r % 2 ? 1 : 2;
        l[0][5] = 3;
      },
      { shotsPerDrop: 3 },
    );
    // a long column hanging down; grow it two more rows to hit LOSE_ROW
    e.grid.addRowTop([1, 2]);
    e.grid.addRowTop([1, 2]);
    e.grid.addRowTop([1, 2]);
    expect(e.grid.lowestRow()).toBeGreaterThanOrEqual(12);
    const res = e.land(4, e.grid.cellX(0, 8), e.grid.cellY(1), 0);
    expect(res.lost).toBe(true);
  });
});

describe('special holds', () => {
  it('chalk bomb clears everything around it, obstacles included', () => {
    const e = custom((l) => {
      l[0][2] = 1;
      l[0][3] = VOLUME;
      l[0][4] = 2;
      l[0][9] = 3;
    });
    const res = e.land(BOMB, e.grid.cellX(1, 2), e.grid.cellY(1), 0);
    expect(res.popped).toHaveLength(3); // bomb + (0,2) + the volume
    expect(e.grid.get(0, 3)).toBeNull();
    expect(e.grid.get(0, 4)).not.toBeNull();
  });

  it('volume cracks on the first nearby pop and breaks on the second', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
      l[0][2] = VOLUME;
      l[0][3] = 4;
      l[0][4] = 4;
      l[0][9] = 3;
    });
    const volume = e.grid.get(0, 2)!;
    expect(volume.hp).toBe(2);
    const first = e.land(1, e.grid.cellX(1, 0), e.grid.cellY(1), 0);
    expect(first.popped).toHaveLength(3);
    expect(first.cracked).toEqual([volume]);
    expect(e.grid.get(0, 2)).toBe(volume);
    const second = e.land(4, e.grid.cellX(1, 3), e.grid.cellY(1), 0);
    expect(second.popped.some((p) => p.hold === volume)).toBe(true);
    expect(e.grid.get(0, 2)).toBeNull();
  });

  it('a ball next to a slick hold slides down and away', () => {
    const e = custom((l) => {
      l[0][4] = 1;
      l[0][5] = SLICK;
      l[1][3] = 2;
      l[1][4] = 2; // neighbours below the landing spot
      l[0][9] = 3;
    });
    const spot = e.preview(e.grid.cellX(0, 6), e.grid.cellY(0));
    expect(spot).not.toBeNull();
    // preview must agree with what land() does
    const res = e.land(3, e.grid.cellX(0, 6), e.grid.cellY(0), 0);
    expect(res.placed!.cell).toEqual(spot);
  });
});

describe('mega jug', () => {
  it('turns into the colour that makes the biggest group', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][1] = 1; // a pair of 1s
      l[0][2] = 2; // a lone 2
      l[0][9] = 3;
    });
    const res = e.land(WILD, e.grid.cellX(1, 1), e.grid.cellY(1), 0);
    expect(res.placed!.wild).toBe(true);
    expect(res.placed!.hold.type).toBe(1);
    expect(res.popped.length).toBeGreaterThanOrEqual(3);
    expect(e.misses).toBe(0);
  });

  it('joins the colour it touches most when nothing can pop', () => {
    const e = custom((l) => {
      l[0][0] = 4;
      l[0][2] = 3;
      l[0][4] = 2;
      l[0][9] = 1;
    });
    const cell = e.preview(e.grid.cellX(1, 0), e.grid.cellY(1))!;
    const res = e.land(WILD, e.grid.cellX(1, 0), e.grid.cellY(1), 0);
    expect(res.popped).toHaveLength(0);
    expect([4, 3, 2, 1]).toContain(res.placed!.hold.type);
    expect(res.placed!.cell).toEqual(cell);
    expect(e.misses).toBe(1);
  });

  it('previewing the colour leaves the wall untouched', () => {
    const e = custom((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
      l[0][9] = 2;
    });
    const before = e.grid.count();
    expect(e.resolveWild([1, 0])).toBe(1);
    expect(e.grid.count()).toBe(before);
  });

  it('appears in the queue only when the level allows it', () => {
    const queue = (wilds: boolean) => {
      const e = new Engine({ ...gradeLevel(1), wilds });
      const seen = new Set<number>();
      for (let i = 0; i < 400; i++) seen.add(e.shoot());
      return seen;
    };
    expect(queue(false).has(WILD)).toBe(false);
    expect(queue(true).has(WILD)).toBe(true);
  });
});

describe('flight', () => {
  it('bounces off the side walls and stops at a hold or the ceiling', () => {
    const e = custom((l) => {
      l[0][0] = 1;
    });
    const { end } = e.trace(1.3);
    expect(end.bounces).toBeGreaterThan(0);
    expect(end.y).toBeLessThan(640);
  });
});
