// Recording a round and playing it back, for the leaderboard's anti-cheat.
//
// The game logs what the player did: how long they waited before each shot, whether the loaded hold was
// swapped, and the aim. The Worker replays that through the same Engine and works out the score itself,
// so a score can only be posted by someone who played a real, legal game (or wrote a bot that does).
//
// For a replay to give the same game every time, the engine is stepped in fixed slices of STEP seconds
// (the scene does this in update()) instead of by however long each frame happened to take.
import { Engine, SPEED } from './engine';
import { dailyLevel, gradeLevel, LevelSpec, survivalLevel } from './levels';

export const STEP = 1 / 120;
export const MAX_AIM_MILLI = 1350; // MAX_AIM in thousandths of a radian
export const MAX_SHOTS = 600;
export const MAX_STEPS = 600_000; // 83 minutes of play; keeps the Worker's work bounded
const MAX_FLIGHT_STEPS = 2000; // a shot takes about 40 steps; this only stops a runaway

/** One shot: steps of aiming before it, whether the loaded and next holds were swapped, the aim in milliradians. */
export type Shot = [wait: number, swapped: 0 | 1, aim: number];

export interface Replay {
  seed?: number; // survival only: its walls are random
  shots: Shot[];
  tail: number; // steps spent aiming after the last shot, before the row timer ended the round (0 if the last shot did)
}

export const toMilli = (aim: number): number => Math.max(-MAX_AIM_MILLI, Math.min(MAX_AIM_MILLI, Math.round(aim * 1000)));

/** Collects the shots of a round as it is played. */
export class Recorder {
  readonly shots: Shot[] = [];
  private wait = 0;
  /** Steps of aiming since the last shot. When the round ends while aiming this is the replay's tail. */
  get tail(): number {
    return this.wait;
  }
  private swapped: 0 | 1 = 0;

  /** One fixed step of aiming went by. */
  aimed(): void {
    this.wait++;
  }
  swap(): void {
    this.swapped = this.swapped ? 0 : 1;
  }
  /** Log a shot and return the aim, rounded the way a replay will see it. */
  fire(aim: number): number {
    const milli = toMilli(aim);
    this.shots.push([this.wait, this.swapped, milli]);
    this.wait = 0;
    this.swapped = 0;
    return milli / 1000;
  }
}

export interface Outcome {
  ok: boolean;
  reason?: string;
  won: boolean;
  score: number;
  seconds: number; // survival time
}

const bad = (reason: string): Outcome => ({ ok: false, reason, won: false, score: 0, seconds: 0 });

/** Play a recorded round through a fresh engine. It must reach the end (sent or fell) to count. */
export function playReplay(level: LevelSpec, replay: Replay): Outcome {
  const e = new Engine(level);
  let steps = 0;
  let ended = false; // set once the round is over; nothing may follow
  let won = false;

  /** Aim for `n` steps. Stops early if the row timer drops the wall to the bottom. */
  const aimFor = (n: number): boolean => {
    for (let i = 0; i < n; i++) {
      steps++;
      if (e.tick(STEP)?.lost) {
        ended = true;
        return false;
      }
    }
    return true;
  };

  for (const [wait, swapped, milli] of replay.shots) {
    if (ended) return bad('Shots after the game ended');
    if (steps + wait > MAX_STEPS) return bad('Run too long');
    if (!aimFor(wait)) return bad('Shots after the game ended'); // fell while aiming, yet a shot followed
    if (swapped) e.swap();
    const type = e.shoot();
    const f = e.launch(milli / 1000);
    let hit = false;
    for (let n = 0; !hit && !ended; n++) {
      if (n > MAX_FLIGHT_STEPS) return bad('Shot never landed');
      steps++;
      if (e.tick(STEP)?.lost) ended = true;
      else hit = e.advance(f, SPEED * STEP);
    }
    if (steps > MAX_STEPS) return bad('Run too long');
    if (!ended) {
      const res = e.land(type, f.x, f.y, f.bounces);
      if (!res.placed || res.won || res.lost) {
        ended = true;
        won = res.won;
      }
    }
  }
  if (!ended) {
    if (steps + replay.tail > MAX_STEPS) return bad('Run too long');
    // the wall may have dropped to the bottom while the player was still aiming: `tail` quiet steps, then the one that did it
    if (!aimFor(replay.tail) || e.tick(STEP)?.lost !== true) return bad('The run did not finish');
    steps++;
    ended = true;
  } else if (replay.tail !== 0) return bad('Time after the game ended');
  if (!ended) return bad('The run did not finish');
  if (won) e.finishWin();
  return { ok: true, won, score: e.score, seconds: e.elapsed };
}

