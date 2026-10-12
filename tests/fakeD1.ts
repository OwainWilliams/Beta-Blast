import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** D1's interface on top of node's SQLite, so the real SQL in the Worker runs against the real schema. */
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('worker/schema.sql', 'utf8'));
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const st = {
      bind: (...a: unknown[]) => ((args = a), st),
      first: async () => (db.prepare(sql).get(...(args as never[])) as never) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...(args as never[])) as never[] }),
      run: async () => void db.prepare(sql).run(...(args as never[])),
    };
    return st;
  };
  return { prepare };
}

