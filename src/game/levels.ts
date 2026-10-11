export interface LevelSpec {
  id: string;
  label: string;
  grade: number; // V-grade, 0-10
  seed: number;
  colours: number;
  rows: number;
  shotsPerDrop: number; // misses before the wall drops a row ("pump")
  bombs: boolean;
  daily?: boolean;
}

export const MAX_GRADE = 10;

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gradeLevel(grade: number, seed = 1000 + grade * 7919): LevelSpec {
  return {
    id: `v${grade}`,
    label: `V${grade}`,
    grade,
    seed,
    colours: grade < 2 ? 3 : grade < 5 ? 4 : 5,
    rows: 4 + Math.min(grade, 6),
    shotsPerDrop: Math.max(4, 8 - Math.floor(grade / 2)),
    bombs: grade >= 2,
  };
}

export function dateKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Same route for everyone on a given day. */
export function dailyLevel(date = new Date()): LevelSpec {
  const key = dateKey(date);
  const seed = hash(key);
  const grade = 3 + (seed % 5);
  return { ...gradeLevel(grade, seed), id: `daily-${key}`, label: 'Daily Boulder', daily: true };
}
