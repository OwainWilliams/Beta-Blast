// The player's account, from the game's side: signing in with GitHub or Google, and keeping the save in step with
// the cloud copy. Everything fails quietly, so the game plays on as a guest if the API can't be reached.
//
// Signing in sends the browser away to the provider and back here with "#login=<one-time code>" on the address.
// completeSignIn() swaps that code for a session token, which is kept on this device.
import { API_URL } from '../config';
import { EMPTY_SAVE, sameSave } from './saveMerge';
import type { CloudSave } from './saveMerge';
import { Auth, getAuth, getCloudSave, mergeCloudSave, onSaveChange, setAuth } from './storage';

export type Provider = Auth['provider'];
export const PROVIDER_NAMES: Record<Provider, string> = { github: 'GitHub', google: 'Google' };

const TIMEOUT_MS = 8000;
const SYNC_DELAY_MS = 3000;

// ---------- telling the screens something changed ----------

const listeners: (() => void)[] = [];
/** Run `cb` when signing in or out, or the account's name, changes. Returns a function that stops listening. */
export function onAccountChange(cb: () => void): () => void {
  listeners.push(cb);
  return () => void listeners.splice(listeners.indexOf(cb), 1);
}
const changed = (): void => listeners.slice().forEach((cb) => cb());

let notice = '';
/** A one-off message for the player (such as "Signed in"), shown once. */
export function takeNotice(): string {
  const n = notice;
  notice = '';
  return n;
}

// ---------- talking to the API ----------

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<Result<T>> {
  if (!API_URL) return { ok: false, status: 0, error: 'Accounts are switched off' };
  const token = init.auth === false ? null : getAuth()?.token;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (res.ok && data) return { ok: true, data };
    if (res.status === 401 && token) expireSession();
    return { ok: false, status: res.status, error: typeof data?.error === 'string' ? data.error : 'Something went wrong' };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server" };
  } finally {
    clearTimeout(timer);
  }
}

/** The server no longer knows this device's session: carry on as a guest. */
export function expireSession(): void {
  if (!getAuth()) return;
  setAuth(null);
  notice = 'Your sign-in expired. Sign in again to keep syncing.';
  changed();
}

// ---------- signing in ----------

let providers: Provider[] | null = null;
/** Which sign-in buttons to offer. Empty if the API can't be reached or none are set up. */
export async function availableProviders(): Promise<Provider[]> {
  if (providers) return providers;
  const r = await api<{ providers: Provider[] }>('/auth/providers', { auth: false });
  if (!r.ok || !Array.isArray(r.data.providers)) return [];
  const found = r.data.providers.filter((p): p is Provider => p === 'github' || p === 'google');
  if (found.length) providers = found; // an empty answer isn't kept, so setting sign-in up doesn't need a page reload to show
  return found;
}

const VERIFIER_KEY = 'beta-blast.verifier';
const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Make a secret that only this browser knows, keep it for when the sign-in comes back, and return its SHA-256.
 * The server ties the sign-in to that hash, so a sign-in someone else started can't be finished here (or the reverse).
 */
export async function prepareSignIn(): Promise<string> {
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    localStorage.setItem(VERIFIER_KEY, secret);
  } catch {
    /* storage unavailable: the sign-in will fail when it comes back, with a message */
  }
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
}

/** The address that starts a sign-in, and brings the player back to this page afterwards. */
export const signInAddress = (provider: Provider, challenge: string, page: Pick<Location, 'origin' | 'pathname'> = window.location): string =>
  `${API_URL}/auth/${provider}/start?return_to=${encodeURIComponent(page.origin + page.pathname)}&challenge=${challenge}`;

export async function beginSignIn(provider: Provider): Promise<void> {
  window.location.assign(signInAddress(provider, await prepareSignIn()));
}

