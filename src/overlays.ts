// The screens that cover the game: results, the leave question, and the pause menu. They only draw and
// report button presses; the game scene decides what each button does.
import Phaser from 'phaser';
import { WIDTH } from './config';
import { formatTime } from './game/format';
import { currentTheme } from './game/themes';
import { makeButton, makeToggle, txt } from './ui';

type Container = Phaser.GameObjects.Container;

/** A dimmed screen that also stops clicks reaching the game behind it. */
function curtain(scene: Phaser.Scene, depth: number, alpha: number): Container {
  const c = scene.add.container(0, 0).setDepth(depth);
  c.add(scene.add.rectangle(WIDTH / 2, 360, WIDTH, 720, 0x000000, alpha).setInteractive());
  return c;
}

export interface RoundResult {
  won: boolean;
  label: string; // "V3", "Custom route"
  score: number;
  bestScore: number;
  bestCombo: number;
  bonus: number; // route bonus when sent
  speed: number; // speed bonus when sent
  seconds: number; // how long the round took
  flash: boolean;
  note?: string; // one line under the result (Arcade: why the score isn't on the table)
  survival?: { seconds: number; stage: number; bestSeconds: number; newBestScore: boolean; newBestTime: boolean };
  /** Leaderboard posting. `name` is the saved name ('' if none yet); `ask` prompts for one; `send` posts and says how it went. */
  post?: { name: string; ask: () => string | null; send: (name: string) => Promise<{ ok: boolean; message: string }>; view: () => void };
  next?: { label: string; go: () => void };
  again: () => void;
  leaveLabel: string;
  leave: () => void;
}

/** Sent or fell, in a single-player round or a survival run. */
export function showRoundResult(scene: Phaser.Scene, r: RoundResult): Container {
  const c = curtain(scene, 100, 0.7);
  const badge = r.won ? currentTheme().badge : undefined;
  if (badge && scene.textures.exists(badge.key)) {
    const img = scene.add.image(WIDTH / 2, 98, badge.key);
    c.add(img.setScale(70 / img.height));
  }
  c.add(txt(scene, WIDTH / 2, 170, r.won ? 'SENT!' : 'FELL!', 64, r.won ? '#ffd166' : '#ff8a8a'));
  if (r.survival) {
    const s = r.survival;
    c.add(txt(scene, WIDTH / 2, 230, `Survived ${formatTime(s.seconds)}  ·  Stage ${s.stage}`, 26));
    c.add(txt(scene, WIDTH / 2, 266, `Score ${r.score}  ·  Best combo x${r.bestCombo}`, 18, '#ffffff'));
    c.add(txt(scene, WIDTH / 2, 296, `Best score ${r.bestScore}  ·  Longest ${formatTime(s.bestSeconds)}`, 15, '#c9d1ee', false));
    const badge = [s.newBestScore && 'NEW BEST SCORE', s.newBestTime && 'NEW LONGEST RUN'].filter(Boolean).join('   ·   ');
    if (badge) c.add(txt(scene, WIDTH / 2, 326, badge, 16, '#ffd166'));
  } else {
    c.add(txt(scene, WIDTH / 2, 230, `${r.label}  ·  Score ${r.score}`, 24));
    c.add(txt(scene, WIDTH / 2, 264, `Best ${r.bestScore}  ·  Best combo x${r.bestCombo}`, 16, '#c9d1ee', false));
  }
  if (r.won) c.add(txt(scene, WIDTH / 2, 298, r.flash ? `FLASH! No pumps. Bonus +${r.bonus}` : `Route bonus +${r.bonus}`, 18, '#ffd166'));
  if (r.won) c.add(txt(scene, WIDTH / 2, 324, `Time ${formatTime(r.seconds)}${r.speed > 0 ? `  ·  Speed bonus +${r.speed}` : ''}`, 15, '#7ae6dc'));
  if (r.note) c.add(txt(scene, WIDTH / 2, 352, r.note, 15, '#9aa6cf', false));
  let y = 370;
  if (r.post) {
    y = 420;
    const post = r.post;
    const status = txt(scene, WIDTH / 2, 340, '', 16, '#7ae6dc');
    c.add(status);
    const send = (name: string) => {
      status.setText('Posting to the leaderboard…');
      void post.send(name).then((res) => {
        if (!status.active) return;
        status.setText(res.message).setColor(res.ok ? '#7ae6dc' : '#ff8a8a');
        if (res.ok) c.add(makeButton(scene, WIDTH / 2, 372, 200, 30, 'See the board', post.view, 0x59627f, 14));
      });
    };
    if (post.name) send(post.name);
    else {
      const btn = makeButton(scene, WIDTH / 2, 350, 260, 40, 'Post to leaderboard', () => {
        const name = post.ask();
        if (!name) return;
        btn.destroy();
        send(name);
      }, 0x7a4fd0, 17);
      c.add(btn);
    }
  }
  if (r.next) {
    c.add(makeButton(scene, WIDTH / 2, y, 260, 54, r.next.label, r.next.go, 0x2e8b57));
    y += 70;
  }
  c.add(makeButton(scene, WIDTH / 2, y, 260, 54, r.won ? 'Climb again' : 'Try again', r.again));
  c.add(makeButton(scene, WIDTH / 2, y + 70, 260, 54, r.leaveLabel, r.leave, 0x59627f));
  return c;
}

