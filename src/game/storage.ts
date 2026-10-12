const KEY = 'beta-blast.v1';
const OLD_KEY = 'crimp-and-pop.v1'; // the game's first name; saves are carried over from it

interface Save {
  best: Record<string, number>;
  bestTime: Record<string, number>; // longest survival, seconds
  sent: Record<string, boolean>;
  muted: boolean;
  shake: boolean;
  music: boolean;
  hints: Record<string, boolean>;
}

function load(): Save {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (raw) return { best: {}, bestTime: {}, sent: {}, muted: false, shake: true, music: true, hints: {}, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { best: {}, bestTime: {}, sent: {}, muted: false, shake: true, music: true, hints: {} };
}

function save(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.removeItem(OLD_KEY); // migrated
  } catch {
    /* storage unavailable */
  }
}

export const getBest = (id: string): number => load().best[id] ?? 0;
export const isSent = (id: string): boolean => !!load().sent[id];
export const isMuted = (): boolean => load().muted;

export function setMuted(muted: boolean): void {
  save({ ...load(), muted });
}

export function recordResult(id: string, score: number, sent: boolean): void {
  const s = load();
  s.best[id] = Math.max(s.best[id] ?? 0, score);
  if (sent) s.sent[id] = true;
  save(s);
}

export const getShake = (): boolean => load().shake;
export function setShake(shake: boolean): void {
  save({ ...load(), shake });
}

export const hintSeen = (id: string): boolean => !!load().hints[id];
export function markHint(id: string): void {
  const s = load();
  s.hints[id] = true;
  save(s);
}

export const getMusic = (): boolean => load().music;
export function setMusic(music: boolean): void {
  save({ ...load(), music });
}

export const getBestTime = (id: string): number => load().bestTime[id] ?? 0;
export function recordTime(id: string, seconds: number): void {
  const s = load();
  s.bestTime[id] = Math.max(s.bestTime[id] ?? 0, Math.round(seconds));
  save(s);
}
