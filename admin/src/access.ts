// Cloudflare Access sits in front of the admin Worker and only lets signed-in people through. It adds a signed token
// (a JWT) to each request. This checks that token too, so the admin Worker also refuses everyone if Access was ever
// switched off or set up wrongly: it fails closed.

export interface AccessEnv {
  /** Your Zero Trust team domain, like "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** The "Application Audience (AUD) tag" of the Access application. */
  ACCESS_AUD?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}
const TEAM = /^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/;
const KEYS_MS = 10 * 60_000;
let cache: { team: string; at: number; keys: Jwk[] } | null = null;

const decode = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (s: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(new TextDecoder().decode(decode(s)));
    return typeof v === 'object' && v !== null ? v : null;
  } catch {
    return null;
  }
};

async function keysFor(team: string, now: number): Promise<Jwk[]> {
  if (cache && cache.team === team && now - cache.at < KEYS_MS) return cache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Could not fetch the Access keys');
  const body = (await res.json()) as { keys?: Jwk[] };
  cache = { team, at: now, keys: Array.isArray(body.keys) ? body.keys : [] };
  return cache.keys;
}

export interface Admin {
  email: string;
}

/** The signed-in admin behind a request, or why not. */
export async function verifyAccess(request: Request, env: AccessEnv, now = Date.now()): Promise<Admin | { error: string; status: number }> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '');
  const aud = env.ACCESS_AUD?.trim();
  if (!team || !aud || !TEAM.test(team)) return { error: 'The admin area is not set up yet (see docs/admin.md)', status: 503 };
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const parts = token?.split('.') ?? [];
  if (parts.length !== 3) return { error: 'Sign in through Cloudflare Access', status: 401 };
  const header = json(parts[0]);
  const claims = json(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return { error: 'Bad token', status: 401 };
  try {
    const jwk = (await keysFor(team, now)).find((k) => k.kid === header.kid);
    if (!jwk) return { error: 'Unknown key', status: 401 };
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return { error: 'Bad signature', status: 401 };
  } catch {
    return { error: 'Could not check the token', status: 401 };
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${team}` || !audience.includes(aud)) return { error: 'Token is for another application', status: 403 };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return { error: 'Token expired. Reload the page', status: 401 };
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 > now + 60_000) return { error: 'Token not valid yet', status: 401 };
  const email = typeof claims.email === 'string' && claims.email ? claims.email : typeof claims.common_name === 'string' ? `service:${claims.common_name}` : null;
  return email ? { email } : { error: 'No identity in the token', status: 403 };
}

/** For tests: forget the downloaded keys. */
export const forgetKeys = (): void => void (cache = null);
