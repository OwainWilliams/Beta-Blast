// Talks to the leaderboard API. Every call fails quietly (returns null), so the game plays on without it.
import { API_URL } from '../config';
import { dateKey, dailyLevel } from './levels';

export interface Entry {
  name: string;
  score: number;
  seconds: number;
}

export const MAX_NAME = 12;
const TIMEOUT_MS = 6000;

/** The board for a level, or null if it has none (custom routes and two-player matches). */
export function boardFor(level: { id: string; custom?: boolean; versus?: boolean }): string | null {
  return level.custom || level.versus ? null : level.id;
}

export const todaysBoard = (): string => dailyLevel().id;
/** "V3", "Survival", "Daily Boulder" for a board id. */
export function boardTitle(board: string): string {
  if (board === 'survival') return 'Survival';
  if (board.startsWith('daily-')) return board === `daily-${dateKey()}` ? 'Daily Boulder' : `Daily ${board.slice(6)}`;
  return board.toUpperCase();
}

/** Letters, numbers, spaces and . _ - only, at most 12 characters. Returns null if nothing usable is left. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return /^[A-Za-z0-9]/.test(name) ? name : null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T | { error: string } | null> {
  if (!API_URL) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal: ctl.signal });
    const data = await res.json().catch(() => null);
    if (res.ok) return data as T;
    return { error: typeof data?.error === 'string' ? data.error : 'Leaderboard unavailable' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTop(board: string): Promise<Entry[] | null> {
  const data = await call<{ scores: Entry[] }>(`/scores?board=${encodeURIComponent(board)}`);
  return data && 'scores' in data && Array.isArray(data.scores) ? data.scores : null;
}

/** Post a score. Resolves to a message for the player; the rank is included when the score went in. */
export async function postScore(board: string, name: string, score: number, seconds = 0): Promise<{ ok: boolean; message: string }> {
  const data = await call<{ rank: number; best: number }>('/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board, name, score, seconds: board === 'survival' ? Math.round(seconds) : 0 }),
  });
  if (!data) return { ok: false, message: "Couldn't reach the leaderboard" };
  if ('error' in data) return { ok: false, message: data.error };
  return { ok: true, message: score >= data.best ? `Leaderboard rank #${data.rank}` : `Your best here is ${data.best} (rank #${data.rank})` };
}
