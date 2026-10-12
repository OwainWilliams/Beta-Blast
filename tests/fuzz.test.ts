// Plays thousands of random shots on every kind of level and checks the rules that must always hold.
import { describe, expect, it } from 'vitest';
import { Engine, MAX_AIM } from '../src/game/engine';
import { BOMB, Hold, isColour, isObstacle, LOSE_ROW, SLICK, VOLUME, WILD } from '../src/game/grid';
import { gradeLevel, LevelSpec, mulberry32, survivalLevel, versusLevel } from '../src/game/levels';
import { emptyLayout } from '../src/game/routes';
import { MAX_ATTACK, MAX_ROWS, parseMessage } from '../src/net/protocol';

function customLevel(seed: number): LevelSpec {
  const rng = mulberry32(seed);
  const layout = emptyLayout();
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      const roll = rng();
      layout[r][c] = roll < 0.08 ? VOLUME : roll < 0.14 ? SLICK : roll < 0.2 ? -1 : Math.floor(rng() * 5);
    }
  }
  return { ...gradeLevel(5), seed, rows: 0, layout, dropInterval: [0, 10, 20][seed % 3], custom: true };
}

const LEVELS: [string, (seed: number) => LevelSpec][] = [
  ['V0', (s) => ({ ...gradeLevel(0), seed: s })],
  ['V6', (s) => ({ ...gradeLevel(6), seed: s })],
  ['V12', (s) => ({ ...gradeLevel(12), seed: s })],
  ['survival', (s) => survivalLevel(s)],
  ['versus', (s) => versusLevel(s)],
  ['custom route', customLevel],
];

/** What the random games actually exercised, so a quiet fuzz test can't pass by never reaching the interesting cases. */
const seen = { shots: 0, pops: 0, bombs: 0, wilds: 0, slid: 0, cracked: 0, broke: 0, fell: 0, sweeps: 0, attacks: 0, cancelled: 0, incoming: 0, pumpRows: 0, timedRows: 0, stageUps: 0, lost: 0 };

function checkWall(e: Engine, where: string) {
  const g = e.grid;
  g.rows.forEach((row, r) => expect(row.length, `${where}: row ${r} length`).toBe(g.rowLength(r)));
  for (const [r, c] of g.cells()) {
    const h = g.get(r, c) as Hold;
    const ok = isColour(h.type) || isObstacle(h.type);
    expect(ok, `${where}: bad hold type ${h.type} at ${r},${c}`).toBe(true);
    if (h.type === VOLUME) expect([1, 2], `${where}: volume hp`).toContain(h.hp);
    if (h.type === SLICK) expect(h.hp, `${where}: slick hp`).toBe(1);
    if (isColour(h.type)) expect(h.hp, `${where}: colour hold with hp`).toBeUndefined();
  }
  expect(g.findFloating(), `${where}: holds hanging in mid-air`).toHaveLength(0);
}

function checkQueue(e: Engine, where: string) {
  const present = e.grid.presentTypes();
  for (const t of [e.cur, e.nxt]) {
    expect([0, 1, 2, 3, 4, BOMB, WILD], `${where}: queue type ${t}`).toContain(t);
    if (isColour(t) && present.length) expect(present, `${where}: queued colour ${t} is not on the wall`).toContain(t);
  }
}

