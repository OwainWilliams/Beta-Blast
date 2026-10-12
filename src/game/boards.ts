// Leaderboard board ids ("v3", "survival", "daily-2026-10-12") and their names. Pure, so the game, the Worker
// and the embed script all agree.
import { dailyLevel, dateKey } from './levels';

export type BoardKind = 'grade' | 'survival' | 'daily';

const BOARD = /^(v\d{1,3}|survival|daily-\d{4}-\d{2}-\d{2})$/;
export const isBoard = (b: unknown): b is string => typeof b === 'string' && BOARD.test(b);

export function boardKind(board: string): BoardKind {
  return board === 'survival' ? 'survival' : board.startsWith('daily-') ? 'daily' : 'grade';
}

/** The Daily board for the player's own calendar day. */
export const todaysBoard = (): string => dailyLevel().id;

/** "V3", "Survival", "Daily Boulder" (or "Daily 2026-10-12" for another day) for a board id. */
export function boardTitle(board: string, today = dateKey()): string {
  if (board === 'survival') return 'Survival';
  if (board.startsWith('daily-')) return board === `daily-${today}` ? 'Daily Boulder' : `Daily ${board.slice(6)}`;
  return board.toUpperCase();
}
