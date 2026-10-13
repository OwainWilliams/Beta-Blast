// Talks to the leaderboard API. Every call fails quietly (returns null), so the game plays on without it.
import { API_URL } from '../config';
import { expireSession } from './account';
import { getAuth } from './storage';
export { boardTitle, todaysBoard } from './boards';
import type { Replay } from './replay';

export interface Entry {
  name: string;
  score: number;
  seconds: number;
  look: string; // climber outfit code; '' if they haven't picked one
  verified?: boolean; // the name belongs to a signed-in player
}

export const MAX_NAME = 12;

let lastBoard: string | null = null;
/** The board of the round just played, so the Leaderboard screen opens on it. */
export const rememberBoard = (board: string): void => void (lastBoard = board);
export const lastPlayedBoard = (): string | null => lastBoard;
const TIMEOUT_MS = 6000;

/** The board for a level, or null if it has none here (custom routes and two-player matches; Arcade has its own). */
export function boardFor(level: { id: string; custom?: boolean; versus?: boolean; arcade?: boolean }): string | null {
  return level.custom || level.versus || level.arcade ? null : level.id; // Arcade has its own table (fetchArcade / postArcade)
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
    const token = getAuth()?.token;
    const res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...init?.headers, ...(token && init?.method === 'POST' ? { Authorization: `Bearer ${token}` } : {}) }, signal: ctl.signal });
    const data = await res.json().catch(() => null);
    if (res.ok) return data as T;
    if (res.status === 401 && token) expireSession();
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

/** Post a finished round with the moves that made it, so the server can check the score is believable. */
export async function postScore(board: string, name: string, score: number, seconds: number, look: string, replay: Replay): Promise<{ ok: boolean; message: string }> {
  const data = await call<{ rank: number; best: number; score: number }>('/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board, name, score, seconds: board === 'survival' ? Math.round(seconds) : 0, look, replay }),
  });
  if (!data) return { ok: false, message: "Couldn't reach the leaderboard" };
  if ('error' in data) return { ok: false, message: data.error };
  return { ok: true, message: data.score >= data.best ? `Leaderboard rank #${data.rank}` : `Your best here is ${data.best} (rank #${data.rank})` };
}

/** This week's Arcade table (three-character initials, top 10), or null if the leaderboard can't be reached. */
export async function fetchArcade(): Promise<Entry[] | null> {
  const data = await call<{ scores: Entry[] }>('/arcade');
  return data && 'scores' in data && Array.isArray(data.scores) ? data.scores : null;
}

let lastArcade: { initials: string; score: number } | null = null;
/** The run just entered, so the Arcade table can highlight it. */
export const lastArcadeRun = (): { initials: string; score: number } | null => lastArcade;

/** Post an Arcade run under three-character initials, with its moves so the server can check the score. */
export async function postArcade(initials: string, score: number, seconds: number, replay: Replay): Promise<{ ok: boolean; message: string }> {
  const data = await call<{ qualified: boolean; rank: number | null }>('/arcade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initials, score, seconds: Math.max(1, Math.round(seconds)), replay }),
  });
  if (!data) return { ok: false, message: "Couldn't reach the leaderboard" };
  if ('error' in data) return { ok: false, message: data.error };
  if (!data.qualified) return { ok: false, message: "Someone just beat that. You didn't make the top 10" };
  lastArcade = { initials, score };
  return { ok: true, message: `Rank #${data.rank}` };
}
