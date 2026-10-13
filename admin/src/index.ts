// The Beta Blast admin area: a small Worker on its own address, behind Cloudflare Access, that can remove or rename
// fake and offensive names. It shares the game's database but is separate from the public API, so the public API
// has no admin routes at all. Setup: docs/admin.md.
import { ADMIN_PAGE } from './page';
import { verifyAccess, AccessEnv } from './access';
import { arcadeWeek } from '../../src/game/arcade';
import type { D1 } from '../../worker/src/db';
import { listArcade, listAudit, listBans, listPlayers, removeAccount, removeArcadeRun, removePlayer, renamePlayer, undo, unban } from '../../worker/src/moderation';

export interface Env extends AccessEnv {
  DB: D1;
}

const SECURITY = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: SECURITY });
    const admin = await verifyAccess(request, env);
    if ('error' in admin) return reply({ error: admin.error }, admin.status);

    if (request.method === 'GET' && url.pathname === '/') {
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      return new Response(ADMIN_PAGE.split('__NONCE__').join(nonce).split('__EMAIL__').join(admin.email.replace(/[<>&"']/g, '')), {
        headers: { ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` },
      });
    }

    if (request.method === 'GET') {
      const q = url.searchParams;
      switch (url.pathname) {
        case '/api/players':
          return reply({ players: await listPlayers(env.DB, (q.get('q') ?? '').slice(0, 40), Number(q.get('offset') ?? 0) || 0) });
        case '/api/arcade': {
          const week = /^\d{4}-\d{2}-\d{2}$/.test(q.get('week') ?? '') ? q.get('week')! : arcadeWeek();
          return reply({ week, runs: await listArcade(env.DB, week) });
        }
        case '/api/bans':
          return reply(await listBans(env.DB));
        case '/api/audit':
          return reply({ entries: await listAudit(env.DB) });
      }
      return reply({ error: 'Not found' }, 404);
    }

    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    // Changes must come from this page itself, not another site that borrows the admin's logged-in browser.
    if (request.headers.get('Origin') !== url.origin || !(request.headers.get('Content-Type') ?? '').startsWith('application/json')) return reply({ error: 'Not allowed from here' }, 403);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
      if (typeof body !== 'object' || body === null) throw new Error();
    } catch {
      return reply({ error: 'Bad request' }, 400);
    }
    const who = admin.email;
    const name = str(body.name, 40);
    const reason = typeof body.reason === 'string' ? body.reason : '';
    switch (url.pathname) {
      case '/api/players/remove':
        return name ? reply(await removePlayer(env.DB, who, name, { ban: body.ban === true, reason })) : reply({ error: 'Name needed' }, 400);
      case '/api/players/rename': {
        if (!name) return reply({ error: 'Name needed' }, 400);
        const r = await renamePlayer(env.DB, who, name, typeof body.to === 'string' ? body.to : undefined);
        return 'error' in r ? reply(r, 409) : reply(r);
      }
      case '/api/accounts/delete': {
        if (!name) return reply({ error: 'Name needed' }, 400);
        const r = await removeAccount(env.DB, who, name, { ban: body.ban === true, reason });
        return r.ok ? reply(r) : reply(r, 404);
      }
      case '/api/arcade/remove':
        return Number.isInteger(body.id) ? reply(await removeArcadeRun(env.DB, who, body.id as number)) : reply({ error: 'Id needed' }, 400);
      case '/api/bans/remove':
        if (!name) return reply({ error: 'Name needed' }, 400);
        await unban(env.DB, who, name);
        return reply({ ok: true });
      case '/api/audit/undo': {
        if (!Number.isInteger(body.id)) return reply({ error: 'Id needed' }, 400);
        const r = await undo(env.DB, who, body.id as number);
        return r.ok ? reply(r) : reply(r, 409);
      }
    }
    return reply({ error: 'Not found' }, 404);
  },
};
