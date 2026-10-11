// Messages two players send each other. Anything that arrives from the network is untrusted, so
// parseMessage rebuilds each message field by field and rejects anything out of range.

export const PROTOCOL = 1;

export type Msg =
  | { t: 'hello'; v: number } // first message each way; checks both sides speak the same version
  | { t: 'start'; seed: number } // host starts a round (or a rematch) on this seed
  | { t: 'state'; score: number; pending: number; rows: string[] } // my wall, for the opponent's mini view
  | { t: 'attack'; n: number } // rows heading your way
  | { t: 'over' } // I lost
  | { t: 'ping' };

export const MAX_ATTACK = 4; // per message; a bigger number is a bug or cheating
export const MAX_ROWS = 20;
const ROW = /^[0-467.]{1,10}$/; // colours 0-4, volume 6, slick 7, empty .

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function parseMessage(raw: unknown): Msg | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return isInt(m.v, 0, 1000) ? { t: 'hello', v: m.v } : null;
    case 'start':
      return isInt(m.seed, 0, 0xffffffff) ? { t: 'start', seed: m.seed } : null;
    case 'attack':
      return isInt(m.n, 1, MAX_ATTACK) ? { t: 'attack', n: m.n } : null;
    case 'over':
      return { t: 'over' };
    case 'ping':
      return { t: 'ping' };
    case 'state': {
      if (!isInt(m.score, 0, 1e9) || !isInt(m.pending, 0, 99)) return null;
      if (!Array.isArray(m.rows) || m.rows.length > MAX_ROWS) return null;
      const rows: string[] = [];
      for (const r of m.rows) {
        if (typeof r !== 'string' || !ROW.test(r)) return null;
        rows.push(r);
      }
      return { t: 'state', score: m.score, pending: m.pending, rows };
    }
    default:
      return null;
  }
}