/** If the page was opened by coming back from a sign-in, finish it. */
export async function completeSignIn(page: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location, history: Pick<History, 'replaceState'> = window.history): Promise<void> {
  const params = new URLSearchParams(page.hash.replace(/^#/, ''));
  const code = params.get('login');
  const error = params.get('login_error');
  if (!code && !error) return;
  history.replaceState(null, '', page.pathname + page.search); // the code is single-use, but there's no reason to leave it in the address bar
  if (error || !code) {
    notice = error === 'denied' ? 'Sign-in cancelled' : "Couldn't sign in. Please try again.";
    changed();
    return;
  }
  let verifier: string | null = null;
  try {
    verifier = localStorage.getItem(VERIFIER_KEY);
    localStorage.removeItem(VERIFIER_KEY); // each secret is for one sign-in
  } catch {
    /* storage unavailable */
  }
  if (!verifier) {
    notice = "Couldn't finish signing in on this device. Start again from the Account screen.";
    changed();
    return;
  }
  const r = await api<{ token: string; user: { name: string | null; provider: Provider } }>('/auth/exchange', { method: 'POST', body: { code, verifier }, auth: false });
  if (!r.ok) {
    notice = r.error;
    changed();
    return;
  }
  setAuth({ token: r.data.token, name: r.data.user.name, provider: r.data.user.provider });
  notice = `Signed in with ${PROVIDER_NAMES[r.data.user.provider]}`;
  changed();
  await syncNow();
}

// ---------- keeping the save in step ----------

let syncing: Promise<boolean> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Merge the account's save with this device's, in both directions. True if it worked. */
export function syncNow(): Promise<boolean> {
  if (!getAuth()) return Promise.resolve(false);
  if (syncing) {
    again = true; // something changed mid-sync: go round once more afterwards
    return syncing;
  }
  syncing = (async () => {
    let ok = true;
    do {
      again = false;
      ok = (await syncOnce()) && ok;
    } while (again && getAuth());
    return ok;
  })().finally(() => (syncing = null));
  return syncing;
}

async function syncOnce(): Promise<boolean> {
  const me = await api<{ user: { name: string | null; provider: Provider } }>('/me');
  const auth = getAuth();
  if (!me.ok || !auth) return false;
  if (me.data.user.name !== auth.name) {
    setAuth({ ...auth, name: me.data.user.name });
    changed();
  }
  const remote = await api<{ save: CloudSave | null }>('/me/save');
  if (!remote.ok) return false;
  mergeCloudSave(remote.data.save ?? EMPTY_SAVE);
  const local = getCloudSave();
  if (remote.data.save && sameSave(local, remote.data.save)) return true; // nothing the cloud lacks
  const put = await api<{ save: CloudSave }>('/me/save', { method: 'PUT', body: { save: local } });
  if (!put.ok) return false;
  mergeCloudSave(put.data.save);
  return true;
}

/** After the save changes, copy it to the account in a few seconds (once, however many changes there are). */
export function syncSoon(): void {
  if (!getAuth()) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), SYNC_DELAY_MS);
}
onSaveChange(syncSoon);

// ---------- the account itself ----------

/** Choose the leaderboard name for the account. */
export async function chooseName(name: string): Promise<{ ok: boolean; message: string }> {
  const r = await api<{ name: string }>('/me/name', { method: 'PUT', body: { name } });
  if (!r.ok) return { ok: false, message: r.error };
  const auth = getAuth();
  if (auth) setAuth({ ...auth, name: r.data.name });
  changed();
  return { ok: true, message: `You are ${r.data.name}` };
}

/** End this device's session. The save stays on the device. */
export async function signOut(): Promise<void> {
  await api('/me/logout', { method: 'POST' });
  setAuth(null);
  notice = 'Signed out';
  changed();
}

/** Delete the account, its scores and its cloud save. The save on this device stays. */
export async function deleteAccount(): Promise<{ ok: boolean; message: string }> {
  const r = await api('/me', { method: 'DELETE' });
  if (!r.ok) return { ok: false, message: r.error };
  setAuth(null);
  notice = 'Account deleted';
  changed();
  return { ok: true, message: 'Account deleted' };
}

/** Run once when the game starts: finish a sign-in if one just happened, otherwise refresh an existing account. */
export async function startAccount(): Promise<void> {
  if (typeof window === 'undefined') return;
  await completeSignIn();
  if (getAuth()) await syncNow();
}