describe('fuzz: random play never breaks the rules', () => {
  for (const [name, make] of LEVELS) {
    it(`${name}: 40 games of random shots`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const level = make(seed * 977);
        const e = new Engine(level);
        const rng = mulberry32(seed * 31 + 7);
        checkWall(e, `${name}#${seed} start`);
        checkQueue(e, `${name}#${seed} start`);
        let lastScore = 0;
        for (let shot = 1; shot <= 90; shot++) {
          const where = `${name}#${seed} shot ${shot}`;
          // time passes, and in versus the opponent sometimes sends rows
          const timed = e.tick(rng() * 4);
          if (timed?.newRow) seen.timedRows++;
          if (timed?.stage) seen.stageUps++;
          if (timed) checkWall(e, `${where} after timer`);
          if (timed?.lost) break;
          if (level.versus && rng() < 0.3) e.receive(1 + Math.floor(rng() * 3));
          if (rng() < 0.15) e.swap();

          const aim = (rng() * 2 - 1) * MAX_AIM;
          const { end } = e.trace(aim);
          expect(end.y, `${where}: trace ended off screen`).toBeGreaterThanOrEqual(24);
          expect(end.x, `${where}: trace left the field`).toBeGreaterThan(0);
          expect(end.x).toBeLessThan(480);

          const type = e.shoot();
          const before = new Set(e.grid.cells().map(([r, c]) => e.grid.get(r, c)));
          const res = e.land(type, end.x, end.y, end.bounces);
          if (!res.placed) break; // nowhere to stick: the wall is full
          seen.shots++;
          if (res.popped.length) seen.pops++;
          if (type === BOMB) seen.bombs++;
          if (res.placed.wild) seen.wilds++;
          if (res.placed.slid) seen.slid++;
          seen.cracked += res.cracked.length;
          seen.broke += res.popped.filter((p) => isObstacle(p.hold.type)).length;
          if (res.fallen.length) seen.fell++;
          if (res.sweep) seen.sweeps++;
          if (res.attack) seen.attacks++;
          if (res.cancelled) seen.cancelled++;
          if (res.incoming) seen.incoming++;
          if (res.newRow && !res.sweep) seen.pumpRows++;
          expect(e.score, `${where}: score went down`).toBeGreaterThanOrEqual(lastScore);
          lastScore = e.score;
          expect(e.combo).toBeGreaterThanOrEqual(0);
          expect(e.pending).toBeGreaterThanOrEqual(0);
          expect(e.misses, `${where}: misses`).toBeLessThan(level.shotsPerDrop);

          // what was removed really is gone, and nothing is both popped and fallen
          const gone = [...res.popped, ...res.fallen, ...res.leftover].map((x) => x.hold);
          expect(new Set(gone).size, `${where}: a hold was removed twice`).toBe(gone.length);
          for (const h of gone) {
            const still = e.grid.cells().some(([r, c]) => e.grid.get(r, c) === h);
            expect(still, `${where}: removed hold is still on the wall`).toBe(false);
          }
          for (const h of before) if (h && !gone.includes(h)) expect(e.grid.cells().some(([r, c]) => e.grid.get(r, c) === h), `${where}: a hold vanished without being reported`).toBe(true);
          if (res.popped.length && type !== BOMB) expect(res.popped.length, `${where}: popped a group smaller than 3`).toBeGreaterThanOrEqual(3);
          if (res.attack) expect(level.versus).toBe(true);

          if (res.lost) {
            seen.lost++;
            expect(e.grid.lowestRow(), `${where}: lost but wall is above the line`).toBeGreaterThanOrEqual(LOSE_ROW);
            break;
          }
          expect(e.grid.lowestRow(), `${where}: wall below the line but not lost`).toBeLessThan(LOSE_ROW);
          checkWall(e, where);
          if (res.won) {
            expect(e.grid.count()).toBe(0);
            expect(level.survival || level.versus, `${where}: won in a mode with no win`).toBeFalsy();
            break;
          }
          checkQueue(e, where);
        }
      }
    });
  }

  it('actually reached the interesting cases', () => {
    for (const [what, n] of Object.entries(seen)) expect(n, `the fuzz games never produced: ${what} (${JSON.stringify(seen)})`).toBeGreaterThan(0);
    expect(seen.shots).toBeGreaterThan(2000);
  });
});

describe('fuzz: whatever the network sends', () => {
  const rng = mulberry32(99);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const junkString = () => pick(['', 'attack', 'over', '0123401234', '.....', '__proto__', '<script>alert(1)</script>', 'x'.repeat(5000), '9999999999', '0'.repeat(11)]);
  const junkNumber = () => pick([0, 1, 2, 3, 4, 5, -1, 99, 100, 1e9, 1e9 + 1, 2 ** 32, 2 ** 32 - 1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER]);
  function junk(depth = 0): unknown {
    const roll = rng();
    if (roll < 0.2) return junkString();
    if (roll < 0.4) return junkNumber();
    if (roll < 0.5) return pick([null, undefined, true, false]);
    if (depth > 2) return junkNumber();
    if (roll < 0.7) return Array.from({ length: Math.floor(rng() * 25) }, () => junk(depth + 1));
    const o: Record<string, unknown> = {};
    for (const k of ['t', 'n', 'seed', 'v', 'score', 'pending', 'rows', 'extra', '__proto__', 'constructor']) if (rng() < 0.5) o[k] = k === 't' ? pick(['hello', 'start', 'state', 'attack', 'over', 'ping', 'nope', 7]) : junk(depth + 1);
    return o;
  }

  it('20,000 junk messages: never throws, and anything accepted is well formed and stable', () => {
    let accepted = 0;
    for (let i = 0; i < 20000; i++) {
      const input = junk();
      let m: ReturnType<typeof parseMessage>;
      expect(() => (m = parseMessage(input))).not.toThrow();
      if (!m!) continue;
      accepted++;
      expect(parseMessage(JSON.parse(JSON.stringify(m))), 'an accepted message must survive a trip over the wire unchanged').toEqual(m);
      if (m.t === 'attack') expect(m.n).toBeLessThanOrEqual(MAX_ATTACK);
      if (m.t === 'state') {
        expect(m.rows.length).toBeLessThanOrEqual(MAX_ROWS);
        for (const row of m.rows) expect(row).toMatch(/^[0-467.]{1,10}$/);
      }
    }
    expect(accepted, 'the junk generator should sometimes produce valid messages too').toBeGreaterThan(50);
  });
});
