import Phaser from 'phaser';
import { WIDTH } from '../config';
import { dailyLevel, gradeLevel, LevelSpec, MAX_GRADE } from '../game/levels';
import { codeFromInput, decodeRoute, routeLevel } from '../game/routes';
import { getBest, getShake, isSent, setShake } from '../game/storage';
import { isMutedNow, toggleMute, unlockAudio } from '../game/audio';
import { makeButton, txt } from '../ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.add.image(0, 0, 'wall').setOrigin(0);
    for (let i = 0; i < 5; i++) {
      const h = this.add.image(90 + i * 90, 70, `hold-${i}`).setScale(1.2);
      this.tweens.add({ targets: h, y: 80, duration: 900 + i * 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    txt(this, WIDTH / 2, 150, 'CRIMP & POP', 54, '#ffd166');
    txt(this, WIDTH / 2, 198, 'Shoot the holds. Send the route.', 18, '#c9d1ee', false);

    const daily = dailyLevel();
    makeButton(this, WIDTH / 2, 262, 360, 52, `Daily Boulder (V${daily.grade})${isSent(daily.id) ? '  ✓' : ''}`, () => this.play(daily), 0xd9622b, 22);
    txt(this, WIDTH / 2, 298, `Best today: ${getBest(daily.id)}`, 14, '#c9d1ee', false);

    txt(this, WIDTH / 2, 335, 'Pick a grade', 20);
    for (let g = 0; g <= MAX_GRADE; g++) {
      const level = gradeLevel(g);
      const x = 75 + (g % 4) * 130;
      const y = 380 + Math.floor(g / 4) * 74;
      const sent = isSent(level.id);
      makeButton(this, x, y, 112, 50, `V${g}${sent ? ' ✓' : ''}`, () => this.play(level), sent ? 0x2e8b57 : 0x2f6fdd, 22);
      txt(this, x, y + 34, `best ${getBest(level.id)}`, 12, '#9aa6cf', false);
    }

    makeButton(this, 140, 608, 220, 46, 'Route Setter', () => this.scene.start('Editor'), 0x7a4fd0, 20);
    makeButton(this, 400, 608, 220, 46, 'Play a code', () => this.playCode(), 0x7a4fd0, 20);

    const help = ['Aim with mouse / touch, release to shoot. Arrows + Space work too.', 'Tap NEXT or press S to swap. P pauses.'];
    help.forEach((line, i) => txt(this, WIDTH / 2, 650 + i * 18, line, 13, '#9aa6cf', false));

    const sound = makeButton(this, 140, 695, 200, 32, `Sound: ${isMutedNow() ? 'off' : 'on'}`, () => {
      toggleMute();
      (sound.list[1] as Phaser.GameObjects.Text).setText(`Sound: ${isMutedNow() ? 'off' : 'on'}`);
    }, 0x59627f, 14);
    const shake = makeButton(this, 400, 695, 200, 32, `Screen shake: ${getShake() ? 'on' : 'off'}`, () => {
      setShake(!getShake());
      (shake.list[1] as Phaser.GameObjects.Text).setText(`Screen shake: ${getShake() ? 'on' : 'off'}`);
    }, 0x59627f, 14);

    this.input.once('pointerdown', unlockAudio);
  }

  private play(level: LevelSpec): void {
    unlockAudio();
    this.scene.start('Game', { level });
  }

  private playCode(): void {
    const input = window.prompt('Paste a route code or link');
    if (input === null) return;
    const code = codeFromInput(input);
    const route = code ? decodeRoute(code) : null;
    if (!code || !route) {
      window.alert("That code doesn't look right.");
      return;
    }
    this.play(routeLevel(route, code));
  }
}
