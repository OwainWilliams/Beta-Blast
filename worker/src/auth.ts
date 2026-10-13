// Accounts: sign in with GitHub or Google, a session token for each device, a leaderboard name that belongs to
// the account, and a cloud copy of the save.
//
// The game and the API are on different sites, so cookies would be blocked. Instead the sign-in ends with the
// browser being sent back to the game with a one-time code in the URL fragment; the game swaps that for a
// session token (POST /auth/exchange) and sends the token as "Authorization: Bearer ..." from then on.
//
// To stop someone starting a sign-in on their own account and tricking another person into finishing it, each
// sign-in is tied to the browser that began it: the game keeps a secret ("verifier"), sends only its SHA-256
// ("challenge") when it starts, and must show the secret again to swap the code for a token.
import { cleanSave, CloudSave, EMPTY_SAVE, MAX_SAVE_BYTES, mergeSaves } from '../../src/game/saveMerge';
import type { D1 } from './db';
import { forget } from './memo';
import { cleanName } from './rules';

export type Provider = 'github' | 'google';
export const PROVIDERS: Provider[] = ['github', 'google'];
export const isProvider = (p: string): p is Provider => (PROVIDERS as string[]).includes(p);

export interface AuthEnv {
  GH_CLIENT_ID?: string;
  GH_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
export interface User {
  id: string;
  provider: Provider;
  name: string | null;
}

const STATE_MS = 10 * 60_000;
const CODE_MS = 2 * 60_000;
const SESSION_MS = 30 * 86_400_000;
export const AUTH_PER_MINUTE = 30;

// ---------- small helpers ----------

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (bytes = 32): string => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const credentials = (env: AuthEnv, provider: Provider): { id: string; secret: string } | null => {
  const id = provider === 'github' ? env.GH_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const secret = provider === 'github' ? env.GH_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
};
/** The providers that have been set up (their secrets are in place). */
export const enabledProviders = (env: AuthEnv): Provider[] => PROVIDERS.filter((p) => credentials(env, p));

/** Where the sign-in comes back to must be one of the game's own sites. */
export function validReturnTo(raw: string | null, allowedOrigins: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!allowedOrigins.split(',').map((s) => s.trim()).includes(url.origin)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Clear out what has expired, now and then. */
async function tidy(db: D1, now: number): Promise<void> {
  if (Math.random() > 0.05) return;
  await db.prepare('DELETE FROM oauth_states WHERE created_at < ?1').bind(now - STATE_MS).run();
  await db.prepare('DELETE FROM login_codes WHERE expires_at < ?1').bind(now).run();
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now).run();
}

// ---------- the provider side ----------

function authorizeUrl(provider: Provider, clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  if (provider === 'github') return `https://github.com/login/oauth/authorize?${q}`;
  q.set('response_type', 'code');
  q.set('scope', 'openid'); // just "who is this": no name, no email
  q.set('prompt', 'select_account');
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Swap the code for who the person is: the provider's own id for them, or null if it didn't work. */
async function providerUserId(provider: Provider, c: { id: string; secret: string }, code: string, redirectUri: string): Promise<string | null> {
  try {
    if (provider === 'github') {
      const t = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'beta-blast' },
        body: JSON.stringify({ client_id: c.id, client_secret: c.secret, code, redirect_uri: redirectUri }),
      });
      const token = ((await t.json()) as { access_token?: string }).access_token;
      if (!token) return null;
      const me = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'beta-blast' } });
      const id = ((await me.json()) as { id?: number }).id;
      return Number.isInteger(id) ? String(id) : null;
    }
    const t = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const idToken = ((await t.json()) as { id_token?: string }).id_token;
    if (!idToken) return null;
    // Straight from Google's token endpoint over TLS, in answer to our secret: no need to check the signature again.
    const claims = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { iss?: string; aud?: string; sub?: string; exp?: number };
    const okIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    return okIssuer && claims.aud === c.id && typeof claims.sub === 'string' && claims.sub && (claims.exp ?? 0) * 1000 > Date.now() ? claims.sub : null;
  } catch {
    return null;
  }
}

// ---------- sign in ----------

