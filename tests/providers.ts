// A pretend GitHub and Google, for tests of sign-in. Codes "gh-good" and "gh-other" are two different GitHub people
// and "g-good" is a Google person; any other code is refused.
import { expect, vi } from 'vitest';

const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;
const people: Record<string, string> = { 'gh-good': '1001', 'gh-other': '1002', 'g-good': 'google-sub-1' };

/** Change what Google's token says (a wrong audience, say) to check the Worker turns it down. */
export const googleClaims: { override: Record<string, unknown> } = { override: {} };

export function fakeProviders(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(String(init?.body));
      expect(body.client_secret).toBe('ghsecret');
      return Response.json(people[body.code]?.startsWith('1') ? { access_token: `tok-${body.code}` } : { error: 'bad_verification_code' });
    }
    if (url === 'https://api.github.com/user') {
      const code = String((init?.headers as Record<string, string>).Authorization).replace('Bearer tok-', '');
      return Response.json({ id: Number(people[code]), login: 'secret-login' });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('code') !== 'g-good') return Response.json({ error: 'invalid_grant' });
      return Response.json({ id_token: jwt({ iss: 'https://accounts.google.com', aud: 'gid', sub: people['g-good'], exp: Math.floor(Date.now() / 1000) + 600, ...googleClaims.override }) });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}