// Cheap limits for when the Worker can't afford to replay a run (see worker/src/index.ts). They are set well
// beyond what real play reaches: the best greedy bot averages about 315 points a shot, and no shot flies
// longer than about 260 steps. They stop crude fakes, not a careful forgery.
export const SCORE_BASE = 8000; // room for one huge drop
export const SCORE_PER_SHOT = 800;
export const FLIGHT_MIN_STEPS = 3;
export const FLIGHT_MAX_STEPS = 600;

/** Is a claimed score (and survival time) believable for a replay of this length? Null if so, else why not. */
export function plausible(board: string, replay: Replay, score: number, seconds: number): string | null {
  const shots = replay.shots.length;
  if (!Number.isInteger(score) || score < 1) return 'No score to post';
  if (score > SCORE_BASE + SCORE_PER_SHOT * shots) return 'That score is too high for the moves played';
  if (board !== 'survival') return seconds === 0 ? null : 'Only survival has a time';
  if (!Number.isInteger(seconds) || seconds < 1) return 'Bad time';
  const aiming = replay.tail + replay.shots.reduce((sum, s) => sum + s[0], 0);
  const steps = seconds * 120;
  const slack = 60; // the time is rounded to a second
  if (steps < aiming + FLIGHT_MIN_STEPS * shots - slack || steps > aiming + FLIGHT_MAX_STEPS * shots + slack) return 'That time does not match the moves played';
  return null;
}

const BOARD = /^(?:v(\d{1,3})|survival|daily-(\d{4})-(\d{2})-(\d{2}))$/;

/** The level a leaderboard board is played on, or null if the board or the replay's seed makes no sense. */
export function levelForBoard(board: string, replay: Replay, now = Date.now()): LevelSpec | null {
  const m = BOARD.exec(board);
  if (!m) return null;
  if (m[1] !== undefined) return gradeLevel(Number(m[1]));
  if (board === 'survival') {
    const seed = replay.seed;
    return Number.isInteger(seed) && seed! >= 0 && seed! < 2 ** 31 ? survivalLevel(seed) : null;
  }
  // a Daily board must be for about today, so old or future days can't be farmed
  const day = Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]));
  if (!Number.isFinite(day) || Math.abs(day - (Math.floor(now / 86_400_000) * 86_400_000)) > 2 * 86_400_000) return null;
  return dailyLevel(new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4])));
}

/** Check a replay's shape: numbers in range, not too long. Returns it cleaned, or the reason it was refused. */
export function parseReplay(raw: unknown): Replay | string {
  if (typeof raw !== 'object' || raw === null) return 'Missing replay';
  const r = raw as { seed?: unknown; shots?: unknown; tail?: unknown };
  if (!Number.isInteger(r.tail) || (r.tail as number) < 0 || (r.tail as number) > MAX_STEPS) return 'Bad replay';
  if (!Array.isArray(r.shots) || r.shots.length > MAX_SHOTS) return 'Bad replay';
  const shots: Shot[] = [];
  for (const s of r.shots) {
    if (!Array.isArray(s) || s.length !== 3) return 'Bad replay';
    const [wait, swapped, aim] = s;
    if (!Number.isInteger(wait) || wait < 0 || wait > MAX_STEPS) return 'Bad replay';
    if (swapped !== 0 && swapped !== 1) return 'Bad replay';
    if (!Number.isInteger(aim) || Math.abs(aim) > MAX_AIM_MILLI) return 'Bad replay';
    shots.push([wait, swapped, aim]);
  }
  if (r.seed !== undefined && !Number.isInteger(r.seed)) return 'Bad replay';
  return { seed: r.seed as number | undefined, shots, tail: r.tail as number };
}
