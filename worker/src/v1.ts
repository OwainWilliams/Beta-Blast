// The public, read-only side of the API (version 1). Anyone may call it from anywhere, so it only ever returns
// what the leaderboard already shows: names, scores, times and climber outfits.
import { boardKind, boardTitle, isBoard, OVERALL } from '../../src/game/boards';
import { colourOf, DEFAULT_LOOK, decodeLook, SLOTS } from '../../src/game/looks';
import type { D1 } from './db';
import { overallSummary, topScores } from './leaders';
import { BOARD_SIZE, cleanName } from './rules';

export const ENDPOINTS = [
  'GET /v1/boards',
  'GET /v1/boards/{board}?limit=10',
  'GET /v1/players/{name}',
];

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The colours of a look code, as CSS hex, so a website can draw the climber without knowing the palette. */
export function outfitOf(code: string): Record<'beanie' | 'shirt' | 'bag', string> {
  const look = decodeLook(code) ?? DEFAULT_LOOK;
  return Object.fromEntries(SLOTS.map((s) => [s, hex(colourOf(s, look))])) as Record<'beanie' | 'shirt' | 'bag', string>;
}

/** UTC calendar day, as the Daily boards are named. */
export const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

export interface BoardInfo {
  id: string;
  title: string;
  kind: string;
  entries: number;
  topScore: number;
}

export async function listBoards(db: D1, now = Date.now()) {
  const { results } = await db
    .prepare('SELECT board, COUNT(*) AS entries, MAX(score) AS top FROM scores GROUP BY board ORDER BY board LIMIT 300')
    .all<{ board: string; entries: number; top: number }>();
  const today = utcDay(now);
  const boards: BoardInfo[] = results.map((r) => ({ id: r.board, title: boardTitle(r.board, today), kind: boardKind(r.board), entries: r.entries, topScore: r.top }));
  const overall = await overallSummary(db);
  if (overall.entries) boards.push({ id: OVERALL, title: boardTitle(OVERALL), kind: 'overall', entries: overall.entries, topScore: overall.top });
  // the overall ranking first, then grades in order, then survival, then the Dailies newest first
  const rank = (b: BoardInfo) => (b.kind === 'overall' ? -1 : b.kind === 'grade' ? 0 : b.kind === 'survival' ? 1 : 2);
  boards.sort((a, b) => rank(a) - rank(b) || (a.kind === 'grade' ? Number(a.id.slice(1)) - Number(b.id.slice(1)) : b.id.localeCompare(a.id)));
  return { boards, aliases: { daily: await latestDaily(db, now) } };
}

/** The Daily board people are playing now: the newest one with scores, or today's if none. */
export async function latestDaily(db: D1, now = Date.now()): Promise<string> {
  const row = await db.prepare("SELECT MAX(board) AS board FROM scores WHERE board LIKE 'daily-%' AND board <= ?1").bind(`daily-${utcDay(now + 86_400_000)}`).first<{ board: string | null }>();
  return row?.board ?? `daily-${utcDay(now)}`;
}

export async function boardView(db: D1, id: string, limit: number, now = Date.now()) {
  const board = id === 'daily' ? await latestDaily(db, now) : id;
  if (!isBoard(board)) return null;
  const results = await topScores(db, board, Math.min(BOARD_SIZE, Math.max(1, limit)));
  return {
    board,
    title: boardTitle(board, utcDay(now)),
    kind: boardKind(board),
    scores: results.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, seconds: r.seconds, look: r.look, outfit: outfitOf(r.look), verified: r.verified })),
  };
}

export async function playerView(db: D1, rawName: string) {
  const name = cleanName(rawName);
  if (!name) return null;
  const { results } = await db
    .prepare(
      `SELECT s.board AS board, s.score AS score, s.seconds AS seconds,
              (SELECT COUNT(*) FROM scores o WHERE o.board = s.board AND o.score > s.score) + 1 AS rank
       FROM scores s WHERE s.name = ?1 ORDER BY s.board LIMIT 200`,
    )
    .bind(name)
    .all<{ board: string; score: number; seconds: number; rank: number }>();
  if (!results.length) return null;
  const who = await db.prepare('SELECT name, look FROM players WHERE name = ?1').bind(name).first<{ name: string; look: string }>();
  const verified = !!(await db.prepare('SELECT 1 AS x FROM users WHERE name = ?1').bind(name).first());
  const look = who?.look ?? '';
  return {
    name: who?.name ?? name,
    look,
    outfit: outfitOf(look),
    verified,
    bests: results.map((r) => ({ board: r.board, title: boardTitle(r.board), kind: boardKind(r.board), score: r.score, seconds: r.seconds, rank: r.rank })),
  };
}
