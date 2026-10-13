import Phaser from 'phaser';
import { WIDTH } from '../config';
import { arcadeLevel } from '../game/arcade';
import { dailyLevel, survivalLevel } from '../game/levels';
import { CONTROLS, ModeId, modeInfo } from '../game/modes';
import { unlockAudio } from '../game/audio';
import { makeButton, txt } from '../ui';

/** A page of "how this mode works", opened from the ? beside a mode on the menu. */
export class HowToScene extends Phaser.Scene {
  private mode: ModeId = 'grades';

  constructor() {
    super('HowTo');
  }

  init(data: { mode?: ModeId }): void {
    this.mode = data?.mode ?? 'grades';
  }

  create(): void {
    const info = modeInfo(this.mode);
    this.add.image(0, 0, 'wall').setOrigin(0).setTint(0x999999);
    txt(this, WIDTH / 2, 56, info.title, 40, '#ffd166');
    txt(this, WIDTH / 2, 104, info.tagline, 18, '#c9d1ee', false).setWordWrapWidth(470);

    let y = 150;
    for (const line of info.lines) {
      this.add.circle(48, y + 11, 5, info.colour);
      const t = txt(this, 66, y, line, 16, '#ffffff', false).setOrigin(0, 0).setAlign('left').setWordWrapWidth(430);
      y += t.height + 16;
    }

    this.add.rectangle(WIDTH / 2, 566, WIDTH - 60, 44, 0x0d1020, 0.85).setStrokeStyle(2, info.colour, 0.9);
    txt(this, WIDTH / 2, 566, CONTROLS, 11, '#c9d1ee', false).setWordWrapWidth(WIDTH - 90);

    makeButton(this, 140, 660, 220, 46, info.go, () => this.go(), info.colour, 19);
    makeButton(this, 400, 660, 220, 46, 'Back', () => this.scene.start('Menu'), 0x59627f, 19);
  }

  private go(): void {
    unlockAudio();
    switch (this.mode) {
      case 'grades':
        return void this.scene.start('Grades');
      case 'versus':
        return void this.scene.start('Lobby');
      case 'daily':
        return void this.scene.start('Game', { level: dailyLevel() });
      case 'arcade':
        return void this.scene.start('Game', { level: arcadeLevel() });
      case 'survival':
        return void this.scene.start('Game', { level: survivalLevel() });
    }
  }
}
