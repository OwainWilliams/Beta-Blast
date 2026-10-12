// Beta Blast leaderboard API, on Cloudflare Workers with a D1 (SQLite) database.
//   GET  /scores?board=v3   -> { board, scores: [{ name, score, seconds }] }   the top 10
//   POST /scores            -> { rank, best }                                  body: { board, name, score, seconds? }
// One row per player name per board: a new score only replaces the old one if it is higher.
import { allowedOrigin, BOARD_SIZE, isBoard, parseSubmission, POSTS_PER_MINUTE } from './rules';

// Just the parts of the Cloudflare D1 types this file uses.
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface D1 {
  prepare(sql: string): D1Statement;
}
interface Env {
  DB: D1;
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_ORIGINS = 'https://thesecretstage.vip,https://owainwilliams.github.io,http://localhost:5173,http://localhost:4173';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS);
    const cors: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {};
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== '/scores') return reply({ error: 'Not found' }, 404);
    // Browsers send an Origin on cross-site calls. Refuse posts from sites we don't know.
    if (request.method === 'POST' && !origin) return reply({ error: 'Not allowed from here' }, 403);

    try {
      if (request.method === 'GET') {
        const board = url.searchParams.get('board');
        if (!isBoard(board)) return reply({ error: 'Unknown board' }, 400);
        return reply({ board, scores: await top(env.DB, board) });
      }
      if (request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        if (!(await withinLimit(env.DB, ip))) return reply({ error: 'Too many scores. Try again in a minute.' }, 429);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return reply({ error: 'Bad request' }, 400);
        }
        const s = parseSubmission(body);
        if (typeof s === 'string') return reply({ error: s }, 400);
        await env.DB.prepare(
          `INSERT INTO scores (board, name, score, seconds, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (board, name) DO UPDATE SET score = excluded.score, seconds = excluded.seconds, created_at = excluded.created_at
           WHERE excluded.score > scores.score`,
        )
          .bind(s.board, s.name, s.score, s.seconds, Date.now())
          .run();
        const row = await env.DB.prepare('SELECT score FROM scores WHERE board = ?1 AND name = ?2').bind(s.board, s.name).first<{ score: number }>();
        const best = row?.score ?? s.score;
        const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ?1 AND score > ?2').bind(s.board, best).first<{ n: number }>();
        return reply({ rank: (ahead?.n ?? 0) + 1, best });
      }
      return reply({ error: 'Method not allowed' }, 405);
    } catch {
      return reply({ error: 'Something went wrong' }, 500);
    }
  },
};

async function top(db: D1, board: string) {
  const { results } = await db
    .prepare('SELECT name, score, seconds FROM scores WHERE board = ?1 ORDER BY score DESC, created_at ASC LIMIT ?2')
    .bind(board, BOARD_SIZE)
    .all<{ name: string; score: number; seconds: number }>();
  return results;
}

/** Count this post against the caller's address for the current minute. False if they are over the limit. */
async function withinLimit(db: D1, ip: string): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const row = await db
    .prepare('INSERT INTO hits (ip, minute, n) VALUES (?1, ?2, 1) ON CONFLICT (ip, minute) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(ip, minute)
    .first<{ n: number }>();
  if (Math.random() < 0.02) await db.prepare('DELETE FROM hits WHERE minute < ?1').bind(minute - 5).run(); // tidy up now and then
  return (row?.n ?? 1) <= POSTS_PER_MINUTE;
}
