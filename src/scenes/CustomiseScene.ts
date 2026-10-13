import Phaser from 'phaser';
import { WIDTH } from '../config';
import { encodeLook, isUnlocked, Look, lookOrDefault, SLOT_NAMES, SLOTS, SWATCHES, unlockedCount, unlockHint } from '../game/looks';
import { getLookCode, getProgress, getThemeId, setLookCode, setThemeId } from '../game/storage';
import { currentTheme, nextTheme } from '../game/themes';
import type { BootScene } from './BootScene';
import { Climber, makeButton, txt } from '../ui';

const ROW_Y = [335, 425, 515]; // swatch rows: beanie, shirt, chalk bag
const SWATCH_X = (i: number) => 52 + i * 62;
const R = 22;

export class CustomiseScene extends Phaser.Scene {
  private look!: Look;
  private preview!: Climber;
  private layer!: Phaser.GameObjects.Graphics;
  private hint!: Phaser.GameObjects.Text;

  constructor() {
    super('Customise');
  }

  create(): void {
    this.look = lookOrDefault(getLookCode());
    const progress = getProgress();
    this.add.image(0, 0, 'wall').setOrigin(0);
    txt(this, WIDTH / 2, 44, 'CUSTOMISE', 40, '#ffd166');

    this.preview = new Climber(this, WIDTH / 2, 235, 2.3, this.look);
    this.tweens.add({ targets: this.preview, y: 229, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const { have, total } = unlockedCount(progress);
    txt(this, WIDTH / 2, 262, `${have} of ${total} unlocked`, 14, '#9aa6cf', false);

    this.layer = this.add.graphics();
    SLOTS.forEach((slot, row) => {
      txt(this, 40, ROW_Y[row] - 38, SLOT_NAMES[slot], 16, '#c9d1ee').setOrigin(0, 0.5);
      SWATCHES[slot].forEach((swatch, i) => {
        const unlocked = isUnlocked(swatch.unlock, progress);
        this.add
          .circle(SWATCH_X(i), ROW_Y[row], R + 3, 0x000000, 0.001)
          .setInteractive({ useHandCursor: true })
          .on('pointerup', () => {
            if (!unlocked) {
              this.say(`${swatch.name} ${SLOT_NAMES[slot].toLowerCase()}: ${unlockHint(swatch.unlock)}`, '#ff9a9a');
              return;
            }
            this.look = { ...this.look, [slot]: i };
            setLookCode(encodeLook(this.look));
            this.preview.setLook(this.look);
            this.draw(progress);
            this.say(`${swatch.name} ${SLOT_NAMES[slot].toLowerCase()}`, '#ffd166');
          });
      });
    });
    this.hint = txt(this, WIDTH / 2, 572, 'Tap a colour. Locked ones show how to earn them.', 15, '#9aa6cf', false);
    this.draw(progress);

    makeButton(this, WIDTH / 2, 612, 260, 40, `Theme: ${currentTheme().name}`, () => this.changeTheme(), 0x3a4260, 18);
    makeButton(this, WIDTH / 2, 668, 220, 42, 'Back', () => this.scene.start('Menu'), 0x59627f, 20);
  }

  private changeTheme(): void {
    setThemeId(nextTheme(getThemeId()).id);
    (this.scene.get('Boot') as BootScene).applyTheme();
    this.scene.restart();
  }

  private say(text: string, colour: string): void {
    this.hint.setText(text).setColor(colour);
  }

  /** The swatches: a coloured disc each, a ring on the chosen one, a padlock on the locked ones. */
  private draw(progress: ReturnType<typeof getProgress>): void {
    const g = this.layer.clear();
    SLOTS.forEach((slot, row) => {
      SWATCHES[slot].forEach((swatch, i) => {
        const x = SWATCH_X(i);
        const y = ROW_Y[row];
        const unlocked = isUnlocked(swatch.unlock, progress);
        g.fillStyle(swatch.colour, unlocked ? 1 : 0.3).fillCircle(x, y, R);
        g.lineStyle(2, 0xffffff, unlocked ? 0.5 : 0.15).strokeCircle(x, y, R);
        if (!unlocked) {
          g.fillStyle(0x14171f, 0.85).fillRoundedRect(x - 7, y - 3, 14, 11, 2); // padlock body
          g.lineStyle(3, 0x14171f, 0.85).beginPath().arc(x, y - 4, 4.5, Math.PI, 0).strokePath(); // and its shackle
        }
        if (this.look[slot] === i) g.lineStyle(4, 0xffd166, 1).strokeCircle(x, y, R + 4);
      });
    });
  }
}
