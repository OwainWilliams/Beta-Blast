// A short-lived memory of expensive answers, kept in the running Worker instance. Unlike Cloudflare's edge cache
// (which does nothing on *.workers.dev addresses) this works wherever the Worker runs. Each instance has its own,
// and an answer is at most `ttlMs` old, so it only ever makes a leaderboard a little late.
import type { D1 } from './db';

interface Entry<T> {
  at: number;
  value: Promise<T>;
}
const caches = new WeakMap<object, Map<string, Entry<unknown>>>();

/** `make()`'s answer for `key`, reused for `ttlMs`. Requests that arrive while it is being worked out share that one call. */
export function memo<T>(db: D1, key: string, ttlMs: number, make: () => Promise<T>, now = Date.now()): Promise<T> {
  let mine = caches.get(db);
  if (!mine) caches.set(db, (mine = new Map()));
  const hit = mine.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < ttlMs && now >= hit.at) return hit.value;
  const value = make();
  mine.set(key, { at: now, value });
  value.catch(() => mine!.delete(key)); // never keep a failure
  return value;
}

/** Forget everything remembered for this database, after something changed that the answers depend on. */
export function forget(db: D1): void {
  caches.delete(db);
}
