import Phaser from 'phaser';
import { WIDTH } from '../config';
import { gradeLevel, LevelSpec } from '../game/levels';
import { currentTheme } from '../game/themes';
import { unlockAudio } from '../game/audio';
import { getBest, isSent } from '../game/storage';
import { makeButton, txt } from '../ui';

const PAGE = 8;
let gradesPage: number | null = null; // remembered while the page is open

/** The grades, a page at a time: they never run out. Opens on the page with your first grade not yet sent. */
export class GradesScene extends Phaser.Scene {
  constructor() {
    super('Grades');
  }

  create(): void {
    const theme = currentTheme();
    this.add.image(0, 0, 'wall').setOrigin(0);
    txt(this, WIDTH / 2, 60, 'GRADES', 44, theme.title);
    txt(this, WIDTH / 2, 104, 'Clear the whole wall to send the route. Each grade is harder.', 15, '#c9d1ee', false);

    if (gradesPage === null) {
      let first = 0;
      while (isSent(`v${first}`)) first++;
      gradesPage = Math.floor(first / PAGE);
    }
    const from = gradesPage * PAGE;
    txt(this, WIDTH / 2, 170, `V${from} to V${from + PAGE - 1}`, 22);
    const arrow = (x: number, label: string, enabled: boolean, delta: number) => {
      const b = makeButton(this, x, 170, 52, 40, label, () => {
        if (!enabled) return;
        gradesPage = Math.max(0, (gradesPage ?? 0) + delta);
        this.scene.restart();
      }, enabled ? 0x59627f : 0x2a2f42, 22);
      if (!enabled) b.setAlpha(0.4);
    };
    arrow(70, '‹', gradesPage > 0, -1);
    arrow(WIDTH - 70, '›', true, 1);

    for (let i = 0; i < PAGE; i++) {
      const g = from + i;
      const level = gradeLevel(g);
      const x = 75 + (i % 4) * 130;
      const y = 250 + Math.floor(i / 4) * 100;
      const sent = isSent(level.id);
      makeButton(this, x, y, 112, 60, `V${g}${sent ? ' ✓' : ''}`, () => this.play(level), sent ? theme.gradeSent : theme.grade, 24);
      const best = getBest(level.id);
      txt(this, x, y + 42, best > 0 ? `best ${best}` : sent ? '' : 'not sent yet', 12, '#9aa6cf', false);
    }

    makeButton(this, 140, 660, 220, 46, 'How it works', () => this.scene.start('HowTo', { mode: 'grades' }), 0x3a4260, 18);
    makeButton(this, 400, 660, 220, 46, 'Back', () => this.scene.start('Menu'), 0x59627f, 19);
  }

  private play(level: LevelSpec): void {
    unlockAudio();
    this.scene.start('Game', { level });
  }
}
