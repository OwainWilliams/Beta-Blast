// A bot that plays a round the way the game scene does (fixed steps, one recorded move per shot) and returns the
// replay it recorded along with the score the engine reached, so tests can check a replay plays back the same.
import { Engine, MAX_AIM, SPEED } from '../src/game/engine';
import { BOMB, WILD } from '../src/game/grid';
import { LevelSpec, mulberry32 } from '../src/game/levels';
import { Recorder, Replay, STEP } from '../src/game/replay';

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
  return size >= 3 ? 10 * size : -r;
}

export interface Played {
  replay: Replay;
  score: number;
  won: boolean;
  seconds: number;
  ended: boolean;
}

/** `skill` is how often the bot picks the best aim; `think` is the longest it waits before a shot, in seconds. */
export function playBot(level: LevelSpec, seed: number, skill = 0.9, think = 3, maxShots = 500): Played {
  const e = new Engine(level);
  const rec = new Recorder();
  const pick = mulberry32(seed);
  let ended = false;
  let won = false;
  for (let shots = 0; shots < maxShots && !ended; shots++) {
    // aim for a while
    const wait = Math.floor(pick() * think * 120);
    for (let i = 0; i < wait && !ended; i++) {
      if (e.tick(STEP)?.lost) ended = true;
      else rec.aimed();
    }
    if (ended) break;
    if (pick() < 0.2) {
      e.swap();
      rec.swap();
    }
    let aim = (pick() * 2 - 1) * MAX_AIM;
    if (pick() < skill) {
      let best = -Infinity;
      for (const a of ANGLES) {
        const s = scoreShot(e, a) + pick() * 0.5;
        if (s > best) {
          best = s;
          aim = a;
        }
      }
    }
    const a = rec.fire(aim);
    const type = e.shoot();
    const f = e.launch(a);
    let hit = false;
    while (!hit && !ended) {
      if (e.tick(STEP)?.lost) ended = true;
      else hit = e.advance(f, SPEED * STEP);
    }
    if (ended) break;
    const res = e.land(type, f.x, f.y, f.bounces);
    if (!res.placed || res.won || res.lost) {
      ended = true;
      won = res.won;
    }
  }
  if (won) e.finishWin();
  return { replay: { shots: rec.shots, tail: rec.tail, seed: level.survival ? level.seed : undefined }, score: e.score, won, seconds: e.elapsed, ended };
}
