// What an admin can do about a name that is fake or offensive. Used only by the admin Worker (admin/), never
// reachable from the public API. Every action goes in the audit log, and removing scores can be undone.
import { cleanName } from './rules';
import { deleteAccount, moveName, Provider } from './auth';
import type { D1 } from './db';

export interface PlayerRow {
  name: string;
  boards: number;
  best: number;
  last: number;
  provider: Provider | null; // set when the name belongs to a signed-in account
  banned: boolean;
}

const like = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** Names on the leaderboard, most recently active first. `q` matches part of a name. */
export async function listPlayers(db: D1, q: string, offset = 0, limit = 50): Promise<PlayerRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.name AS name, COUNT(*) AS boards, MAX(s.score) AS best, MAX(s.created_at) AS last,
              (SELECT u.provider FROM users u WHERE u.name = s.name) AS provider,
              EXISTS (SELECT 1 FROM banned_names b WHERE b.name = s.name) AS banned
       FROM scores s WHERE s.name LIKE ?1 ESCAPE '\\' GROUP BY s.name ORDER BY last DESC, s.name LIMIT ?2 OFFSET ?3`,
    )
    .bind(like(q), Math.min(100, Math.max(1, limit)), Math.max(0, offset))
    .all<Omit<PlayerRow, 'banned'> & { banned: number }>();
  return results.map((r) => ({ ...r, banned: !!r.banned }));
}

async function record(db: D1, actor: string, action: string, target: string, detail: unknown, now: number): Promise<number> {
  const row = await db
    .prepare('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
    .bind(now, actor, action, target, JSON.stringify(detail))
    .first<{ id: number }>();
  return row?.id ?? 0;
}

const ban = (db: D1, name: string, reason: string, now: number) =>
  db.prepare('INSERT INTO banned_names (name, reason, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (name) DO NOTHING').bind(name, reason.slice(0, 200), now).run();

interface ScoreRow {
  board: string;
  name: string;
  score: number;
  seconds: number;
  created_at: number;
}

/** Delete a name's scores and outfit from every board. With `ban`, nobody can post under the name again. */
export async function removePlayer(db: D1, actor: string, name: string, opts: { ban?: boolean; reason?: string } = {}, now = Date.now()): Promise<{ removed: number }> {
  const scores = (await db.prepare('SELECT board, name, score, seconds, created_at FROM scores WHERE name = ?1').bind(name).all<ScoreRow>()).results;
  const player = await db.prepare('SELECT name, look, updated_at FROM players WHERE name = ?1').bind(name).first<{ name: string; look: string; updated_at: number }>();
  await db.prepare('DELETE FROM scores WHERE name = ?1').bind(name).run();
  await db.prepare('DELETE FROM players WHERE name = ?1').bind(name).run();
  if (opts.ban) await ban(db, name, opts.reason ?? '', now);
  await record(db, actor, 'remove-scores', name, { scores, player, banned: !!opts.ban, reason: opts.reason ?? '' }, now);
  return { removed: scores.length };
}

/** Give a name something neutral (or `to`), taking its scores along. For an account it changes the account's name too. */
export async function renamePlayer(db: D1, actor: string, name: string, to?: string, now = Date.now()): Promise<{ name: string } | { error: string }> {
  let target = to === undefined || to === '' ? null : cleanName(to);
  if (to && !target) return { error: 'That name is not allowed' };
  for (let i = 0; !target && i < 20; i++) {
    const candidate = `Climber ${1000 + Math.floor(Math.random() * 9000)}`;
    if (!(await taken(db, candidate))) target = candidate;
  }
  if (!target) return { error: 'Could not find a free name' };
  if (target.toLowerCase() !== name.toLowerCase() && (await taken(db, target))) return { error: 'That name is taken' };
  await moveName(db, name, target);
  await db.prepare('UPDATE users SET name = ?2 WHERE name = ?1').bind(name, target).run();
  await record(db, actor, 'rename', name, { to: target }, now);
  return { name: target };
}

const taken = async (db: D1, name: string): Promise<boolean> =>
  !!(await db.prepare('SELECT 1 AS x FROM scores WHERE name = ?1 UNION SELECT 1 FROM users WHERE name = ?1 UNION SELECT 1 FROM banned_names WHERE name = ?1').bind(name).first());

/** Delete the account that has this name (its scores, sessions and save). With `ban`, that GitHub/Google login can't be used again. */
export async function removeAccount(db: D1, actor: string, name: string, opts: { ban?: boolean; reason?: string } = {}, now = Date.now()): Promise<{ ok: boolean; error?: string }> {
  const user = await db.prepare('SELECT id, provider, provider_id, name FROM users WHERE name = ?1').bind(name).first<{ id: string; provider: Provider; provider_id: string; name: string }>();
  if (!user) return { ok: false, error: 'No account has that name' };
  await deleteAccount(db, { id: user.id, provider: user.provider, name: user.name });
  if (opts.ban) await db.prepare('INSERT INTO banned_accounts (provider, provider_id, reason, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING').bind(user.provider, user.provider_id, (opts.reason ?? '').slice(0, 200), now).run();
  await record(db, actor, 'delete-account', name, { provider: user.provider, banned: !!opts.ban, reason: opts.reason ?? '' }, now); // the account itself can't be restored
  return { ok: true };
}

export interface ArcadeRow {
  id: number;
  week: string;
  initials: string;
  score: number;
  seconds: number;
}
export async function listArcade(db: D1, week: string): Promise<ArcadeRow[]> {
  return (await db.prepare('SELECT id, week, initials, score, seconds FROM arcade_scores WHERE week = ?1 ORDER BY score DESC, id ASC LIMIT 50').bind(week).all<ArcadeRow>()).results;
}
export async function removeArcadeRun(db: D1, actor: string, id: number, now = Date.now()): Promise<{ ok: boolean }> {
  const row = await db.prepare('SELECT week, initials, score, seconds, created_at FROM arcade_scores WHERE id = ?1').bind(id).first<{ week: string; initials: string; score: number; seconds: number; created_at: number }>();
  if (!row) return { ok: false };
  await db.prepare('DELETE FROM arcade_scores WHERE id = ?1').bind(id).run();
  await record(db, actor, 'remove-arcade-run', row.initials, row, now);
  return { ok: true };
}

export async function listBans(db: D1): Promise<{ names: { name: string; reason: string; created_at: number }[]; accounts: number }> {
  const names = (await db.prepare('SELECT name, reason, created_at FROM banned_names ORDER BY created_at DESC LIMIT 200').all<{ name: string; reason: string; created_at: number }>()).results;
  const accounts = await db.prepare('SELECT COUNT(*) AS n FROM banned_accounts').first<{ n: number }>();
  return { names, accounts: accounts?.n ?? 0 };
}
export async function unban(db: D1, actor: string, name: string, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM banned_names WHERE name = ?1').bind(name).run();
  await record(db, actor, 'unban', name, {}, now);
}

export interface AuditRow {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string;
  undone: boolean;
  canUndo: boolean;
}
export async function listAudit(db: D1, limit = 100): Promise<AuditRow[]> {
  const { results } = await db.prepare('SELECT id, at, actor, action, target, undone FROM audit_log ORDER BY id DESC LIMIT ?1').bind(Math.min(200, Math.max(1, limit))).all<Omit<AuditRow, 'undone' | 'canUndo'> & { undone: number }>();
  return results.map((r) => ({ ...r, undone: !!r.undone, canUndo: !r.undone && (r.action === 'remove-scores' || r.action === 'remove-arcade-run') }));
}

/** Put back what a removal took away. The name's ban (if that action added one) is lifted. */
export async function undo(db: D1, actor: string, id: number, now = Date.now()): Promise<{ ok: boolean; error?: string }> {
  const row = await db.prepare('SELECT action, target, detail, undone FROM audit_log WHERE id = ?1').bind(id).first<{ action: string; target: string; detail: string; undone: number }>();
  if (!row) return { ok: false, error: 'No such entry' };
  if (row.undone) return { ok: false, error: 'Already undone' };
  const detail = JSON.parse(row.detail) as Record<string, unknown>;
  if (row.action === 'remove-scores') {
    for (const s of detail.scores as ScoreRow[])
      await db.prepare('INSERT INTO scores (board, name, score, seconds, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (board, name) DO NOTHING').bind(s.board, s.name, s.score, s.seconds, s.created_at).run();
    const p = detail.player as { name: string; look: string; updated_at: number } | null;
    if (p) await db.prepare('INSERT INTO players (name, look, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (name) DO NOTHING').bind(p.name, p.look, p.updated_at).run();
    if (detail.banned) await db.prepare('DELETE FROM banned_names WHERE name = ?1').bind(row.target).run();
  } else if (row.action === 'remove-arcade-run') {
    const r = detail as { week: string; initials: string; score: number; seconds: number; created_at: number };
    await db.prepare('INSERT INTO arcade_scores (week, initials, score, seconds, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(r.week, r.initials, r.score, r.seconds, r.created_at).run();
  } else return { ok: false, error: 'That cannot be undone' };
  await db.prepare('UPDATE audit_log SET undone = 1 WHERE id = ?1').bind(id).run();
  await record(db, actor, 'undo', `#${id} ${row.target}`, {}, now);
  return { ok: true };
}
