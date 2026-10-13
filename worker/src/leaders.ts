// The rows of a leaderboard, shared by the game's own call (/scores) and the public API (/v1).
import { OVERALL } from '../../src/game/boards';
import type { D1 } from './db';
import { memo } from './memo';

/** The Overall ranking adds up every score in the table, so it is worked out at most this often. */
export const OVERALL_TTL_MS = 60_000;

export interface Leader {
  name: string;
  score: number;
  seconds: number;
  look: string;
  verified: boolean;
}

// The people shown beside each score: their outfit, and whether the name belongs to a signed-in player.
const WHO = `COALESCE(p.look, '') AS look, u.id IS NOT NULL AS verified`;
const JOINS = `LEFT JOIN players p ON p.name = s.name LEFT JOIN users u ON u.name = s.name`;

/**
 * The top `limit` on a board. "overall" is each player's best score on every grade added to their Survival best:
 * a ranking of who is doing best across the whole game. (Daily boards change every day, so they are left out.)
 */
export function topScores(db: D1, board: string, limit: number, now = Date.now()): Promise<Leader[]> {
  return board === OVERALL ? memo(db, `overall:${limit}`, OVERALL_TTL_MS, () => queryTop(db, board, limit), now) : queryTop(db, board, limit);
}

async function queryTop(db: D1, board: string, limit: number): Promise<Leader[]> {
  const sql =
    board === OVERALL
      ? `SELECT s.name AS name, SUM(s.score) AS score, 0 AS seconds, ${WHO}
         FROM scores s ${JOINS}
         WHERE s.board GLOB 'v[0-9]*' OR s.board = 'survival'
         GROUP BY s.name ORDER BY score DESC, MIN(s.created_at) ASC LIMIT ?1`
      : `SELECT s.name AS name, s.score AS score, s.seconds AS seconds, ${WHO}
         FROM scores s ${JOINS}
         WHERE s.board = ?2 ORDER BY s.score DESC, s.created_at ASC LIMIT ?1`;
  const stmt = db.prepare(sql);
  const { results } = await (board === OVERALL ? stmt.bind(limit) : stmt.bind(limit, board)).all<Omit<Leader, 'verified'> & { verified: number }>();
  return results.map((r) => ({ ...r, verified: !!r.verified }));
}

/** How many players the overall ranking has, and the best total. */
export function overallSummary(db: D1, now = Date.now()): Promise<{ entries: number; top: number }> {
  return memo(db, 'overall:summary', OVERALL_TTL_MS, () => queryOverallSummary(db), now);
}

async function queryOverallSummary(db: D1): Promise<{ entries: number; top: number }> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS entries, COALESCE(MAX(total), 0) AS top FROM (SELECT SUM(score) AS total FROM scores WHERE board GLOB 'v[0-9]*' OR board = 'survival' GROUP BY name)`)
    .first<{ entries: number; top: number }>();
  return { entries: row?.entries ?? 0, top: row?.top ?? 0 };
}
