import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/game/engine';
import { BOMB, SLICK, VOLUME, WILD } from '../src/game/grid';
import { gradeLevel, LevelSpec, survivalLevel, versusLevel } from '../src/game/levels';
import { VERSUS_RULES } from '../src/game/versus';
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

describe('row timer', () => {
  const timed = (interval: number, extra: Partial<LevelSpec> = {}) =>
    custom(
      (l) => {
        l[0][0] = 1;
        l[0][1] = 2;
        l[0][9] = 3;
      },
      { dropInterval: interval, ...extra },
    );

  it('adds a row when the interval runs out, and not before', () => {
    const e = timed(10);
    expect(e.tick(9.9)).toBeNull();
    expect(e.timerFraction()).toBeCloseTo(0.99);
    const drop = e.tick(0.2)!;
    expect(drop.newRow).toHaveLength(e.grid.rowLength(0)); // rows alternate between 10 and 9 holds
    expect(e.drops).toBe(1);
    expect(e.timerFraction()).toBe(0); // restarts
    expect(e.grid.get(1, 0)).not.toBeNull(); // the old top row moved down
  });

  it('does nothing when the level has no timer', () => {
    const e = timed(0);
    expect(e.tick(1000)).toBeNull();
    expect(e.timerFraction()).toBe(0);
    expect(e.grid.count()).toBe(3);
  });

  it('leaves the pump pips alone', () => {
    const e = timed(5);
    shootAt(e, 3, 0, 0); // a miss
    expect(e.misses).toBe(1);
    e.tick(5.1);
    expect(e.misses).toBe(1);
  });

  it('a pump drop restarts the timer', () => {
    const e = timed(30, { shotsPerDrop: 3 });
    e.tick(20);
    shootAt(e, 3, 0, 0);
    shootAt(e, 3, 0, 9);
    const res = shootAt(e, 3, 0, 5);
    expect(res.newRow).not.toBeNull();
    expect(e.timerFraction()).toBe(0);
  });

  it('reports a loss when a timed row pushes the wall past the red line', () => {
    const e = timed(5);
    for (let i = 0; i < 11; i++) e.grid.addRowTop([1, 2]);
    expect(e.grid.lowestRow()).toBe(11); // one row above the red line
    const drop = e.tick(5.1)!;
    expect(e.grid.lowestRow()).toBe(12);
    expect(drop.lost).toBe(true);
  });

  it('a timed row breaks FLASH', () => {
    const e = timed(5);
    e.tick(5.1);
    expect(e.finishWin().flash).toBe(false);
  });
});

