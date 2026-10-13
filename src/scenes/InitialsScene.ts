import Phaser from 'phaser';
import { WIDTH } from '../config';
import { cleanInitials, INITIALS, stepChar } from '../game/arcade';
import { formatTime } from '../game/format';
import { postArcade } from '../game/leaderboard';
import type { Replay } from '../game/replay';
import { getInitials, setInitials } from '../game/storage';
import { makeButton, txt } from '../ui';

export interface InitialsData {
  score: number;
  seconds: number;
  stage: number;
  replay: Replay;
}

const COL_X = (i: number) => 150 + i * 120;

/** The old-cabinet name entry: ▲ ▼ (or the arrow keys) scroll the letter, Return locks it in and moves right. */
export class InitialsScene extends Phaser.Scene {
  private run!: InitialsData;
  private chars: string[] = [];
  private pos = 0;
  private boxes: Phaser.GameObjects.Rectangle[] = [];
  private letters: Phaser.GameObjects.Text[] = [];
  private action!: Phaser.GameObjects.Container;
  private actionLabel!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private saving = false;

  constructor() {
    super('Initials');
  }

  init(data: InitialsData): void {
    this.run = data;
    const last = getInitials();
    this.chars = (last.length === INITIALS ? last : 'AAA').split('');
    this.pos = 0;
    this.saving = false;
  }

  create(): void {
    this.add.image(0, 0, 'wall').setOrigin(0).setTint(0x888888);
    txt(this, WIDTH / 2, 70, 'GAME OVER', 44, '#ff8a8a');
    txt(this, WIDTH / 2, 124, `Score ${this.run.score}  ·  ${formatTime(this.run.seconds)}  ·  Stage ${this.run.stage}`, 20);
    txt(this, WIDTH / 2, 160, "You're in this week's top 10!", 20, '#7ae6dc');
    txt(this, WIDTH / 2, 235, 'ENTER YOUR INITIALS', 22, '#ffd166');

    for (let i = 0; i < INITIALS; i++) {
      const x = COL_X(i);
      makeButton(this, x, 305, 72, 40, '▲', () => this.step(i, 1), 0x59627f, 22);
      makeButton(this, x, 495, 72, 40, '▼', () => this.step(i, -1), 0x59627f, 22);
      const box = this.add.rectangle(x, 400, 96, 130, 0x14171f).setStrokeStyle(4, 0x59627f).setInteractive({ useHandCursor: true });
      box.on('pointerup', () => this.select(i));
      this.boxes.push(box);
      this.letters.push(txt(this, x, 400, this.chars[i], 84, '#ffffff').setFontFamily('monospace'));
    }
    txt(this, WIDTH / 2, 545, '▲ ▼ change   ·   Return = next   ·   Backspace = back', 14, '#9aa6cf', false);
    this.status = txt(this, WIDTH / 2, 575, '', 16, '#7ae6dc');
    this.action = makeButton(this, WIDTH / 2, 625, 220, 46, '', () => this.advance(), 0x2e8b57, 22);
    this.actionLabel = this.action.list[1] as Phaser.GameObjects.Text;
    makeButton(this, WIDTH / 2, 686, 120, 28, 'Skip', () => this.scene.start('Menu'), 0x3a4260, 13);

    this.input.keyboard?.on('keydown', this.onKey, this);
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown', this.onKey, this));
    this.refresh();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.saving) return;
    if (e.key === 'ArrowUp') this.step(this.pos, 1);
    else if (e.key === 'ArrowDown') this.step(this.pos, -1);
    else if (e.key === 'Enter') this.advance();
    else if (e.key === 'Backspace') this.select(Math.max(0, this.pos - 1));
    else if (e.key === 'ArrowLeft') this.select(Math.max(0, this.pos - 1));
    else if (e.key === 'ArrowRight') this.select(Math.min(INITIALS - 1, this.pos + 1));
    else if (/^[a-zA-Z0-9]$/.test(e.key)) {
      this.chars[this.pos] = e.key.toUpperCase(); // typing a character works too
      if (this.pos < INITIALS - 1) this.pos++;
      this.refresh();
    }
  }

  private select(i: number): void {
    if (this.saving) return;
    this.pos = i;
    this.refresh();
  }

  private step(i: number, dir: 1 | -1): void {
    if (this.saving) return;
    this.pos = i;
    this.chars[i] = stepChar(this.chars[i], dir);
    this.refresh();
  }

  private advance(): void {
    if (this.saving) return;
    if (this.pos < INITIALS - 1) {
      this.pos++;
      this.refresh();
      return;
    }
    this.save();
  }

  private refresh(): void {
    this.letters.forEach((t, i) => {
      t.setText(this.chars[i]).setColor(i === this.pos ? '#ffd166' : '#ffffff');
      this.boxes[i].setStrokeStyle(4, i === this.pos ? 0xffd166 : 0x59627f);
    });
    this.actionLabel.setText(this.pos < INITIALS - 1 ? 'NEXT ▶' : 'SAVE');
    this.status.setText('');
  }

  private save(): void {
    const initials = cleanInitials(this.chars.join(''));
    if (!initials) {
      this.status.setText("Those initials aren't allowed. Try others").setColor('#ff8a8a');
      return;
    }
    this.saving = true;
    this.status.setText('Saving…').setColor('#7ae6dc');
    setInitials(initials);
    void postArcade(initials, this.run.score, this.run.seconds, this.run.replay).then((res) => {
      if (!this.sys.isActive()) return;
      if (res.ok) {
        this.scene.start('Leaderboard', { board: 'arcade' });
        return;
      }
      this.saving = false;
      this.status.setText(`${res.message}. Press Return to try again`).setColor('#ff8a8a');
    });
  }
}
