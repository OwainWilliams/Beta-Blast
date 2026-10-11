import Phaser from 'phaser';
import { WIDTH } from '../config';
import { dailyLevel, gradeLevel, MAX_GRADE } from '../game/levels';
import { getBest, isSent } from '../game/storage';
import { unlockAudio } from '../game/audio';
import { makeButton, txt } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.add.image(0, 0, 'wall').setOrigin(0);
    // decorative holds
    for (let i = 0; i < 5; i++) {
      const h = this.add.image(90 + i * 90, 70, `hold-${i}`).setScale(1.2);
      this.tweens.add({ targets: h, y: 80, duration: 900 + i * 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    txt(this, WIDTH / 2, 150, 'CRIMP & POP', 54, '#ffd166');
    txt(this, WIDTH / 2, 198, 'Shoot the holds. Send the route.', 18, '#c9d1ee', false);

    const daily = dailyLevel();
    const dailyLabel = `Daily Boulder (V${daily.grade})${isSent(daily.id) ? '  ✓' : ''}`;
    makeButton(this, WIDTH / 2, 270, 360, 56, dailyLabel, () => this.play(daily), 0xd9622b, 22);
    txt(this, WIDTH / 2, 308, `Best today: ${getBest(daily.id)}`, 14, '#c9d1ee', false);

    txt(this, WIDTH / 2, 355, 'Pick a grade', 20, '#ffffff');
    for (let g = 0; g <= MAX_GRADE; g++) {
      const level = gradeLevel(g);
      const col = g % 4;
      const row = Math.floor(g / 4);
      const x = 75 + col * 130;
      const y = 405 + row * 78;
      const sent = isSent(level.id);
      makeButton(this, x, y, 112, 54, `V${g}${sent ? ' ✓' : ''}`, () => this.play(level), sent ? 0x2e8b57 : 0x2f6fdd, 22);
      txt(this, x, y + 36, `best ${getBest(level.id)}`, 12, '#9aa6cf', false);
    }

    const help = [
      'Aim with mouse / touch, release to shoot. Arrows + Space also work.',
      'Match 3+ of a hold to pop. Cut-off holds fall.',
      'Miss too often and you get pumped: the wall drops.',
      'Tap NEXT (or press S) to swap. M mutes.',
    ];
    help.forEach((line, i) => txt(this, WIDTH / 2, 620 + i * 20, line, 13, '#9aa6cf', false));

    this.input.once('pointerdown', unlockAudio);
  }

  private play(level: ReturnType<typeof gradeLevel>): void {
    unlockAudio();
    this.scene.start('Game', { level });
  }
}