describe('survival', () => {
  const fresh = (seed = 7) => new Engine(survivalLevel(seed));

  it('starts small and calm', () => {
    const e = fresh();
    expect(e.grid.count()).toBeGreaterThan(20);
    expect(e.grid.lowestRow()).toBe(3);
    expect(e.grid.presentTypes().length).toBeLessThanOrEqual(3);
    expect(e.stage()).toBe(1);
    expect(e.currentInterval()).toBe(11);
  });

  it('moves up a stage with time, speeding the rows up and paying a bonus', () => {
    const e = fresh();
    const result = e.tick(40);
    expect(result!.stage).toBe(2);
    expect(e.stage()).toBe(2);
    expect(e.currentInterval()).toBeCloseTo(11 * 0.95);
    expect(e.score).toBe(250);
    // the same stage is only announced once
    expect(e.tick(0.1)).toBeNull();
  });

  it('never drops rows faster than the floor', () => {
    const e = fresh();
    e.elapsed = 40 * 200;
    expect(e.currentInterval()).toBe(4.5);
  });

  it('adds a row on the timer using the current stage colours', () => {
    const e = fresh();
    const result = e.tick(11.5)!;
    expect(result.newRow).toHaveLength(e.grid.rowLength(0));
    for (const h of result.newRow!) expect(h.type).toBeLessThan(3); // stage 1 has 3 colours
  });

  it('brings in more colours and then obstacles as the stages go by', () => {
    const e = fresh(11);
    e.elapsed = 40 * 9; // stage 10
    const kinds = new Set<number>();
    for (let i = 0; i < 60; i++) for (const h of e.tick(e['currentInterval']() + 0.01)?.newRow ?? []) kinds.add(h.type);
    expect(kinds.has(4)).toBe(true); // all five colours
    expect(kinds.has(VOLUME) || kinds.has(SLICK)).toBe(true);
  });

  it('gives new volumes their full two hits', () => {
    const e = fresh(3);
    e.elapsed = 40 * 20;
    const volumes: number[] = [];
    for (let i = 0; i < 80; i++) for (const h of e.tick(5)?.newRow ?? []) if (h.type === VOLUME) volumes.push(h.hp ?? -1);
    expect(volumes.length).toBeGreaterThan(0);
    expect(volumes.every((hp) => hp === 2)).toBe(true);
  });

  it('clearing the wall is a clean sweep, not a win', () => {
    const e = new Engine({ ...survivalLevel(5), layout: (() => { const l = emptyLayout(); l[0][0] = 1; l[0][1] = 1; l[0][9] = VOLUME; return l; })() });
    const res = e.land(1, e.grid.cellX(0, 2), e.grid.cellY(0), 0);
    expect(res.won).toBe(false);
    expect(res.lost).toBe(false);
    expect(res.sweep).toBe(true);
    expect(res.leftover).toHaveLength(1); // the volume is swept away
    expect(res.newRow).toHaveLength(9 + 10 + 9); // rows alternate between 9 and 10 holds
    expect(e.grid.count()).toBe(28);
    expect(e.score).toBeGreaterThanOrEqual(500);
    expect(e.grid.presentTypes().length).toBeGreaterThan(0);
  });

  it('a normal level still ends when the wall is cleared', () => {
    const e = custom((l) => { l[0][0] = 1; l[0][1] = 1; });
    const res = e.land(1, e.grid.cellX(0, 2), e.grid.cellY(0), 0);
    expect(res.won).toBe(true);
    expect(res.sweep).toBe(false);
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

describe('versus', () => {
  const duel = (seed = 21, extra: Partial<LevelSpec> = {}) => new Engine({ ...versusLevel(seed), ...extra });
  /** A small hand-built wall, so the shots below land where we expect. */
  const arena = (build: (l: number[][]) => void, extra: Partial<LevelSpec> = {}) => {
    const layout = emptyLayout();
    build(layout);
    return new Engine({ ...versusLevel(5), layout, ...extra });
  };
  // a pair of 1s on the top row with a 2 far away, so shooting a 1 at (0,2) pops three
  const pairAndAnchor = (l: number[][]) => {
    l[0][0] = 1;
    l[0][1] = 1;
    l[0][8] = 2;
  };
  const pop = (e: Engine) => e.land(1, e.grid.cellX(0, 2), e.grid.cellY(0), 0);
  const miss = (e: Engine) => e.land(3, e.grid.cellX(0, 5), e.grid.cellY(0), 0);

  afterEach(() => Object.assign(VERSUS_RULES, { cancelWithPops: true, deferUntilMiss: true }));

  it('gives both players the same wall and the same holds from the same seed', () => {
    const a = duel(77);
    const b = duel(77);
    expect(a.snapshot()).toEqual(b.snapshot());
    const dealt = (e: Engine) => Array.from({ length: 40 }, () => e.shoot());
    expect(dealt(a)).toEqual(dealt(b));
  });

  it('deals the same holds even when the two walls differ', () => {
    const a = duel(9);
    const b = duel(9);
    // b's wall gets two extra rows, a's does not; the colours are still all present
    b.receive(2);
    b.land(3, b.grid.cellX(0, 5), b.grid.cellY(0), 0);
    const kinds = (e: Engine) => Array.from({ length: 30 }, () => e.shoot()).filter((t) => t >= 5);
    // bombs and mega jugs come from the shared stream, so they appear at the same moments
    expect(kinds(a)).toEqual(kinds(b));
  });

  it('a different seed is a different match', () => {
    expect(duel(1).snapshot()).not.toEqual(duel(2).snapshot());
  });

  it('a connection sends a row to the opponent', () => {
    const e = arena(pairAndAnchor);
    const res = pop(e);
    expect(res.popped).toHaveLength(3);
    expect(res.attack).toBe(1);
    expect(e.sent).toBe(1);
  });

  it('a miss sends nothing', () => {
    const e = arena(pairAndAnchor);
    expect(miss(e).attack).toBe(0);
  });

  it('rows sent to you wait until you miss, then all land together', () => {
    const e = arena(pairAndAnchor);
    e.receive(2);
    expect(e.pending).toBe(2);
    const before = e.grid.count();
    const res = miss(e);
    expect(res.incomingRows).toBe(2);
    expect(res.incoming).toHaveLength(e.grid.rowLength(0) + e.grid.rowLength(1));
    expect(e.pending).toBe(0);
    expect(e.received).toBe(2);
    expect(e.grid.count()).toBe(before + 1 + 10 + 9); // the missed hold, plus two rows
  });

  it('popping cancels queued rows before sending any on', () => {
    const e = arena(pairAndAnchor);
    e.receive(1);
    const res = pop(e);
    expect(res.cancelled).toBe(1);
    expect(res.attack).toBe(0);
    expect(res.incoming).toBeNull();
    expect(e.pending).toBe(0);
    expect(e.sent).toBe(0);
  });

  it('a pop that cancels only some of the queue leaves the rest waiting', () => {
    const e = arena(pairAndAnchor);
    e.receive(3);
    const res = pop(e);
    expect(res.cancelled).toBe(1);
    expect(res.attack).toBe(0);
    expect(res.incoming).toBeNull(); // deferred: a pop never lets rows land
    expect(e.pending).toBe(2);
  });

  it('a big cut-off pays an extra row', () => {
    const e = arena((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
      l[0][8] = 2;
      // a long tail hanging off the pair: five holds that fall once it pops
      l[1][0] = 3;
      l[2][0] = 4;
      l[3][0] = 3;
      l[4][0] = 4;
      l[5][0] = 3;
    });
    const res = pop(e);
    expect(res.fallen.length).toBeGreaterThanOrEqual(4);
    expect(res.attack).toBe(2);
  });

  it('clearing every colour sends a lot and refills your wall', () => {
    const e = arena((l) => {
      l[0][0] = 1;
      l[0][1] = 1;
    });
    const res = pop(e);
    expect(res.won).toBe(false); // versus never ends by clearing
    expect(res.sweep).toBe(true);
    expect(res.attack).toBe(1 + 3); // the connection plus the sweep
    expect(res.newRow!.length).toBe(9 + 10 + 9);
    expect(e.grid.presentTypes().length).toBeGreaterThan(0);
  });

  it('incoming rows can bury you', () => {
    const e = arena(pairAndAnchor);
    for (let i = 0; i < 11; i++) e.grid.addRowTop([1, 2]);
    expect(e.grid.lowestRow()).toBe(11);
    e.receive(2);
    expect(miss(e).lost).toBe(true);
  });

  it('can be set to land rows after every shot, even a pop', () => {
    VERSUS_RULES.deferUntilMiss = false;
    const e = arena(pairAndAnchor);
    e.receive(2);
    const res = pop(e);
    expect(res.cancelled).toBe(1);
    expect(res.incomingRows).toBe(1); // what the pop did not cancel lands now
  });

  it('can be set not to cancel at all', () => {
    VERSUS_RULES.cancelWithPops = false;
    const e = arena(pairAndAnchor);
    e.receive(1);
    const res = pop(e);
    expect(res.cancelled).toBe(0);
    expect(res.attack).toBe(1);
    expect(e.pending).toBe(1);
  });

  it('describes the wall for the opponent view, trimming empty rows', () => {
    const e = arena(pairAndAnchor);
    expect(e.snapshot()).toEqual(['11......2.']);
    const snap = duel(3).snapshot();
    expect(snap.length).toBeGreaterThanOrEqual(5);
    for (const row of snap) expect(row).toMatch(/^[0-467.]{9,10}$/);
  });
});