/** Step 1: send the browser to the provider. Returns the address to redirect to, or an error. */
export async function startLogin(db: D1, env: AuthEnv, provider: Provider, returnTo: string | null, challenge: string | null, allowedOrigins: string, apiOrigin: string, now = Date.now()): Promise<{ url: string } | { error: string; status: number }> {
  const c = credentials(env, provider);
  if (!c) return { error: `Sign in with ${provider === 'github' ? 'GitHub' : 'Google'} is not set up yet`, status: 503 };
  const back = validReturnTo(returnTo, allowedOrigins);
  if (!back) return { error: 'That return address is not allowed', status: 400 };
  if (!challenge || !/^[a-f0-9]{64}$/.test(challenge)) return { error: 'Missing sign-in challenge', status: 400 };
  const state = randomToken();
  await db.prepare('INSERT INTO oauth_states (state, provider, return_to, challenge, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(state, provider, back, challenge, now).run();
  return { url: authorizeUrl(provider, c.id, `${apiOrigin}/auth/${provider}/callback`, state) };
}

/** Step 2: the provider sent them back. Returns where to send the browser next (the game, with a code or an error). */
export async function finishLogin(db: D1, env: AuthEnv, provider: Provider, params: URLSearchParams, apiOrigin: string, now = Date.now()): Promise<{ url: string } | { error: string; status: number }> {
  const state = params.get('state') ?? '';
  const row = state ? await db.prepare('SELECT provider, return_to, challenge, created_at FROM oauth_states WHERE state = ?1').bind(state).first<{ provider: string; return_to: string; challenge: string; created_at: number }>() : null;
  if (state) await db.prepare('DELETE FROM oauth_states WHERE state = ?1').bind(state).run(); // each sign-in can only be finished once
  if (!row || row.provider !== provider || now - row.created_at > STATE_MS) return { error: 'This sign-in has expired. Go back to the game and try again.', status: 400 };
  const back = (reason: string) => ({ url: `${row.return_to}#login_error=${reason}` });
  const c = credentials(env, provider);
  const code = params.get('code');
  if (!c || params.get('error') || !code) return back(params.get('error') ? 'denied' : 'failed');
  const sub = await providerUserId(provider, c, code, `${apiOrigin}/auth/${provider}/callback`);
  if (!sub) return back('failed');
  if (await db.prepare('SELECT 1 AS x FROM banned_accounts WHERE provider = ?1 AND provider_id = ?2').bind(provider, sub).first()) return back('banned');
  let user = await db.prepare('SELECT id FROM users WHERE provider = ?1 AND provider_id = ?2').bind(provider, sub).first<{ id: string }>();
  if (!user) {
    user = { id: randomToken(12) };
    await db.prepare('INSERT INTO users (id, provider, provider_id, created_at) VALUES (?1, ?2, ?3, ?4)').bind(user.id, provider, sub, now).run();
  }
  const one = randomToken();
  await db.prepare('INSERT INTO login_codes (code_hash, user_id, challenge, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(await sha256(one), user.id, row.challenge, now + CODE_MS).run();
  await tidy(db, now);
  return { url: `${row.return_to}#login=${one}` };
}

/** Step 3: the game swaps its one-time code, and the secret it started with, for a session token. */
export async function exchangeCode(db: D1, code: unknown, verifier: unknown, now = Date.now()): Promise<{ token: string; user: PublicUser } | null> {
  if (typeof code !== 'string' || code.length < 20 || code.length > 100) return null;
  if (typeof verifier !== 'string' || verifier.length < 20 || verifier.length > 100) return null;
  const hash = await sha256(code);
  const row = await db.prepare('SELECT user_id, challenge, expires_at FROM login_codes WHERE code_hash = ?1').bind(hash).first<{ user_id: string; challenge: string; expires_at: number }>();
  if (row) await db.prepare('DELETE FROM login_codes WHERE code_hash = ?1').bind(hash).run(); // one use, even if the secret is wrong
  if (!row || row.expires_at < now || (await sha256(verifier)) !== row.challenge) return null;
  const user = await db.prepare('SELECT id, provider, name FROM users WHERE id = ?1').bind(row.user_id).first<User>();
  if (!user) return null;
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(await sha256(token), user.id, now, now + SESSION_MS).run();
  return { token, user: publicUser(user) };
}

// ---------- who is asking ----------

export interface PublicUser {
  name: string | null;
  provider: Provider;
}
export const publicUser = (u: User): PublicUser => ({ name: u.name, provider: u.provider });

export const bearer = (request: Request): string | null => /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? null;

/** The signed-in person behind a request's token, or null. */
export async function authenticate(db: D1, token: string | null, now = Date.now()): Promise<User | null> {
  if (!token) return null;
  return db
    .prepare('SELECT u.id AS id, u.provider AS provider, u.name AS name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2')
    .bind(await sha256(token), now)
    .first<User>();
}

export async function logout(db: D1, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
}

// ---------- the account ----------

/** Move everything held under one name (scores, outfit) to another. If the new name has a score of its own on a board, the higher one is kept. */
export async function moveName(db: D1, old: string, name: string): Promise<void> {
  if (old.toLowerCase() === name.toLowerCase()) {
    // only the capital letters change: the same rows, shown the new way
    await db.prepare('UPDATE scores SET name = ?2 WHERE name = ?1').bind(old, name).run();
    await db.prepare('UPDATE players SET name = ?2 WHERE name = ?1').bind(old, name).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO scores (board, name, score, seconds, created_at) SELECT board, ?2, score, seconds, created_at FROM scores WHERE name = ?1
       ON CONFLICT (board, name) DO UPDATE SET score = excluded.score, seconds = excluded.seconds, created_at = excluded.created_at WHERE excluded.score > scores.score`,
    )
    .bind(old, name)
    .run();
  await db.prepare('DELETE FROM scores WHERE name = ?1').bind(old).run();
  await db.prepare('DELETE FROM players WHERE name = ?1').bind(name).run(); // the outfit that goes with the old name wins
  await db.prepare('UPDATE players SET name = ?2 WHERE name = ?1').bind(old, name).run();
}

/**
 * Pick or change the leaderboard name. Names are unique. Changing it takes the account's scores (and outfit) to the
 * new name; if the new name already has scores of its own on a board, the higher one is kept.
 */
export async function setName(db: D1, user: User, raw: unknown): Promise<{ name: string } | { error: string; status: number }> {
  const name = cleanName(raw);
  if (!name) return { error: 'That name is not allowed. Use 1 to 12 letters, numbers, spaces, . _ -', status: 400 };
  if (user.name === name) return { name };
  const taken = await db.prepare('SELECT 1 AS x FROM users WHERE name = ?1 AND id <> ?2').bind(name, user.id).first();
  if (taken) return { error: 'That name is taken', status: 409 };
  if (await db.prepare('SELECT 1 AS x FROM banned_names WHERE name = ?1').bind(name).first()) return { error: 'That name is not allowed. Use 1 to 12 letters, numbers, spaces, . _ -', status: 400 };
  if (user.name) await moveName(db, user.name, name);
  forget(db);
  await db.prepare('UPDATE users SET name = ?1 WHERE id = ?2').bind(name, user.id).run();
  return { name };
}

export async function getSave(db: D1, user: User): Promise<{ save: CloudSave | null; updatedAt: number | null }> {
  const row = await db.prepare('SELECT data, updated_at FROM saves WHERE user_id = ?1').bind(user.id).first<{ data: string; updated_at: number }>();
  if (!row) return { save: null, updatedAt: null };
  try {
    return { save: cleanSave(JSON.parse(row.data)), updatedAt: row.updated_at };
  } catch {
    return { save: null, updatedAt: null };
  }
}

/** Merge what a device sent into the stored save (the device's outfit wins), keep it, and return the result. */
export async function putSave(db: D1, user: User, incoming: unknown, now = Date.now()): Promise<CloudSave | string> {
  const mine = cleanSave(incoming);
  const stored = (await getSave(db, user)).save ?? EMPTY_SAVE;
  const merged = mergeSaves(stored, mine, 'b');
  const data = JSON.stringify(merged);
  if (data.length > MAX_SAVE_BYTES) return 'Save too large';
  await db.prepare('INSERT INTO saves (user_id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(user.id, data, now).run();
  return merged;
}

/** Erase the account, its scores and everything else held about it. The name is free again. */
export async function deleteAccount(db: D1, user: User): Promise<void> {
  forget(db);
  if (user.name) {
    await db.prepare('DELETE FROM scores WHERE name = ?1').bind(user.name).run();
    await db.prepare('DELETE FROM players WHERE name = ?1').bind(user.name).run();
  }
  for (const table of ['sessions', 'saves', 'login_codes']) await db.prepare(`DELETE FROM ${table} WHERE user_id = ?1`).bind(user.id).run();
  await db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id).run();
}
