// The part of a player's save that follows their account, and how two copies of it are merged. Pure, so the game
// and the Worker apply exactly the same rules: the higher score wins, sent grades and seen tips are kept from
// both, so signing in on a second device never loses progress.
import { isBoard } from './boards';
import { decodeLook } from './looks';

export interface CloudSave {
  best: Record<string, number>; // best score per board
  bestTime: Record<string, number>; // longest survival run, seconds
  sent: Record<string, boolean>;
  hints: Record<string, boolean>; // tips already seen
  look?: string; // climber outfit
}

export const EMPTY_SAVE: CloudSave = { best: {}, bestTime: {}, sent: {}, hints: {} };
export const MAX_ENTRIES = 400;
export const MAX_SAVE_BYTES = 24_000;
const HINT = /^[a-z][a-z0-9_-]{0,23}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function numbers(raw: unknown, key: (k: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    if (key(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e9) out[k] = v as number;
  }
  return out;
}
function flags(raw: unknown, key: (k: string) => boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    if (key(k) && v === true) out[k] = true;
  }
  return out;
}

/** Keep only what belongs in a cloud save: known boards, sane numbers, a valid look. Anything else is dropped. */
export function cleanSave(raw: unknown): CloudSave {
  const o = isObject(raw) ? raw : {};
  const save: CloudSave = {
    best: numbers(o.best, isBoard),
    bestTime: numbers(o.bestTime, isBoard),
    sent: flags(o.sent, isBoard),
    hints: flags(o.hints, (k) => HINT.test(k)),
  };
  if (typeof o.look === 'string' && decodeLook(o.look)) save.look = o.look;
  return save;
}

const maxOf = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
};

/** Combine two saves. `lookFrom` says whose outfit wins when both have one. */
export function mergeSaves(a: CloudSave, b: CloudSave, lookFrom: 'a' | 'b'): CloudSave {
  const first = lookFrom === 'a' ? a : b;
  const second = lookFrom === 'a' ? b : a;
  const merged: CloudSave = {
    best: maxOf(a.best, b.best),
    bestTime: maxOf(a.bestTime, b.bestTime),
    sent: { ...a.sent, ...b.sent },
    hints: { ...a.hints, ...b.hints },
  };
  const look = first.look ?? second.look;
  if (look) merged.look = look;
  return merged;
}

/** Is `a` already everything `b` has? Used to skip pointless uploads. */
export const sameSave = (a: CloudSave, b: CloudSave): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

function sortKeys<T>(v: T): T {
  if (!isObject(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) as T;
}
