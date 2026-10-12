import Phaser from 'phaser';
import { WIDTH } from '../config';
import { versusLevel } from '../game/levels';
import { unlockAudio } from '../game/audio';
import { codeFromInput, linkFor, normaliseCode } from '../net/codes';
import { Session } from '../net/session';
import { ConnectError, FAILURE_TEXT, HostHandle, hostGame, joinGame, NetKind } from '../net/transport';
import { copyToClipboard, makeButton, txt } from '../ui';

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

/** Where two players find each other: one hosts and shares a keyword or link, the other joins. */
export class LobbyScene extends Phaser.Scene {
  private ui!: Phaser.GameObjects.Container;
  private session: Session | null = null;
  private host: HostHandle | null = null;
  private joinCode: string | undefined;
  private gone = false; // set once we have left, so late callbacks do nothing

  constructor() {
    super('Lobby');
  }

  init(data: { join?: string }): void {
    this.joinCode = data?.join;
  }

  create(): void {
    this.gone = false;
    this.session = null;
    this.host = null;
    this.add.image(0, 0, 'wall').setOrigin(0);
    txt(this, WIDTH / 2, 90, '2 PLAYER', 46, '#ffd166');
    txt(this, WIDTH / 2, 138, 'Race a friend. Your pops send them rows.', 16, '#c9d1ee', false);
    this.events.once('shutdown', () => {
      this.gone = true;
    });
    if (this.joinCode) this.showConfirm(this.joinCode);
    else this.showMenu();
  }

  // ---------- screens ----------

  /** Replace whatever is showing. */
  private screen(build: (add: (o: Phaser.GameObjects.GameObject) => void) => void): void {
    this.ui?.destroy();
    this.ui = this.add.container(0, 0);
    build((o) => this.ui.add(o));
  }

  private showMenu(): void {
    this.screen((add) => {
      add(makeButton(this, WIDTH / 2, 240, 320, 58, 'Host a game', () => void this.hostFlow('peer'), 0x2e8b57, 22));
      add(txt(this, WIDTH / 2, 282, 'You get a keyword and a link to share', 13, '#9aa6cf', false));
      add(makeButton(this, WIDTH / 2, 340, 320, 58, 'Join a game', () => this.askKeyword('peer'), 0x2f6fdd, 22));
      add(txt(this, WIDTH / 2, 382, 'Enter the keyword from your friend', 13, '#9aa6cf', false));
      add(txt(this, WIDTH / 2, 450, 'On one device? Open the game in two tabs:', 14, '#9aa6cf', false));
      add(makeButton(this, 150, 492, 230, 44, 'Host in this tab', () => void this.hostFlow('local'), 0x59627f, 16));
      add(makeButton(this, 390, 492, 230, 44, 'Join from another tab', () => this.askKeyword('local'), 0x59627f, 16));
      add(makeButton(this, WIDTH / 2, 640, 220, 48, 'Back', () => this.scene.start('Menu'), 0x59627f, 20));
      add(txt(this, WIDTH / 2, 690, 'Players connect directly. Needs a connection that allows it.', 12, '#7f8bb0', false));
    });
  }

  private showMessage(title: string, body: string, retry?: () => void): void {
    this.screen((add) => {
      add(txt(this, WIDTH / 2, 280, title, 28));
      add(txt(this, WIDTH / 2, 350, body, 16, '#c9d1ee', false).setWordWrapWidth(420));
      if (retry) add(makeButton(this, WIDTH / 2, 470, 260, 50, 'Try again', retry, 0x2f6fdd));
      add(makeButton(this, WIDTH / 2, retry ? 535 : 470, 260, 50, 'Back', () => this.leaveToMenu(), 0x59627f));
    });
  }

  private showConfirm(code: string): void {
    this.screen((add) => {
      add(txt(this, WIDTH / 2, 260, 'Join this game?', 26));
      add(txt(this, WIDTH / 2, 320, code, 34, '#ffd166'));
      add(txt(this, WIDTH / 2, 370, "You'll connect directly to whoever is hosting it.", 14, '#9aa6cf', false));
      add(makeButton(this, WIDTH / 2, 450, 260, 54, 'Join', () => void this.joinFlow('peer', code), 0x2e8b57, 22));
      add(makeButton(this, WIDTH / 2, 520, 260, 50, 'Cancel', () => this.leaveToMenu(), 0x59627f));
    });
  }

  // ---------- host ----------

  private async hostFlow(kind: NetKind): Promise<void> {
    unlockAudio();
    this.showMessage('Setting up…', 'Getting a keyword for your game.');
    let handle: HostHandle;
    try {
      handle = await hostGame(kind);
    } catch (e) {
      if (this.gone) return;
      return this.showMessage("Couldn't host", FAILURE_TEXT[e instanceof ConnectError ? e.reason : 'network'], () => void this.hostFlow(kind));
    }
    if (this.gone) return handle.cancel();
    this.host = handle;
    this.showWaiting(handle.code, kind);
    handle.accepted.then((transport) => {
      if (this.gone) return transport.close();
      const session = new Session('host', handle.code, transport);
      this.session = session;
      this.showOpponentJoining(session);
      session.ready.then(
        () => !this.gone && this.showReady(session),
        () => !this.gone && this.showMessage('Connection failed', 'The other player is on a different version of the game.'),
      );
      session.setHandler({ close: () => !this.gone && this.showMessage('Opponent left', 'They disconnected before the game started.') });
    });
  }

