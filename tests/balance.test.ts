// Opt-in difficulty report:  npm run balance
// A greedy bot plays every grade. `skill` is how often it picks the best shot
// instead of a random one, a rough stand-in for human mistakes.
import { describe, expect, it } from 'vitest';
import { Engine, MAX_AIM } from '../src/game/engine';
import { BOMB, WILD } from '../src/game/grid';
import { gradeLevel, mulberry32 } from '../src/game/levels';

// How long one shot takes a decent player: aim, fly, land, think. The row timer runs on this clock.
const SHOT_SECONDS = Number(process.env.SHOT_SECONDS ?? 2.2);
const TOP_GRADE = Number(process.env.TOP_GRADE ?? 20);

const ANGLES = Array.from({ length: 27 }, (_, i) => -1.3 + i * 0.1);

function scoreShot(e: Engine, aim: number): number {
  const { end } = e.trace(aim, 12, false);
  const cell = e.preview(end.x, end.y);
  if (!cell) return -100;
  const [r, c] = cell;
  const type = e.cur === WILD ? e.resolveWild(cell) : e.cur;
  e.grid.set(r, c, { type });
  const size = e.cur === BOMB ? e.grid.blast(r, c).length : e.grid.findMatches(r, c).length;
  e.grid.set(r, c, null);
  return size >= 3 ? 10 * size : -r; // prefer popping, otherwise stay high
}

function play(grade: number, seed: number, skill: number) {
  const e = new Engine({ ...gradeLevel(grade), seed });
  const pick = mulberry32(seed ^ 0x9e3779b9);
  for (let shots = 1; shots <= 300; shots++) {
    let aim: number;
    if (pick() < skill) {
      let best = -Infinity;
      aim = 0;
      for (const a of ANGLES) {
        const s = scoreShot(e, a) + pick() * 0.5;
        if (s > best) {
          best = s;
          aim = a;
        }
      }
    } else {
      aim = (pick() * 2 - 1) * MAX_AIM;
    }
    const timed = e.tick(SHOT_SECONDS);
    if (timed?.lost) return { won: false, shots, drops: e.drops };
    const { end } = e.trace(aim, 12, false);
    const res = e.land(e.shoot(), end.x, end.y, end.bounces);
    if (res.won) return { won: true, shots, drops: e.drops };
    if (res.lost) return { won: false, shots, drops: e.drops };
  }
  return { won: false, shots: 300, drops: e.drops };
}

describe.skipIf(!process.env.BALANCE)('balance', () => {
  it('reports win rate per grade', () => {
    const GAMES = Number(process.env.GAMES ?? 12);
    const lines = ['grade  skill  win%  avg shots  avg pumps'];
    for (const skill of [0.6, 0.85]) {
      for (let g = 0; g <= TOP_GRADE; g++) {
        const results = Array.from({ length: GAMES }, (_, i) => play(g, 1000 + i * 17 + g, skill));
        const wins = results.filter((r) => r.won).length;
        const avg = (f: (r: (typeof results)[number]) => number) => (results.reduce((a, r) => a + f(r), 0) / GAMES).toFixed(1);
        lines.push(`V${String(g).padEnd(4)} ${String(skill).padEnd(6)} ${String(Math.round((100 * wins) / GAMES)).padStart(3)}%  ${avg((r) => r.shots).padStart(9)}  ${avg((r) => r.drops).padStart(9)}`);
      }
    }
    console.log('\n' + lines.join('\n'));
    expect(lines.length).toBeGreaterThan(1);
  }, 600000);
});
