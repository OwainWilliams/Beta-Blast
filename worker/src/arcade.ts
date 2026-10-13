// Arcade: Survival runs under three-character initials, with a top-10 table that starts again every Monday.
//   GET  /arcade            -> { week, resetsAt, scores: [{ name, score, seconds, look, verified }] }   this week's table
//   GET  /arcade?week=2026-10-12                                                                       a past week's
//   POST /arcade            -> { qualified, rank }   body: { initials, score, seconds, replay }
// A run is checked exactly like a Survival score. Initials belong to nobody, so nothing here involves accounts.
import { ARCADE_SIZE, arcadeWeek, cleanInitials, isArcadeBoard, nextReset } from '../../src/game/arcade';
import { levelForBoard, parseReplay, plausible, playReplay, Replay } from '../../src/game/replay';
import type { D1 } from './db';
import { withinLimit } from './limits';
import { allowedOrigin, POSTS_PER_MINUTE } from './rules';

type Reply = (body: unknown, status?: number, extra?: Record<string, string>) => Response;

export interface ArcadeRun {
  initials: string;
  score: number;
  seconds: number;
  replay: Replay;
}

/** Check a posted body. Returns the cleaned run, or the reason it was refused. */
export function parseArcadeRun(body: unknown): ArcadeRun | string {
  if (typeof body !== 'object' || body === null) return 'Bad request';
  const b = body as Record<string, unknown>;
  const initials = cleanInitials(b.initials);
  if (!initials) return 'Those initials are not allowed. Use three letters or numbers.';
  const replay = parseReplay(b.replay);
  if (typeof replay === 'string') return replay;
  const { score, seconds } = b;
  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 1e9) return 'Score out of range';
  if (!Number.isInteger(seconds) || (seconds as number) < 1 || (seconds as number) > 86_400) return 'Time out of range';
  return { initials, replay, score: score as number, seconds: seconds as number };
}

export async function arcadeTop(db: D1, week: string, limit = ARCADE_SIZE) {
  const { results } = await db
    .prepare("SELECT initials AS name, score, seconds, '' AS look, 0 AS verified FROM arcade_scores WHERE week = ?1 ORDER BY score DESC, id ASC LIMIT ?2")
    .bind(week, limit)
    .all<{ name: string; score: number; seconds: number; look: string; verified: number }>();
  return results.map((r) => ({ ...r, verified: false }));
}

/** Add a run to this week's table. `rank` is null if it didn't make the top 10 (and so wasn't kept). */
export async function addArcadeRun(db: D1, run: { initials: string; score: number; seconds: number }, now = Date.now()): Promise<{ qualified: boolean; rank: number | null }> {
  const week = arcadeWeek(now);
  const row = await db
    .prepare('INSERT INTO arcade_scores (week, initials, score, seconds, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
    .bind(week, run.initials, run.score, run.seconds, now)
    .first<{ id: number }>();
  const id = row?.id ?? 0;
  const ahead = await db.prepare('SELECT COUNT(*) AS n FROM arcade_scores WHERE week = ?1 AND (score > ?2 OR (score = ?2 AND id < ?3))').bind(week, run.score, id).first<{ n: number }>();
  const rank = (ahead?.n ?? 0) + 1;
  if (rank > ARCADE_SIZE) {
    await db.prepare('DELETE FROM arcade_scores WHERE id = ?1').bind(id).run(); // not good enough: nothing to keep
    return { qualified: false, rank: null };
  }
  // keep the table to ten: whoever was tenth before this run is pushed off
  await db
    .prepare('DELETE FROM arcade_scores WHERE week = ?1 AND id NOT IN (SELECT id FROM arcade_scores WHERE week = ?1 ORDER BY score DESC, id ASC LIMIT ?2)')
    .bind(week, ARCADE_SIZE)
    .run();
  return { qualified: true, rank };
}

interface ArcadeEnv {
  DB: D1;
  VERIFY_REPLAYS?: string;
}

/** The /arcade routes. Returns null for any other path. */
export async function arcadeRoute(request: Request, url: URL, path: string, env: ArcadeEnv, origins: string, reply: Reply): Promise<Response | null> {
  if (path !== '/arcade') return null;
  if (request.method === 'GET') {
    const asked = url.searchParams.get('week');
    const week = asked ?? arcadeWeek();
    if (!isArcadeBoard(`arcade-${week}`)) return reply({ error: 'Unknown week' }, 400);
    return reply({ week, resetsAt: new Date(nextReset(Date.parse(week))).toISOString(), scores: await arcadeTop(env.DB, week) }, 200, { 'Cache-Control': 'no-cache' });
  }
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!allowedOrigin(request.headers.get('Origin'), origins)) return reply({ error: 'Not allowed from here' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await withinLimit(env.DB, ip, POSTS_PER_MINUTE))) return reply({ error: 'Too many scores. Try again in a minute.' }, 429);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ error: 'Bad request' }, 400);
  }
  const run = parseArcadeRun(body);
  if (typeof run === 'string') return reply({ error: run }, 400);
  const level = levelForBoard('survival', run.replay); // an Arcade run is a Survival run
  if (!level) return reply({ error: 'Bad replay' }, 400);
  let { score, seconds } = run;
  if (env.VERIFY_REPLAYS === '1') {
    const outcome = playReplay(level, run.replay);
    if (!outcome.ok) return reply({ error: `Replay rejected: ${outcome.reason}` }, 400);
    if (outcome.score < 1) return reply({ error: 'No score to post' }, 400);
    score = outcome.score;
    seconds = Math.max(1, Math.round(outcome.seconds));
  } else {
    const why = plausible('survival', run.replay, score, seconds);
    if (why) return reply({ error: why }, 400);
  }
  return reply(await addArcadeRun(env.DB, { initials: run.initials, score, seconds }));
}
