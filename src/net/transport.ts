// How two players' browsers talk. Three interchangeable transports behind one small interface:
//   - peer:   WebRTC through PeerJS (the real one, works across the internet)
//   - local:  BroadcastChannel between two tabs of the same browser (play on one device, and testing)
//   - memory: in-process pair, for unit tests
import Peer, { DataConnection, PeerError } from 'peerjs';
import { newCode, peerIdFor } from './codes';
import { Msg, parseMessage } from './protocol';

export interface Transport {
  send(msg: Msg): void;
  onMessage(cb: (msg: Msg) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export type NetKind = 'peer' | 'local';
export type ConnectFailure = 'not-found' | 'timeout' | 'network' | 'unsupported';

export class ConnectError extends Error {
  constructor(readonly reason: ConnectFailure) {
    super(reason);
  }
}

export const FAILURE_TEXT: Record<ConnectFailure, string> = {
  'not-found': "Couldn't find a game with that keyword. Check it and try again.",
  timeout: "Couldn't connect in time. Some networks block direct connections between players.",
  network: "Couldn't reach the matchmaking service. Check your connection.",
  unsupported: "This browser can't make direct connections.",
};

export interface HostHandle {
  code: string;
  accepted: Promise<Transport>; // resolves when a guest connects
  cancel(): void;
}

const CONNECT_TIMEOUT_MS = 15000;

// ---------- memory ----------

/** Two linked transports in one process. Messages take a trip through JSON, like the wire. */
export function memoryPair(): [Transport, Transport] {
  const make = () => ({ msg: [] as ((m: Msg) => void)[], close: [] as (() => void)[], closed: false });
  const a = make();
  const b = make();
  const end = (me: ReturnType<typeof make>, other: ReturnType<typeof make>): Transport => ({
    send(msg) {
      if (me.closed || other.closed) return;
      const wire = JSON.parse(JSON.stringify(msg));
      queueMicrotask(() => {
        const parsed = parseMessage(wire);
        if (parsed) other.msg.forEach((cb) => cb(parsed));
      });
    },
    onMessage: (cb) => void me.msg.push(cb),
    onClose: (cb) => void me.close.push(cb),
    close() {
      if (me.closed) return;
      me.closed = true;
      other.closed = true;
      queueMicrotask(() => [...me.close, ...other.close].forEach((cb) => cb()));
    },
  });
  return [end(a, b), end(b, a)];
}

// ---------- local (two tabs) ----------

type LocalWire = { k: 'join'; id: string } | { k: 'welcome'; to: string; id: string } | { k: 'msg'; to: string; msg: unknown } | { k: 'bye'; to: string };
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

class LocalTransport implements Transport {
  private msgCbs: ((m: Msg) => void)[] = [];
  private closeCbs: (() => void)[] = [];
  private closed = false;
  private readonly onUnload = () => this.close();

  constructor(private readonly ch: BroadcastChannel, me: string, private readonly peer: string) {
    ch.onmessage = (e: MessageEvent<LocalWire>) => {
      const d = e.data;
      if (!d || d.k === 'join' || d.k === 'welcome' || d.to !== me) return;
      if (d.k === 'bye') return this.end();
      const m = parseMessage(d.msg);
      if (m) this.msgCbs.forEach((cb) => cb(m));
    };
    window.addEventListener('pagehide', this.onUnload);
  }
  send(msg: Msg): void {
    if (!this.closed) this.ch.postMessage({ k: 'msg', to: this.peer, msg } satisfies LocalWire);
  }
  onMessage(cb: (m: Msg) => void): void {
    this.msgCbs.push(cb);
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }
  close(): void {
    if (this.closed) return;
    this.ch.postMessage({ k: 'bye', to: this.peer } satisfies LocalWire);
    this.end();
  }
  private end(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('pagehide', this.onUnload);
    this.ch.close();
    this.closeCbs.forEach((cb) => cb());
  }
}

const channelName = (code: string) => `beta-blast-local-${code}`;

function hostLocal(): HostHandle {
  const code = newCode();
  const ch = new BroadcastChannel(channelName(code));
  const me = randomId();
  const accepted = new Promise<Transport>((resolve) => {
    ch.onmessage = (e: MessageEvent<LocalWire>) => {
      if (e.data?.k !== 'join') return;
      ch.postMessage({ k: 'welcome', to: e.data.id, id: me } satisfies LocalWire);
      resolve(new LocalTransport(ch, me, e.data.id));
    };
  });
  return { code, accepted, cancel: () => ch.close() };
}

function joinLocal(code: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(channelName(code));
    const me = randomId();
    const timer = setTimeout(() => {
      ch.close();
      reject(new ConnectError('not-found'));
    }, 2500);
    ch.onmessage = (e: MessageEvent<LocalWire>) => {
      if (e.data?.k !== 'welcome' || e.data.to !== me) return;
      clearTimeout(timer);
      resolve(new LocalTransport(ch, me, e.data.id));
    };
    ch.postMessage({ k: 'join', id: me } satisfies LocalWire);
  });
}

