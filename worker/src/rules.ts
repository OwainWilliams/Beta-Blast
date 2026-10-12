// What the leaderboard accepts. Pure functions, so they are tested without a database.
// Scores are sent from the player's browser, so none of this can stop a determined cheater; it keeps out
// junk, silly numbers and rude names.

export const MAX_NAME = 12;
export const MAX_SCORE = 500_000;
export const MAX_SURVIVAL_SCORE = 2_000_000;
export const MAX_SECONDS = 6 * 60 * 60;
export const POSTS_PER_MINUTE = 10;
export const BOARD_SIZE = 10;

const BOARD = /^(v\d{1,3}|survival|daily-\d{4}-\d{2}-\d{2})$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/;
// Whole-word and substring checks on a squashed copy of the name ("f.u c k" still matches).
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'rape', 'nazi', 'bitch', 'whore', 'slut', 'dick', 'cock', 'twat', 'wank'];

export const isBoard = (b: unknown): b is string => typeof b === 'string' && BOARD.test(b);

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > MAX_NAME || !NAME.test(name)) return null;
  const squashed = name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's');
  return BLOCKED.some((w) => squashed.includes(w)) ? null : name;
}

export interface Submission {
  board: string;
  name: string;
  score: number;
  seconds: number;
}

/** Check a posted body. Returns the cleaned submission, or the reason it was refused. */
export function parseSubmission(body: unknown): Submission | string {
  if (typeof body !== 'object' || body === null) return 'Bad request';
  const b = body as Record<string, unknown>;
  if (!isBoard(b.board)) return 'Unknown board';
  const name = cleanName(b.name);
  if (!name) return 'That name is not allowed. Use 1 to 12 letters, numbers, spaces, . _ -';
  const max = b.board === 'survival' ? MAX_SURVIVAL_SCORE : MAX_SCORE;
  if (!Number.isInteger(b.score) || (b.score as number) < 1 || (b.score as number) > max) return 'Score out of range';
  const seconds = b.seconds ?? 0;
  if (!Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > MAX_SECONDS) return 'Time out of range';
  if (b.board !== 'survival' && seconds !== 0) return 'Only survival has a time';
  return { board: b.board, name, score: b.score as number, seconds: seconds as number };
}

export function allowedOrigin(origin: string | null, list: string): string | null {
  if (!origin) return null;
  return list.split(',').map((s) => s.trim()).includes(origin) ? origin : null;
}