export interface VersusResult {
  won: boolean;
  reason?: 'left' | 'timeout' | 'version' | 'self';
  score: number;
  opponentScore: number;
  sent: number;
  received: number;
  bestCombo: number;
  isHost: boolean;
  opponentGone: boolean;
  rematch: () => void;
  leave: () => void;
}

/** The end of a two-player match. Returns a handle for telling it the opponent has left. */
export function showVersusResult(scene: Phaser.Scene, r: VersusResult): { opponentLeft: () => void } {
  const c = curtain(scene, 100, 0.7);
  c.add(txt(scene, WIDTH / 2, 170, r.won ? 'YOU WIN!' : 'YOU LOSE', 60, r.won ? '#ffd166' : '#ff8a8a'));
  const why = r.reason === 'left' ? 'Your opponent left the match' : r.reason === 'timeout' ? 'Lost contact with your opponent' : '';
  if (why) c.add(txt(scene, WIDTH / 2, 226, why, 16, '#c9d1ee', false));
  c.add(txt(scene, WIDTH / 2, 268, `Score ${r.score}  vs  ${r.opponentScore}`, 24));
  c.add(txt(scene, WIDTH / 2, 304, `Rows sent ${r.sent}  ·  rows taken ${r.received}  ·  best combo x${r.bestCombo}`, 14, '#c9d1ee', false));
  // the host's button, or for the guest a note, depending on who is still here
  let rematch: Container | null = r.isHost ? makeButton(scene, WIDTH / 2, 390, 260, 54, 'Rematch', r.rematch, 0x2e8b57) : null;
  if (rematch) c.add(rematch);
  const note = txt(scene, WIDTH / 2, 390, '', 16, '#c9d1ee', false);
  c.add(note);
  c.add(makeButton(scene, WIDTH / 2, 470, 260, 54, 'Leave', r.leave, 0x59627f));
  const opponentLeft = () => {
    rematch?.destroy();
    rematch = null;
    note.setText('Your opponent has left.');
  };
  if (r.opponentGone) opponentLeft();
  else if (!r.isHost) note.setText('Waiting for the host to start a rematch…');
  return { opponentLeft };
}

/** "Leave the match?" Leaving a match is a forfeit, so it asks first. */
export function showLeaveQuestion(scene: Phaser.Scene, stay: () => void, leave: () => void): Container {
  const c = curtain(scene, 200, 0.75);
  c.add(txt(scene, WIDTH / 2, 260, 'Leave the match?', 36, '#ffd166'));
  c.add(txt(scene, WIDTH / 2, 312, 'Your opponent wins if you go.', 16, '#c9d1ee', false));
  c.add(makeButton(scene, WIDTH / 2, 400, 260, 52, 'Keep playing', stay, 0x2e8b57));
  c.add(makeButton(scene, WIDTH / 2, 470, 260, 52, 'Leave', leave, 0x8a3b3b));
  return c;
}

export interface PauseMenu {
  resume: () => void;
  restart: () => void;
  leaveLabel: string;
  leave: () => void;
  soundLabel: () => string;
  toggleSound: () => void;
  musicLabel: () => string;
  toggleMusic: () => void;
  shakeLabel: () => string;
  toggleShake: () => void;
}

export function showPauseMenu(scene: Phaser.Scene, m: PauseMenu): Container {
  const c = curtain(scene, 200, 0.75);
  c.add(txt(scene, WIDTH / 2, 150, 'PAUSED', 54, '#ffd166'));
  c.add(makeButton(scene, WIDTH / 2, 235, 280, 48, 'Resume', m.resume, 0x2e8b57));
  c.add(makeButton(scene, WIDTH / 2, 293, 280, 48, 'Restart', m.restart, 0x2f6fdd));
  c.add(makeToggle(scene, WIDTH / 2, 351, 280, 48, m.soundLabel, m.toggleSound, 20).button);
  c.add(makeToggle(scene, WIDTH / 2, 409, 280, 48, m.musicLabel, m.toggleMusic, 20).button);
  c.add(makeToggle(scene, WIDTH / 2, 467, 280, 48, m.shakeLabel, m.toggleShake, 20).button);
  c.add(makeButton(scene, WIDTH / 2, 525, 280, 48, m.leaveLabel, m.leave, 0x8a3b3b));
  c.add(txt(scene, WIDTH / 2, 575, 'P or Esc to resume', 14, '#9aa6cf', false));
  return c;
}
