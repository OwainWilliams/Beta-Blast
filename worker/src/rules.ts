// What the leaderboard accepts. Pure functions, so they are tested without a database.
// A post carries the player's moves along with the score. Normally the Worker only checks the score is
// believable for those moves (plausible() in src/game/replay.ts). With VERIFY_REPLAYS=1 it replays the moves
// through the game's own engine and uses the score that comes out, so only a legal game can be posted.
import { decodeLook } from '../../src/game/looks';
import { parseReplay, Replay } from '../../src/game/replay';

export const MAX_NAME = 12;
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
  replay: Replay;
  score: number; // what the game says it reached; the Worker checks it, or replaces it with its own replay's
  seconds: number; // survival only
  look?: string; // the player's climber outfit, as a look code
}

/** Check a posted body. Returns the cleaned submission, or the reason it was refused. */
export function parseSubmission(body: unknown): Submission | string {
  if (typeof body !== 'object' || body === null) return 'Bad request';
  const b = body as Record<string, unknown>;
  if ('score' in b && !('replay' in b)) return 'This version of the game is out of date. Reload the page and play again.';
  if (!isBoard(b.board)) return 'Unknown board';
  const name = cleanName(b.name);
  if (!name) return 'That name is not allowed. Use 1 to 12 letters, numbers, spaces, . _ -';
  const replay = parseReplay(b.replay);
  if (typeof replay === 'string') return replay;
  const { score, seconds = 0 } = b;
  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 1e9) return 'Score out of range';
  if (!Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > 86_400) return 'Time out of range';
  if (b.look !== undefined && !decodeLook(b.look)) return 'Bad look';
  return { board: b.board, name, replay, score: score as number, seconds: seconds as number, look: b.look as string | undefined };
}

export function allowedOrigin(origin: string | null, list: string): string | null {
  if (!origin) return null;
  return list.split(',').map((s) => s.trim()).includes(origin) ? origin : null;
}