// ---------- peer (WebRTC through PeerJS) ----------

/**
 * Matchmaking uses PeerJS's free public broker unless you point the build at your own:
 * set VITE_PEER_HOST (and optionally VITE_PEER_PORT, VITE_PEER_PATH, VITE_PEER_SECURE=false).
 */
function peerOptions() {
  const env = import.meta.env;
  if (!env.VITE_PEER_HOST) return {};
  return {
    host: env.VITE_PEER_HOST as string,
    port: Number(env.VITE_PEER_PORT) || 443,
    path: (env.VITE_PEER_PATH as string) || '/',
    secure: env.VITE_PEER_SECURE !== 'false',
  };
}

class PeerTransport implements Transport {
  private msgCbs: ((m: Msg) => void)[] = [];
  private closeCbs: (() => void)[] = [];
  private closed = false;

  constructor(private readonly peer: Peer, private readonly conn: DataConnection) {
    conn.on('data', (data) => {
      const m = parseMessage(data);
      if (m) this.msgCbs.forEach((cb) => cb(m));
    });
    conn.on('close', () => this.end());
    conn.on('error', () => this.end());
    peer.on('error', () => this.end());
  }
  send(msg: Msg): void {
    if (this.closed) return;
    try {
      this.conn.send(msg);
    } catch {
      /* the connection is going away; the close handler will tell us */
    }
  }
  onMessage(cb: (m: Msg) => void): void {
    this.msgCbs.push(cb);
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }
  close(): void {
    this.end();
  }
  private end(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.close();
      this.peer.destroy();
    } catch {
      /* already gone */
    }
    this.closeCbs.forEach((cb) => cb());
  }
}

const failureFor = (err: PeerError<string>): ConnectFailure => {
  switch (err.type) {
    case 'peer-unavailable':
      return 'not-found';
    case 'browser-incompatible':
      return 'unsupported';
    default:
      return 'network';
  }
};

/** Register a fresh keyword with the broker, retrying if someone else is already using it. */
async function hostPeer(): Promise<HostHandle> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    const peer = new Peer(peerIdFor(code), peerOptions());
    const outcome = await new Promise<'open' | ConnectFailure | 'taken'>((resolve) => {
      peer.on('open', () => resolve('open'));
      peer.on('error', (err) => resolve(err.type === 'unavailable-id' ? 'taken' : failureFor(err)));
      setTimeout(() => resolve('network'), CONNECT_TIMEOUT_MS);
    });
    if (outcome === 'taken') {
      peer.destroy();
      continue;
    }
    if (outcome !== 'open') {
      peer.destroy();
      throw new ConnectError(outcome);
    }
    const accepted = new Promise<Transport>((resolve) => {
      let taken = false;
      peer.on('connection', (conn) => {
        if (taken) return conn.close(); // one opponent only
        taken = true;
        conn.on('open', () => resolve(new PeerTransport(peer, conn)));
      });
    });
    return { code, accepted, cancel: () => peer.destroy() };
  }
  throw new ConnectError('network');
}

async function joinPeer(code: string): Promise<Transport> {
  const peer = new Peer(peerOptions());
  try {
    await new Promise<void>((resolve, reject) => {
      peer.on('open', () => resolve());
      peer.on('error', (err) => reject(new ConnectError(failureFor(err))));
      setTimeout(() => reject(new ConnectError('network')), CONNECT_TIMEOUT_MS);
    });
    return await new Promise<Transport>((resolve, reject) => {
      const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
      peer.on('error', (err) => reject(new ConnectError(failureFor(err))));
      conn.on('open', () => resolve(new PeerTransport(peer, conn)));
      setTimeout(() => reject(new ConnectError('timeout')), CONNECT_TIMEOUT_MS);
    });
  } catch (e) {
    peer.destroy();
    throw e;
  }
}

// ---------- entry points ----------

export function hostGame(kind: NetKind): Promise<HostHandle> {
  return kind === 'local' ? Promise.resolve(hostLocal()) : hostPeer();
}

export function joinGame(kind: NetKind, code: string): Promise<Transport> {
  return kind === 'local' ? joinLocal(code) : joinPeer(code);
}
