import { Msg, PROTOCOL } from './protocol';
import { Transport } from './transport';

export type CloseReason = 'left' | 'timeout' | 'version' | 'self';

export interface SessionHandler {
  message?(msg: Msg): void;
  close?(reason: CloseReason): void;
}

/**
 * One match between two players. It outlives scene changes (lobby, game, rematch), so messages that
 * arrive while no scene is listening are held and handed over as soon as one is.
 */
export class Session {
  readonly ready: Promise<void>; // resolves when the other side has said hello in our version
  private handler: SessionHandler | null = null;
  private buffered: Msg[] = [];
  private closedReason: CloseReason | null = null;
  private lastSeen = Date.now();
  private helloSeen = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private markReady!: () => void;
  private markFailed!: (e: Error) => void;

  constructor(readonly role: 'host' | 'guest', readonly code: string, private readonly transport: Transport, heartbeatMs = 3000) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.markReady = resolve;
      this.markFailed = reject;
    });
    this.ready.catch(() => undefined); // the lobby handles it; don't leave an unhandled rejection behind
    transport.onMessage((m) => this.receive(m));
    transport.onClose(() => this.finish('left'));
    this.send({ t: 'hello', v: PROTOCOL });
    this.timer = setInterval(() => {
      this.send({ t: 'ping' });
      if (Date.now() - this.lastSeen > heartbeatMs * 4) this.finish('timeout');
    }, heartbeatMs);
  }

  setHandler(handler: SessionHandler | null): void {
    this.handler = handler;
    if (!handler) return;
    if (handler.message) {
      const queued = this.buffered;
      this.buffered = [];
      queued.forEach((m) => handler.message!(m));
    }
    if (this.closedReason && handler.close) handler.close(this.closedReason);
  }

  send(msg: Msg): void {
    if (!this.closedReason) this.transport.send(msg);
  }

  get open(): boolean {
    return !this.closedReason;
  }

  close(): void {
    if (this.closedReason) return;
    this.transport.close();
    this.finish('self');
  }

  private receive(m: Msg): void {
    this.lastSeen = Date.now();
    if (m.t === 'ping') return;
    if (m.t === 'hello') {
      if (m.v !== PROTOCOL) {
        this.markFailed(new Error('version'));
        this.transport.close();
        this.finish('version');
      } else if (!this.helloSeen) {
        this.helloSeen = true;
        this.markReady();
      }
      return;
    }
    if (!this.helloSeen) return; // nothing counts before the handshake
    if (this.handler?.message) this.handler.message(m);
    else this.buffered.push(m);
  }

  private finish(reason: CloseReason): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    clearInterval(this.timer);
    this.markFailed(new Error(reason));
    this.handler?.close?.(reason);
  }
}