  private showWaiting(code: string, kind: NetKind): void {
    this.screen((add) => {
      add(txt(this, WIDTH / 2, 215, 'Your keyword', 18, '#9aa6cf'));
      add(txt(this, WIDTH / 2, 275, code, 40, '#ffd166'));
      add(txt(this, WIDTH / 2, 335, kind === 'local' ? 'Open the game in another tab and choose\n"Join from another tab".' : 'Tell your friend the keyword, or send the link.', 15, '#c9d1ee', false).setAlign('center'));
      if (kind === 'peer') {
        add(makeButton(this, 150, 420, 230, 50, 'Copy link', () => void this.copy(linkFor(code), 'Link copied'), 0x2f6fdd, 18));
        add(makeButton(this, 390, 420, 230, 50, 'Copy keyword', () => void this.copy(code, 'Keyword copied'), 0x2f6fdd, 18));
      }
      const status = txt(this, WIDTH / 2, 500, 'Waiting for your opponent…', 18, '#ffffff');
      add(status);
      this.tweens.add({ targets: status, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
      add(makeButton(this, WIDTH / 2, 610, 220, 48, 'Cancel', () => this.leaveToMenu(), 0x59627f, 20));
    });
  }

  private showOpponentJoining(session: Session): void {
    this.screen((add) => {
      add(txt(this, WIDTH / 2, 300, 'Opponent connecting…', 26));
      add(makeButton(this, WIDTH / 2, 470, 220, 48, 'Cancel', () => this.leaveToMenu(session), 0x59627f, 20));
    });
  }

  private showReady(session: Session): void {
    this.screen((add) => {
      add(txt(this, WIDTH / 2, 260, 'Opponent connected!', 30, '#7ee787'));
      add(txt(this, WIDTH / 2, 320, 'You both get the same wall and the same holds.', 15, '#c9d1ee', false));
      add(makeButton(this, WIDTH / 2, 430, 280, 62, 'Start game', () => this.startAsHost(session), 0x2e8b57, 24));
      add(makeButton(this, WIDTH / 2, 510, 220, 48, 'Cancel', () => this.leaveToMenu(session), 0x59627f, 20));
    });
  }

  private startAsHost(session: Session): void {
    const seed = randomSeed();
    session.send({ t: 'start', seed });
    this.scene.start('Game', { level: versusLevel(seed), versus: session });
  }

  // ---------- guest ----------

  private askKeyword(kind: NetKind): void {
    unlockAudio();
    const input = window.prompt('Enter the keyword your friend gave you (like CHALK-DYNO-58)');
    if (input === null) return;
    const code = codeFromInput(input) ?? normaliseCode(input);
    if (!code) return this.showMessage('That keyword looks wrong', 'Keywords are two climbing words and two digits, like CHALK-DYNO-58.', () => this.askKeyword(kind));
    void this.joinFlow(kind, code);
  }

  private async joinFlow(kind: NetKind, code: string): Promise<void> {
    unlockAudio();
    this.showMessage('Connecting…', `Looking for ${code}`);
    let session: Session;
    try {
      session = new Session('guest', code, await joinGame(kind, code));
    } catch (e) {
      if (this.gone) return;
      return this.showMessage("Couldn't join", FAILURE_TEXT[e instanceof ConnectError ? e.reason : 'network'], () => void this.joinFlow(kind, code));
    }
    if (this.gone) return session.close();
    this.session = session;
    session.setHandler({
      message: (m) => {
        if (m.t === 'start' && !this.gone) this.scene.start('Game', { level: versusLevel(m.seed), versus: session });
      },
      close: () => !this.gone && this.showMessage('Host left', 'The host disconnected before the game started.'),
    });
    session.ready.then(
      () => !this.gone && this.showJoined(session),
      () => !this.gone && this.showMessage('Connection failed', 'The host is on a different version of the game.'),
    );
  }

  private showJoined(session: Session): void {
    this.screen((add) => {
      add(txt(this, WIDTH / 2, 280, 'Connected!', 32, '#7ee787'));
      const wait = txt(this, WIDTH / 2, 350, 'Waiting for the host to start…', 18);
      add(wait);
      this.tweens.add({ targets: wait, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
      add(makeButton(this, WIDTH / 2, 470, 220, 48, 'Leave', () => this.leaveToMenu(session), 0x59627f, 20));
    });
  }

  // ---------- helpers ----------

  private async copy(text: string, done: string): Promise<void> {
    if (!(await copyToClipboard(text, 'Copy this to share it'))) return;
    const note = txt(this, WIDTH / 2, 462, done, 14, '#7ee787');
    this.time.delayedCall(1500, () => note.destroy());
  }

  private leaveToMenu(session: Session | null = this.session): void {
    this.gone = true;
    this.host?.cancel();
    session?.close();
    this.scene.start('Menu');
  }
}
