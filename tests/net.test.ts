import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codeFromInput, newCode, normaliseCode, peerIdFor } from '../src/net/codes';
import { MAX_ATTACK, Msg, parseMessage, PROTOCOL } from '../src/net/protocol';
import { Session } from '../src/net/session';
import { memoryPair } from '../src/net/transport';

describe('protocol: parsing what the network sends', () => {
  it('accepts every well-formed message', () => {
    const good: Msg[] = [
      { t: 'hello', v: PROTOCOL },
      { t: 'start', seed: 123456 },
      { t: 'attack', n: 2 },
      { t: 'over' },
      { t: 'ping' },
      { t: 'state', score: 1200, pending: 3, rows: ['0123401234', '.0123401.'] },
    ];
    for (const m of good) expect(parseMessage(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('rejects things that are not messages', () => {
    for (const bad of [null, undefined, 5, 'attack', [], [{ t: 'over' }], {}, { t: 'nope' }, { t: 42 }]) expect(parseMessage(bad)).toBeNull();
  });

  it('rejects out of range numbers', () => {
    expect(parseMessage({ t: 'attack', n: 0 })).toBeNull();
    expect(parseMessage({ t: 'attack', n: MAX_ATTACK + 1 })).toBeNull();
    expect(parseMessage({ t: 'attack', n: 1.5 })).toBeNull();
    expect(parseMessage({ t: 'attack', n: '2' })).toBeNull();
    expect(parseMessage({ t: 'attack', n: Infinity })).toBeNull();
    expect(parseMessage({ t: 'attack', n: NaN })).toBeNull();
    expect(parseMessage({ t: 'start', seed: -1 })).toBeNull();
    expect(parseMessage({ t: 'start', seed: 2 ** 32 })).toBeNull();
    expect(parseMessage({ t: 'state', score: -5, pending: 0, rows: [] })).toBeNull();
    expect(parseMessage({ t: 'state', score: 5, pending: 100, rows: [] })).toBeNull();
  });

  it('rejects malformed boards', () => {
    const state = (rows: unknown) => parseMessage({ t: 'state', score: 0, pending: 0, rows });
    expect(state('0123')).toBeNull();
    expect(state(Array(21).fill('0'))).toBeNull();
    expect(state(['01234012345'])).toBeNull(); // 11 holds
    expect(state([''])).toBeNull();
    expect(state(['0123x'])).toBeNull();
    expect(state(['5555'])).toBeNull(); // 5 is a shot, never on the wall
    expect(state([123])).toBeNull();
    expect(state(['<script>'])).toBeNull();
  });

  it('copies only the known fields, so extras and prototype tricks are dropped', () => {
    const evil = JSON.parse('{"t":"attack","n":2,"__proto__":{"admin":true},"extra":"x"}');
    const parsed = parseMessage(evil)!;
    expect(parsed).toEqual({ t: 'attack', n: 2 });
    expect(Object.keys(parsed)).toEqual(['t', 'n']);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});

describe('keywords', () => {
  it('makes well-formed, varied keywords', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const code = newCode();
      expect(code).toMatch(/^[A-Z]+-[A-Z]+-\d{2}$/);
      expect(normaliseCode(code)).toBe(code);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(250);
  });

  it('forgives how people type and paste them', () => {
    expect(normaliseCode('  chalk dyno 58 ')).toBe('CHALK-DYNO-58'); // spaces work too
    expect(normaliseCode(' chalk-dyno-58 ')).toBe('CHALK-DYNO-58');
    expect(normaliseCode('chalk dyno-58')).toBe('CHALK-DYNO-58');
    expect(normaliseCode('Chalk_Dyno_58')).toBe('CHALK-DYNO-58');
  });

  it('rejects keywords that could not have been made', () => {
    for (const bad of ['', 'hello', 'CHALK-DYNO', 'CHALK-DYNO-5', 'CHALK-DYNO-588', 'FOO-BAR-12', 'CHALK-DYNO-58; DROP']) expect(normaliseCode(bad)).toBeNull();
  });

  it('finds the keyword in a link', () => {
    expect(codeFromInput('https://example.com/play/?join=CHALK-DYNO-58')).toBe('CHALK-DYNO-58');
    expect(codeFromInput('https://example.com/play/?x=1&join=chalk-dyno-58#top')).toBe('CHALK-DYNO-58');
    expect(codeFromInput('https://example.com/play/?join=nonsense')).toBeNull();
    expect(codeFromInput('CHALK-DYNO-58')).toBe('CHALK-DYNO-58');
  });

  it('namespaces the broker id', () => {
    expect(peerIdFor('CHALK-DYNO-58')).toBe('beta-blast-chalk-dyno-58');
  });
});

describe('session', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pair = () => {
    const [a, b] = memoryPair();
    return { host: new Session('host', 'CHALK-DYNO-58', a, 100), guest: new Session('guest', 'CHALK-DYNO-58', b, 100) };
  };

  it('shakes hands, then delivers messages in order', async () => {
    const { host, guest } = pair();
    await Promise.all([host.ready, guest.ready]);
    const got: Msg[] = [];
    guest.setHandler({ message: (m) => got.push(m) });
    host.send({ t: 'start', seed: 9 });
    host.send({ t: 'attack', n: 1 });
    host.send({ t: 'over' });
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([{ t: 'start', seed: 9 }, { t: 'attack', n: 1 }, { t: 'over' }]);
  });

  it('holds messages that arrive before a scene is listening', async () => {
    const { host, guest } = pair();
    await Promise.all([host.ready, guest.ready]);
    host.send({ t: 'start', seed: 4 });
    host.send({ t: 'attack', n: 2 });
    await vi.advanceTimersByTimeAsync(0);
    const got: Msg[] = [];
    guest.setHandler({ message: (m) => got.push(m) });
    expect(got).toEqual([{ t: 'start', seed: 4 }, { t: 'attack', n: 2 }]);
  });

  it('refuses a player on a different version', async () => {
    const [a, b] = memoryPair();
    const host = new Session('host', 'X', a, 100);
    const closed = vi.fn();
    host.setHandler({ close: closed });
    const outcome = host.ready.catch((e: Error) => e.message);
    b.send({ t: 'hello', v: PROTOCOL + 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toBe('version');
    expect(closed).toHaveBeenCalledWith('version');
  });

  it('ignores game messages that come before hello', async () => {
    const [a, b] = memoryPair();
    const host = new Session('host', 'X', a, 100);
    const got: Msg[] = [];
    host.setHandler({ message: (m) => got.push(m) });
    b.send({ t: 'attack', n: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([]);
  });

  it('tells the other side when a player leaves', async () => {
    const { host, guest } = pair();
    await Promise.all([host.ready, guest.ready]);
    const closed = vi.fn();
    guest.setHandler({ close: closed });
    host.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toHaveBeenCalledWith('left');
    expect(guest.open).toBe(false);
    guest.send({ t: 'over' }); // sending after close is harmless
  });

  it('reports a late-registered handler that the match already ended', async () => {
    const { host, guest } = pair();
    await Promise.all([host.ready, guest.ready]);
    host.close();
    await vi.advanceTimersByTimeAsync(0);
    const closed = vi.fn();
    guest.setHandler({ close: closed });
    expect(closed).toHaveBeenCalledWith('left');
  });

  it('gives up on a player who goes silent', async () => {
    const [a, b] = memoryPair();
    const host = new Session('host', 'X', a, 100);
    const closed = vi.fn();
    host.setHandler({ close: closed });
    b.send({ t: 'hello', v: PROTOCOL });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600); // far longer than 4 heartbeats with nothing heard
    expect(closed).toHaveBeenCalledWith('timeout');
  });

  it('stays alive while pings keep arriving', async () => {
    const { host, guest } = pair();
    await Promise.all([host.ready, guest.ready]);
    const closed = vi.fn();
    host.setHandler({ close: closed });
    await vi.advanceTimersByTimeAsync(3000); // both sides ping every 100ms
    expect(closed).not.toHaveBeenCalled();
    expect(host.open).toBe(true);
  });
});
