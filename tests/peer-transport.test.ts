// The real PeerJS transport, run against a small in-memory stand-in for PeerJS and its matchmaking service.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { peerIdFor } from '../src/net/codes';
import { Msg } from '../src/net/protocol';
import { ConnectError, hostGame, joinGame, Transport } from '../src/net/transport';

const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class Emitter {
    private handlers = new Map<string, Handler[]>();
    on(event: string, cb: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers.get(event) ?? []) cb(...args);
    }
  }

  const state = { registry: new Map<string, FakePeer>(), brokerDown: false, takenBeforeFree: 0, counter: 0 };

  class FakeConn extends Emitter {
    other: FakeConn | null = null;
    isOpen = false;
    refused = false; // closed by the host before it ever opened
    send(msg: unknown) {
      const wire = JSON.parse(JSON.stringify(msg));
      queueMicrotask(() => this.other?.emit('data', wire));
    }
    close() {
      if (!this.isOpen) {
        this.refused = true;
        return;
      }
      this.isOpen = false;
      queueMicrotask(() => {
        this.emit('close');
        const o = this.other;
        if (o?.isOpen) {
          o.isOpen = false;
          o.emit('close');
        }
      });
    }
  }

  class FakePeer extends Emitter {
    destroyed = false;
    reconnects = 0;
    id: string;
    constructor(first?: unknown) {
      super();
      this.id = typeof first === 'string' ? first : `guest-${++state.counter}`;
      queueMicrotask(() => {
        if (state.brokerDown) return this.emit('error', { type: 'network' });
        if (typeof first === 'string' && (state.takenBeforeFree > 0 || state.registry.has(first))) {
          state.takenBeforeFree = Math.max(0, state.takenBeforeFree - 1);
          return this.emit('error', { type: 'unavailable-id' });
        }
        if (typeof first === 'string') state.registry.set(first, this);
        this.emit('open', this.id);
      });
    }
    connect(id: string) {
      const mine = new FakeConn();
      queueMicrotask(() => {
        const target = state.registry.get(id);
        if (!target) return this.emit('error', { type: 'peer-unavailable' });
        const theirs = new FakeConn();
        mine.other = theirs;
        theirs.other = mine;
        target.emit('connection', theirs);
        queueMicrotask(() => {
          if (theirs.refused) return; // the host turned us away, so we never open
          mine.isOpen = theirs.isOpen = true;
          theirs.emit('open');
          mine.emit('open');
        });
      });
      return mine;
    }
    destroy() {
      this.destroyed = true;
      state.registry.delete(this.id);
    }
    reconnect() {
      this.reconnects++;
    }
  }
  return { FakePeer, state };
});

vi.mock('peerjs', () => ({ default: fake.FakePeer }));

const flush = () => vi.advanceTimersByTimeAsync(0);
const received = (t: Transport) => {
  const got: Msg[] = [];
  t.onMessage((m) => got.push(m));
  return got;
};

