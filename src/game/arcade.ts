// Arcade mode: Survival with a weekly high-score table of three-character initials, like an old cabinet.
// Pure, so the game, the Worker and the tests agree on the week, the characters and what makes the table.
import { survivalLevel, LevelSpec } from './levels';

export const ARCADE = 'arcade';
export const ARCADE_SIZE = 10;
export const INITIALS = 3;
/** The characters the name entry scrolls through, in order. */
export const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** An Arcade run is a Survival run with its own table. */
export const arcadeLevel = (seed?: number): LevelSpec => ({ ...survivalLevel(seed), id: ARCADE, label: 'Arcade', arcade: true });

const ARCADE_BOARD = /^arcade-(\d{4})-(\d{2})-(\d{2})$/;
export const isArcadeBoard = (b: unknown): b is string => typeof b === 'string' && ARCADE_BOARD.test(b) && !Number.isNaN(Date.parse(b.slice(7)));

/** The Monday (UTC) that starts the week `now` is in, as YYYY-MM-DD. Everyone, whatever their time zone, shares a week. */
export function arcadeWeek(now = Date.now()): string {
  const d = new Date(now);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday)).toISOString().slice(0, 10);
}
export const arcadeBoard = (now = Date.now()): string => `arcade-${arcadeWeek(now)}`;

/** When the table next clears (the next Monday, 00:00 UTC). */
export const nextReset = (now = Date.now()): number => Date.parse(arcadeWeek(now)) + 7 * 86_400_000;

/** "2 days", "5 hours" or "40 minutes" until the table clears. */
export function resetsIn(now = Date.now()): string {
  const mins = Math.max(1, Math.ceil((nextReset(now) - now) / 60_000));
  if (mins >= 2880) return `${Math.floor(mins / 1440)} days`;
  if (mins >= 120) return `${Math.floor(mins / 60)} hours`;
  return `${mins} minutes`;
}

// Three letters are easy to make rude. Anything here is refused, in the game and again by the Worker.
const BLOCKED = ['ASS', 'FAG', 'FUK', 'FCK', 'SHT', 'CUM', 'TIT', 'DIK', 'KKK', 'NIG', 'SEX', 'GAY', 'JEW', 'NZI', 'WNK', 'CNT', 'TWT'];

/** Three letters or numbers, upper-cased. Null if it isn't that, or isn't allowed. */
export function cleanInitials(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{${INITIALS}}$`).test(s)) return null;
  return BLOCKED.includes(s) ? null : s;
}

/** The next character up (dir 1) or down (-1) the list, wrapping round at either end. */
export function stepChar(c: string, dir: 1 | -1): string {
  const i = CHARS.indexOf(c);
  return CHARS[((i < 0 ? 0 : i) + dir + CHARS.length) % CHARS.length];
}

/** Does `score` earn a place in a table whose current entries (best first) are `scores`? */
export const makesTable = (scores: { score: number }[], score: number): boolean =>
  score > 0 && (scores.length < ARCADE_SIZE || score > scores[ARCADE_SIZE - 1].score);
