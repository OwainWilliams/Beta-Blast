// Beta Blast leaderboard API, on Cloudflare Workers with a D1 (SQLite) database.
//
// Used by the game:
//   GET  /scores?board=v3   -> { board, scores: [{ name, score, seconds, look }] } the top 10, always fresh
//   POST /scores            -> { rank, best, score }   body: { board, name, score, seconds?, look?, replay }
// The body holds the score and the player's moves. The Worker checks the score is believable for those moves
// (or, with VERIFY_REPLAYS=1, replays them and uses its own score). One row per player name per board; a new
// score only replaces the old one if it is higher. Posting is only allowed from the game's own sites.
//
// Public and read-only, for anyone's website (any origin may call these; answers are cached for 30 seconds):
//   GET  /v1                -> the list of endpoints
//   GET  /v1/boards         -> every board that has scores
//   GET  /v1/boards/{board} -> the top scores, with ranks and climber outfit colours ("daily" is today's Daily Boulder)
//   GET  /v1/players/{name} -> a player's best score and rank on every board
import { levelForBoard, plausible, playReplay } from '../../src/game/replay';
import type { D1 } from './db';
import { allowedOrigin, BOARD_SIZE, isBoard, parseSubmission, POSTS_PER_MINUTE } from './rules';
import { boardView, ENDPOINTS, listBoards, playerView } from './v1';

interface Env {
  DB: D1;
  ALLOWED_ORIGINS?: string;
  /** "1" replays every post through the game engine. It needs the Workers Paid plan: a run takes 8 to 50 ms of CPU. */
  VERIFY_REPLAYS?: string;
}
interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

const DEFAULT_ORIGINS = 'https://thesecretstage.vip,https://owainwilliams.github.io,http://localhost:5173,http://localhost:4173';
const CACHE_SECONDS = 30;

export default {
  async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS);
    // Reading is open to every site. Posting, and the preflight for it, only to the game's own.
    const post: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {};
    const read: Record<string, string> = { 'Access-Control-Allow-Origin': '*' };
    const cors = request.method === 'GET' ? read : post;
    const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...cors, ...extra } });

    if (request.method === 'OPTIONS') {
      if (origin) return new Response(null, { status: 204, headers: post });
      const readOnly = request.headers.get('Access-Control-Request-Method') === 'GET';
      return new Response(null, { status: 204, headers: readOnly ? { ...read, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } : {} });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET') {
        if (path === '/scores') {
          const board = url.searchParams.get('board');
          if (!isBoard(board)) return reply({ error: 'Unknown board' }, 400);
          return reply({ board, scores: await top(env.DB, board) }, 200, { 'Cache-Control': 'no-cache' });
        }
        if (path === '/' || path === '/v1' || path.startsWith('/v1/')) return await cached(request, ctx, () => v1(path, url, env.DB, reply));
        return reply({ error: 'Not found' }, 404);
      }
      // Browsers send an Origin on cross-site calls. Refuse posts from sites we don't know.
      if (path !== '/scores') return reply({ error: 'Not found' }, 404);
      if (request.method === 'POST' && !origin) return reply({ error: 'Not allowed from here' }, 403);

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
        const level = levelForBoard(s.board, s.replay);
        if (!level) return reply({ error: 'That board is not open for scores' }, 400);
        let score = s.score;
        let seconds = s.seconds;
        if (env.VERIFY_REPLAYS === '1') {
          const outcome = playReplay(level, s.replay);
          if (!outcome.ok) return reply({ error: `Replay rejected: ${outcome.reason}` }, 400);
          if (outcome.score < 1) return reply({ error: 'No score to post' }, 400);
          score = outcome.score;
          seconds = Math.round(outcome.seconds);
        } else {
          const why = plausible(s.board, s.replay, s.score, s.seconds);
          if (why) return reply({ error: why }, 400);
        }
        if (s.board !== 'survival') seconds = 0;
        await env.DB.prepare(
          `INSERT INTO scores (board, name, score, seconds, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (board, name) DO UPDATE SET score = excluded.score, seconds = excluded.seconds, created_at = excluded.created_at
           WHERE excluded.score > scores.score`,
        )
          .bind(s.board, s.name, score, seconds, Date.now())
          .run();
        if (s.look)
          await env.DB.prepare('INSERT INTO players (name, look, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (name) DO UPDATE SET look = excluded.look, updated_at = excluded.updated_at')
            .bind(s.name, s.look, Date.now())
            .run();
        const row = await env.DB.prepare('SELECT score FROM scores WHERE board = ?1 AND name = ?2').bind(s.board, s.name).first<{ score: number }>();
        const best = row?.score ?? score;
        const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ?1 AND score > ?2').bind(s.board, best).first<{ n: number }>();
        return reply({ rank: (ahead?.n ?? 0) + 1, best, score });
      }
      return reply({ error: 'Method not allowed' }, 405);
    } catch {
      return reply({ error: 'Something went wrong' }, 500);
    }
  },
};

async function top(db: D1, board: string) {
  const { results } = await db
    .prepare(
      `SELECT s.name AS name, s.score AS score, s.seconds AS seconds, COALESCE(p.look, '') AS look
       FROM scores s LEFT JOIN players p ON p.name = s.name
       WHERE s.board = ?1 ORDER BY s.score DESC, s.created_at ASC LIMIT ?2`,
    )
    .bind(board, BOARD_SIZE)
    .all<{ name: string; score: number; seconds: number; look: string }>();
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

type Reply = (body: unknown, status?: number, extra?: Record<string, string>) => Response;

/** The public read endpoints. */
async function v1(path: string, url: URL, db: D1, reply: Reply): Promise<Response> {
  const fresh = { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` };
  if (path === '/' || path === '/v1') return reply({ name: 'Beta Blast leaderboard API', version: 1, endpoints: ENDPOINTS }, 200, fresh);
  if (path === '/v1/boards') return reply(await listBoards(db), 200, fresh);
  const board = /^\/v1\/boards\/([^/]+)$/.exec(path);
  if (board) {
    const limit = Number(url.searchParams.get('limit') ?? BOARD_SIZE);
    const view = await boardView(db, decodeURIComponent(board[1]), Number.isFinite(limit) ? Math.floor(limit) : BOARD_SIZE);
    return view ? reply(view, 200, fresh) : reply({ error: 'Unknown board' }, 404);
  }
  const player = /^\/v1\/players\/([^/]+)$/.exec(path);
  if (player) {
    const view = await playerView(db, decodeURIComponent(player[1]));
    return view ? reply(view, 200, fresh) : reply({ error: 'No scores for that player' }, 404);
  }
  return reply({ error: 'Not found' }, 404);
}

/** Serve a GET from Cloudflare's edge cache when there, otherwise make it and keep it for next time. */
async function cached(request: Request, ctx: Ctx | undefined, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache) return make();
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) ctx?.waitUntil(cache.put(request, res.clone()));
  return res;
}
