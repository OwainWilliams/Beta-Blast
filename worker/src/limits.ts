import type { D1 } from './db';

/** Count a call against `key` (an address, say) for the current minute. False once it is over `limit`. */
export async function withinLimit(db: D1, key: string, limit: number): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const row = await db
    .prepare('INSERT INTO hits (ip, minute, n) VALUES (?1, ?2, 1) ON CONFLICT (ip, minute) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(key, minute)
    .first<{ n: number }>();
  if (Math.random() < 0.02) await db.prepare('DELETE FROM hits WHERE minute < ?1').bind(minute - 5).run(); // tidy up now and then
  return (row?.n ?? 1) <= limit;
}
