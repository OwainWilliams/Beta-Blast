import type { Progress } from './looks';
import { cleanSave, CloudSave, mergeSaves } from './saveMerge';

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
  name: string; // leaderboard name
  look: string; // climber outfit, as a look code (see looks.ts)
  lookChosen: boolean; // the player picked an outfit themselves, so it is worth keeping in their account
}

function load(): Save {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (raw) return { best: {}, bestTime: {}, sent: {}, muted: false, shake: true, music: true, hints: {}, name: '', look: '000', lookChosen: false, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { best: {}, bestTime: {}, sent: {}, muted: false, shake: true, music: true, hints: {}, name: '', look: '000', lookChosen: false };
}

const changeListeners: (() => void)[] = [];
/** Run `cb` whenever the save changes (the account code uses this to copy it to the cloud). */
export const onSaveChange = (cb: () => void): void => void changeListeners.push(cb);

function save(s: Save, notify = true): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.removeItem(OLD_KEY); // migrated
  } catch {
    /* storage unavailable */
  }
  if (notify) changeListeners.forEach((cb) => cb());
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

/** The leaderboard name: the account's if signed in, otherwise the one typed on this device. */
export const getPlayerName = (): string => getAuth()?.name ?? load().name;
export function setPlayerName(name: string): void {
  save({ ...load(), name }, false);
}

export const getLookCode = (): string => load().look;
export function setLookCode(look: string): void {
  save({ ...load(), look, lookChosen: true });
}

// ---------- the account on this device ----------

const AUTH_KEY = 'beta-blast.auth';
export interface Auth {
  token: string;
  name: string | null; // the account's leaderboard name, once chosen
  provider: 'github' | 'google';
}

export function getAuth(): Auth | null {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as Auth | null;
    return a && typeof a.token === 'string' && (a.provider === 'github' || a.provider === 'google') ? a : null;
  } catch {
    return null;
  }
}
export function setAuth(auth: Auth | null): void {
  try {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* storage unavailable */
  }
}

// ---------- the part of the save that follows an account ----------

export function getCloudSave(): CloudSave {
  const s = load();
  return cleanSave({ best: s.best, bestTime: s.bestTime, sent: s.sent, hints: s.hints, look: s.lookChosen ? s.look : undefined });
}

/**
 * Fold the account's copy into this device's save (higher scores, grades sent, seen tips from both).
 * The account's outfit wins if it has one. Returns what the save now holds. Doesn't count as a change to sync.
 */
export function mergeCloudSave(remote: CloudSave): CloudSave {
  const s = load();
  const merged = mergeSaves(getCloudSave(), remote, 'b');
  save({ ...s, best: merged.best, bestTime: merged.bestTime, sent: merged.sent, hints: merged.hints, look: merged.look ?? s.look, lookChosen: s.lookChosen || !!merged.look }, false);
  return getCloudSave();
}

/** What the player has achieved so far, for unlocking climber outfits. */
export function getProgress(): Progress {
  const s = load();
  const sentIds = Object.keys(s.sent).filter((id) => s.sent[id]);
  const grades = sentIds.filter((id) => /^v\d+$/.test(id)).map((id) => Number(id.slice(1)));
  return {
    gradesSent: grades.length,
    topGrade: grades.length ? Math.max(...grades) : -1,
    dailiesSent: sentIds.filter((id) => id.startsWith('daily-')).length,
    survivalSeconds: s.bestTime.survival ?? 0,
    bestScore: Math.max(0, ...Object.values(s.best)),
  };
}
