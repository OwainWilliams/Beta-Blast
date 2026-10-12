import Phaser from 'phaser';
import { WIDTH } from '../config';
import { dailyLevel, gradeLevel, LevelSpec, survivalLevel } from '../game/levels';
import { codeFromInput, decodeRoute, routeLevel } from '../game/routes';
import { getBest, getBestTime, getMusic, getShake, isSent, setShake } from '../game/storage';
import { isMutedNow, toggleMute, unlockAudio } from '../game/audio';
import { toggleMusic } from '../game/music';
import { formatTime } from '../game/format';
import { makeButton, makeToggle, txt } from '../ui';

const PAGE = 8;
let menuPage: number | null = null; // remembered while the page is open

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.add.image(0, 0, 'wall').setOrigin(0);
    for (let i = 0; i < 5; i++) {
      const h = this.add.image(90 + i * 90, 72, `hold-${i}`).setScale(1.1);
      this.tweens.add({ targets: h, y: 80, duration: 900 + i * 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    txt(this, WIDTH / 2, 144, 'BETA BLAST', 56, '#ffd166');
    txt(this, WIDTH / 2, 186, 'Shoot the holds. Send the route.', 17, '#c9d1ee', false);

    // The ways to play: two solo modes side by side, then the versus mode.
    const daily = dailyLevel();
    makeButton(this, 140, 245, 250, 52, `Daily Boulder (V${daily.grade})${isSent(daily.id) ? '  ✓' : ''}`, () => this.play(daily), 0xd9622b, 19);
    txt(this, 140, 281, `Best today: ${getBest(daily.id)}`, 14, '#c9d1ee', false);
    makeButton(this, 400, 245, 250, 52, 'Survival', () => this.play(survivalLevel()), 0xc23b5a, 22);
    const longest = getBestTime('survival');
    txt(this, 400, 281, longest ? `Best ${getBest('survival')} · longest ${formatTime(longest)}` : 'How long can you last?', 14, '#c9d1ee', false);
    makeButton(this, WIDTH / 2, 332, 510, 46, '2 Player', () => this.scene.start('Lobby'), 0x2e8b57, 21);

    // Grades never run out, so they come in pages. Open on the page with your first unsent grade.
    if (menuPage === null) {
      let first = 0;
      while (isSent(`v${first}`)) first++;
      menuPage = Math.floor(first / PAGE);
    }
    const from = menuPage * PAGE;
    txt(this, WIDTH / 2, 402, `Grades V${from} to V${from + PAGE - 1}`, 19);
    const arrow = (x: number, label: string, enabled: boolean, delta: number) => {
      const b = makeButton(this, x, 402, 44, 34, label, () => {
        if (!enabled) return;
        menuPage = Math.max(0, (menuPage ?? 0) + delta);
        this.scene.restart();
      }, enabled ? 0x59627f : 0x2a2f42, 20);
      if (!enabled) b.setAlpha(0.4);
    };
    arrow(100, '‹', menuPage > 0, -1);
    arrow(440, '›', true, 1);
    for (let i = 0; i < PAGE; i++) {
      const g = from + i;
      const level = gradeLevel(g);
      const x = 75 + (i % 4) * 130;
      const y = 456 + Math.floor(i / 4) * 76;
      const sent = isSent(level.id);
      makeButton(this, x, y, 112, 50, `V${g}${sent ? ' ✓' : ''}`, () => this.play(level), sent ? 0x2e8b57 : 0x2f6fdd, 22);
      const best = getBest(level.id);
      if (best > 0) txt(this, x, y + 34, `best ${best}`, 12, '#9aa6cf', false);
    }

    makeButton(this, 70, 24, 116, 32, 'Customise', () => this.scene.start('Customise'), 0x59627f, 14);
    makeButton(this, WIDTH - 70, 24, 116, 32, 'Leaderboard', () => this.scene.start('Leaderboard'), 0x59627f, 14);

    // Extras and settings, kept small so they stay out of the way. Controls are taught by the in-game tips.
    makeButton(this, 185, 612, 150, 34, 'Route Setter', () => this.scene.start('Editor'), 0x4a3a7a, 15);
    makeButton(this, 355, 612, 150, 34, 'Play a code', () => this.playCode(), 0x4a3a7a, 15);
    const toggle = (x: number, label: () => string, flip: () => void) => makeToggle(this, x, 676, 150, 30, label, flip, 13, 0x3a4260);
    toggle(95, () => `Sound: ${isMutedNow() ? 'off' : 'on'}`, () => void toggleMute());
    toggle(270, () => `Music: ${getMusic() ? 'on' : 'off'}`, () => void toggleMusic());
    toggle(445, () => `Shake: ${getShake() ? 'on' : 'off'}`, () => setShake(!getShake()));

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
