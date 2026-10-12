export interface LevelSpec {
  id: string;
  label: string;
  grade: number; // V-grade, 0-10
  seed: number;
  colours: number;
  rows: number;
  shotsPerDrop: number; // misses before the wall drops a row ("pump")
  dropInterval?: number; // seconds between timed rows; 0 or missing = no timer
  bombs: boolean;
  wilds?: boolean; // mega jug shots
  volumeRate?: number; // chance a generated cell is a volume
  slickRate?: number; // chance a generated cell is a slick hold
  daily?: boolean;
  versus?: boolean; // two players: pops send rows to the opponent
  shared?: boolean; // both players get the same stream of holds
  survival?: boolean; // no win: the wall keeps coming and the score is how long you last
  custom?: boolean;
  layout?: number[][]; // hand-built route: hold type per cell, -1 = empty
  code?: string; // share code for a custom route
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Misses allowed before the wall drops a row, per grade. Tuned with `npm run balance`.
const PUMP_LIMIT = [8, 8, 7, 7, 7, 7, 6, 6, 5, 5, 4];

/** Seconds between timed rows. Starts relaxed and tightens by 7% a grade down to a floor. */
export const dropIntervalFor = (grade: number): number => Math.max(20, 90 * 0.93 ** grade);

/**
 * Grades never run out. Difficulty ramps up through V10 as tuned, then keeps tightening
 * (more obstacles, faster rows) until it levels off around V25 at hard-but-winnable.
 */
export function gradeLevel(grade: number, seed = 1000 + grade * 7919): LevelSpec {
  const late = Math.max(0, grade - 10); // grades past V10
  return {
    id: `v${grade}`,
    label: `V${grade}`,
    grade,
    seed,
    colours: grade < 2 ? 3 : grade < 6 ? 4 : 5,
    rows: 4 + Math.min(grade, 6),
    shotsPerDrop: grade <= 10 ? PUMP_LIMIT[grade] : 4,
    dropInterval: dropIntervalFor(grade),
    bombs: grade >= 2,
    wilds: grade >= 1,
    volumeRate: grade >= 4 ? Math.min(0.16, grade <= 10 ? Math.min(0.12, 0.025 * (grade - 3)) : 0.12 + 0.008 * late) : 0,
    slickRate: grade >= 7 ? Math.min(0.1, grade <= 10 ? Math.min(0.08, 0.02 * (grade - 6)) : 0.08 + 0.005 * late) : 0,
  };
}

export function dateKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Same route for everyone on a given day. */
export function dailyLevel(date = new Date()): LevelSpec {
  const key = dateKey(date);
  const seed = hashString(key);
  const grade = 3 + (seed % 5);
  return { ...gradeLevel(grade, seed), id: `daily-${key}`, label: 'Daily Boulder', daily: true };
}

/** The endless mode. A fresh seed each run, so no two runs start on the same wall. */
export function survivalLevel(seed = Math.floor(Math.random() * 2 ** 31)): LevelSpec {
  return {
    id: 'survival',
    label: 'Survival',
    grade: 0,
    seed,
    colours: 3,
    rows: 4,
    shotsPerDrop: 6,
    dropInterval: SURVIVAL_START_INTERVAL,
    bombs: true,
    wilds: true,
    volumeRate: 0,
    slickRate: 0,
    survival: true,
  };
}

// Survival pacing. Every STAGE_SECONDS the stage goes up: rows come faster, then new colours and obstacles join.
export const SURVIVAL_STAGE_SECONDS = 40;
export const SURVIVAL_START_INTERVAL = 11;
export const SURVIVAL_MIN_INTERVAL = 4.5;
export const survivalStage = (elapsed: number): number => 1 + Math.floor(elapsed / SURVIVAL_STAGE_SECONDS);
export const survivalInterval = (stage: number): number => Math.max(SURVIVAL_MIN_INTERVAL, SURVIVAL_START_INTERVAL * 0.95 ** (stage - 1));
export const survivalColours = (stage: number): number => Math.min(5, 3 + Math.floor((stage - 1) / 2));
export const survivalVolumeRate = (stage: number): number => (stage >= 4 ? Math.min(0.12, 0.03 * (stage - 3)) : 0);
export const survivalSlickRate = (stage: number): number => (stage >= 6 ? Math.min(0.08, 0.02 * (stage - 5)) : 0);

/** The two-player mode. Both players build the level from the same seed, so they start on the same wall with the same holds. */
export function versusLevel(seed: number): LevelSpec {
  return {
    id: 'versus',
    label: 'Versus',
    grade: 3,
    seed,
    colours: 4,
    rows: 5,
    shotsPerDrop: 7,
    dropInterval: 0,
    bombs: true,
    wilds: true,
    volumeRate: 0,
    slickRate: 0,
    versus: true,
    shared: true,
  };
}

// Speed bonus, for sending a route. The row timer keeps adding holds, so a slow game has more to pop and used to
// score more than a fast one: each extra second was worth roughly 8 to 16 points of popping. The bonus pays that
// back and more: every second under a par time is worth a set number of points. (On bot play the faster of two
// clears now scores higher 66 to 87% of the time, up from about half; layout and big drops still add variety.)
// Both the rate and the par time grow with the grade, as harder walls are bigger and take longer.
export const speedPointsPerSecond = (grade: number): number => 12 + 2 * Math.min(grade, 12);
export const speedBonusSeconds = (grade: number): number => 120 + 20 * Math.min(grade, 12);
/** The most a send can earn for speed (a send in no time at all). */
export const speedBonusMax = (grade: number): number => Math.round(speedPointsPerSecond(grade) * speedBonusSeconds(grade));
/** Points for sending a grade's route in `seconds` of aiming and flying (time spent paused or watching doesn't count). */
export const speedBonus = (grade: number, seconds: number): number => Math.round(speedPointsPerSecond(grade) * Math.max(0, speedBonusSeconds(grade) - seconds));
