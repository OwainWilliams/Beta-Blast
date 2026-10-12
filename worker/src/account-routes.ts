// The HTTP side of accounts (see auth.ts for what each step does).
//   GET    /auth/providers                      which sign-in buttons to show
//   GET    /auth/{github|google}/start          send the browser to the provider (the game links here, with ?return_to= and ?challenge=)
//   GET    /auth/{github|google}/callback       the provider sends the browser back here
//   POST   /auth/exchange   { code, verifier }  one-time code (and the secret the browser started with) -> { token, user }
//   GET    /me                                  who am I
//   PUT    /me/name         { name }            choose my leaderboard name
//   GET    /me/save, PUT /me/save { save }      my cloud save
//   POST   /me/logout                           end this device's session
//   DELETE /me                                  delete my account, scores and save
import { AUTH_PER_MINUTE, authenticate, AuthEnv, bearer, deleteAccount, enabledProviders, exchangeCode, finishLogin, getSave, isProvider, logout, publicUser, putSave, setName, startLogin } from './auth';
import type { D1 } from './db';
import { withinLimit } from './limits';

type Reply = (body: unknown, status?: number, extra?: Record<string, string>) => Response;
const ROUTE = /^\/auth\/([a-z]+)\/(start|callback)$/;

const page = (text: string, status: number): Response => new Response(`<!doctype html><meta charset="utf-8"><title>Beta Blast</title><body style="font:16px system-ui;padding:2em;max-width:30em;margin:auto"><p>${text}</p>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/** Handle an account request, or return null if it isn't one. `origin` is the caller's site if it is one of the game's. */
export async function accountRoute(request: Request, url: URL, path: string, env: AuthEnv & { DB: D1 }, allowedOrigins: string, origin: string | null, reply: Reply): Promise<Response | null> {
  const db = env.DB;
  const method = request.method;
  if (!path.startsWith('/auth/') && path !== '/me' && !path.startsWith('/me/')) return null;

  if (path === '/auth/providers' && method === 'GET') return reply({ providers: enabledProviders(env) }, 200, { 'Cache-Control': 'public, max-age=60' });

  const flow = ROUTE.exec(path);
  if (flow && method === 'GET') {
    if (!isProvider(flow[1])) return reply({ error: 'Not found' }, 404);
    if (!(await withinLimit(db, `auth:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`, AUTH_PER_MINUTE))) return page('Too many sign-in attempts. Wait a minute and try again.', 429);
    if (flow[2] === 'start') {
      const r = await startLogin(db, env, flow[1], url.searchParams.get('return_to'), url.searchParams.get('challenge'), allowedOrigins, url.origin);
      return 'url' in r ? Response.redirect(r.url, 302) : page(r.error, r.status);
    }
    const r = await finishLogin(db, env, flow[1], url.searchParams, url.origin);
    return 'url' in r ? Response.redirect(r.url, 302) : page(r.error, r.status);
  }

  // everything below is for the game's own sites, with a session token
  if (!origin) return reply({ error: 'Not allowed from here' }, 403);
  if (!(await withinLimit(db, `auth:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`, AUTH_PER_MINUTE * 4))) return reply({ error: 'Too many requests. Try again in a minute.' }, 429);
  const body = async (): Promise<Record<string, unknown> | null> => {
    try {
      const b = await request.json();
      return typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  if (path === '/auth/exchange' && method === 'POST') {
    const b = await body();
    const result = b ? await exchangeCode(db, b.code, b.verifier) : null;
    return result ? reply(result) : reply({ error: 'That sign-in code has expired. Try signing in again.' }, 401);
  }
  if (!path.startsWith('/me')) return reply({ error: 'Not found' }, 404);

  const token = bearer(request);
  const user = await authenticate(db, token);
  if (!user || !token) return reply({ error: 'Not signed in' }, 401);

  if (path === '/me' && method === 'GET') return reply({ user: publicUser(user) });
  if (path === '/me' && method === 'DELETE') {
    await deleteAccount(db, user);
    return reply({ ok: true });
  }
  if (path === '/me/logout' && method === 'POST') {
    await logout(db, token);
    return reply({ ok: true });
  }
  if (path === '/me/name' && method === 'PUT') {
    const r = await setName(db, user, (await body())?.name);
    return 'error' in r ? reply({ error: r.error }, r.status) : reply({ name: r.name });
  }
  if (path === '/me/save' && method === 'GET') return reply(await getSave(db, user));
  if (path === '/me/save' && method === 'PUT') {
    const merged = await putSave(db, user, (await body())?.save);
    return typeof merged === 'string' ? reply({ error: merged }, 413) : reply({ save: merged });
  }
  return reply({ error: 'Not found' }, 404);
}