describe('peer transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.state.registry.clear();
    fake.state.brokerDown = false;
    fake.state.takenBeforeFree = 0;
  });
  afterEach(() => vi.useRealTimers());

  /** Host a game and join it, returning both ends. */
  async function connect() {
    const hostP = hostGame('peer');
    await flush();
    const host = await hostP;
    const guestP = joinGame('peer', host.code);
    await flush();
    const [guest, hostEnd] = await Promise.all([guestP, host.accepted]);
    await flush();
    return { host, guest, hostEnd };
  }

  it('connects a host and a guest and carries messages both ways', async () => {
    const { guest, hostEnd } = await connect();
    const atHost = received(hostEnd);
    const atGuest = received(guest);
    guest.send({ t: 'attack', n: 2 });
    hostEnd.send({ t: 'start', seed: 42 });
    await flush();
    expect(atHost).toEqual([{ t: 'attack', n: 2 }]);
    expect(atGuest).toEqual([{ t: 'start', seed: 42 }]);
  });

  it('drops anything the other side sends that is not a valid message', async () => {
    const { guest, hostEnd } = await connect();
    const atHost = received(hostEnd);
    // reach under the transport and put junk on the wire
    (guest as unknown as { conn: { send(m: unknown): void } }).conn.send({ t: 'attack', n: 9999 });
    (guest as unknown as { conn: { send(m: unknown): void } }).conn.send('<script>');
    (guest as unknown as { conn: { send(m: unknown): void } }).conn.send({ t: 'attack', n: 1 });
    await flush();
    expect(atHost).toEqual([{ t: 'attack', n: 1 }]);
  });

  it('says so when nobody is hosting that keyword', async () => {
    const attempt = joinGame('peer', 'CHALK-DYNO-58').catch((e) => e);
    await flush();
    const err = await attempt;
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).reason).toBe('not-found');
  });

  it('picks another keyword if the first is taken', async () => {
    fake.state.takenBeforeFree = 3;
    const p = hostGame('peer');
    await flush();
    const host = await p;
    expect(fake.state.registry.has(peerIdFor(host.code))).toBe(true);
  });

  it('gives up if no keyword can be registered', async () => {
    fake.state.takenBeforeFree = 99;
    const p = hostGame('peer').catch((e) => e);
    await flush();
    expect(((await p) as ConnectError).reason).toBe('network');
  });

  it('reports an unreachable matchmaking service, for hosts and guests', async () => {
    fake.state.brokerDown = true;
    const host = hostGame('peer').catch((e) => e);
    const guest = joinGame('peer', 'CHALK-DYNO-58').catch((e) => e);
    await flush();
    expect(((await host) as ConnectError).reason).toBe('network');
    expect(((await guest) as ConnectError).reason).toBe('network');
  });

  it('times out instead of waiting for ever', async () => {
    // a matchmaker that never answers
    const original = fake.state.brokerDown;
    const never = vi.spyOn(fake.FakePeer.prototype, 'on');
    never.mockImplementation(function (this: unknown) {
      return this as never; // swallow every listener, so 'open' is never seen
    });
    const p = hostGame('peer').catch((e) => e);
    await vi.advanceTimersByTimeAsync(16000);
    expect(((await p) as ConnectError).reason).toBe('network');
    never.mockRestore();
    fake.state.brokerDown = original;
  });

  it('lets only one opponent in', async () => {
    const { host, hostEnd } = await connect();
    const second = joinGame('peer', host.code).catch((e) => e);
    await vi.advanceTimersByTimeAsync(16000);
    expect(await second).toBeInstanceOf(ConnectError); // refused, so it never opens
    expect(hostEnd).toBeDefined();
  });

  it('keeps a live match going when the matchmaking connection has trouble', async () => {
    const { host, guest, hostEnd } = await connect();
    const closed = vi.fn();
    hostEnd.onClose(closed);
    const hostPeer = fake.state.registry.get(peerIdFor(host.code))!;
    for (const type of ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']) hostPeer.emit('error', { type });
    await flush();
    expect(closed).not.toHaveBeenCalled();
    const atGuest = received(guest);
    hostEnd.send({ t: 'attack', n: 1 });
    await flush();
    expect(atGuest).toEqual([{ t: 'attack', n: 1 }]);
  });

  it('does end the match on a real connection failure', async () => {
    const { host, hostEnd } = await connect();
    const closed = vi.fn();
    hostEnd.onClose(closed);
    fake.state.registry.get(peerIdFor(host.code))!.emit('error', { type: 'webrtc' });
    await flush();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('tells the other player when one side closes', async () => {
    const { guest, hostEnd } = await connect();
    const closed = vi.fn();
    hostEnd.onClose(closed);
    guest.close();
    await flush();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('re-registers the keyword if the matchmaking connection drops while waiting', async () => {
    const hostP = hostGame('peer');
    await flush();
    const host = await hostP;
    const peer = fake.state.registry.get(peerIdFor(host.code))!;
    peer.emit('disconnected');
    expect(peer.reconnects).toBe(1);
    host.cancel();
    peer.emit('disconnected');
    expect(peer.reconnects).toBe(1); // not once we have cancelled
  });

  it('frees the keyword when the host cancels', async () => {
    const p = hostGame('peer');
    await flush();
    const host = await p;
    host.cancel();
    expect(fake.state.registry.has(peerIdFor(host.code))).toBe(false);
  });

  it('leaves no timers running once connected', async () => {
    await connect();
    expect(vi.getTimerCount()).toBe(0);
  });
});
