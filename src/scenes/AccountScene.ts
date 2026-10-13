import Phaser from 'phaser';
import { WIDTH } from '../config';
import { availableProviders, beginSignIn, chooseName, deleteAccount, onAccountChange, PROVIDER_NAMES, Provider, signOut, syncNow } from '../game/account';
import { cleanName, MAX_NAME } from '../game/leaderboard';
import { getAuth } from '../game/storage';
import { makeButton, txt } from '../ui';

const PROVIDER_COLOURS: Record<Provider, number> = { github: 0x2b2f3a, google: 0x2f6fdd };

export class AccountScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super('Account');
  }

  create(): void {
    this.add.image(0, 0, 'wall').setOrigin(0);
    txt(this, WIDTH / 2, 44, 'ACCOUNT', 40, '#ffd166');
    // a sign-in, sign-out or new name from anywhere redraws this screen
    const off = onAccountChange(() => this.scene.restart());
    this.events.once('shutdown', off);

    this.status = txt(this, WIDTH / 2, 612, '', 15, '#9aa6cf', false).setWordWrapWidth(470);
    const auth = getAuth();
    if (auth) this.signedIn(auth.provider, auth.name);
    else this.guest();
    makeButton(this, WIDTH / 2, 668, 220, 46, 'Back', () => this.scene.start('Menu'), 0x59627f, 20);
  }

  private say(text: string, colour = '#9aa6cf'): void {
    this.status.setText(text).setColor(colour);
  }

  private bullets(y: number, lines: string[]): void {
    lines.forEach((line, i) => txt(this, 62, y + i * 30, `•  ${line}`, 16, '#c9d1ee', false).setOrigin(0, 0.5));
  }

  // ---------- not signed in ----------

  private guest(): void {
    txt(this, WIDTH / 2, 112, "You're playing as a guest", 24);
    txt(this, WIDTH / 2, 148, 'Your scores and progress are saved on this device only.', 15, '#9aa6cf', false).setWordWrapWidth(470);
    txt(this, 62, 205, 'Sign in to:', 17, '#ffd166').setOrigin(0, 0.5);
    this.bullets(240, ['Keep your progress on every device', 'Reserve your leaderboard name', 'Get a ✓ next to your scores']);

    const hint = txt(this, WIDTH / 2, 420, 'Checking what is available…', 15, '#9aa6cf', false);
    void availableProviders().then((providers) => {
      if (!this.sys.isActive()) return;
      if (!providers.length) {
        hint.setText("Sign-in isn't available right now. You can keep playing as a guest.");
        return;
      }
      hint.destroy();
      providers.forEach((p, i) => makeButton(this, WIDTH / 2, 410 + i * 66, 330, 52, `Sign in with ${PROVIDER_NAMES[p]}`, () => void beginSignIn(p), PROVIDER_COLOURS[p], 19));
    });
    txt(this, WIDTH / 2, 552, 'We only keep an anonymous id from GitHub or Google. Never your email or your real name.', 12, '#7f8ab3', false).setWordWrapWidth(450);
  }

  // ---------- signed in ----------

  private signedIn(provider: Provider, name: string | null): void {
    txt(this, WIDTH / 2, 112, `Signed in with ${PROVIDER_NAMES[provider]}`, 24);
    if (name) {
      txt(this, WIDTH / 2, 160, `Leaderboard name: ${name} ✓`, 20, '#ffd166');
      txt(this, WIDTH / 2, 190, 'Only you can post under it. If you change it, your scores come with you.', 13, '#9aa6cf', false).setWordWrapWidth(450);
      makeButton(this, WIDTH / 2, 240, 280, 42, 'Change name', () => this.pickName(name), 0x7a4fd0, 17);
    } else {
      txt(this, WIDTH / 2, 160, 'No leaderboard name yet', 20, '#ffd166');
      makeButton(this, WIDTH / 2, 218, 280, 46, 'Choose your name', () => this.pickName(''), 0x7a4fd0, 18);
    }
    makeButton(this, WIDTH / 2, 316, 280, 46, 'Sync now', () => void this.sync(), 0x2f6fdd, 18);
    txt(this, WIDTH / 2, 358, 'Scores, grades sent and your outfit follow you to every device.', 13, '#9aa6cf', false).setWordWrapWidth(450);
    makeButton(this, WIDTH / 2, 430, 280, 46, 'Sign out', () => void signOut(), 0x59627f, 18);
    makeButton(this, WIDTH / 2, 520, 280, 38, 'Delete account', () => void this.remove(), 0x8a3b3b, 15);
  }

  private pickName(current: string): void {
    const input = window.prompt(`${current ? 'Choose a new' : 'Choose your'} leaderboard name (letters and numbers, up to ${MAX_NAME})`, current);
    if (input === null) return;
    const name = cleanName(input);
    if (!name) {
      this.say('Use letters or numbers, up to 12 characters.', '#ff9a9a');
      return;
    }
    this.say('Saving…');
    if (name === current) return this.say('That is already your name.');
    void chooseName(name).then((r) => this.sys.isActive() && this.say(r.message, r.ok ? '#7ae6dc' : '#ff9a9a'));
  }

  private async sync(): Promise<void> {
    this.say('Syncing…');
    const ok = await syncNow();
    if (this.sys.isActive()) this.say(ok ? 'Up to date' : "Couldn't sync. Try again in a moment.", ok ? '#7ae6dc' : '#ff9a9a');
  }

  private async remove(): Promise<void> {
    if (!window.confirm('Delete your account?\n\nThis removes your leaderboard scores and your cloud save, and frees your name. Progress saved on this device stays.')) return;
    this.say('Deleting…');
    const r = await deleteAccount();
    if (!r.ok && this.sys.isActive()) this.say(r.message, '#ff9a9a');
  }
}
