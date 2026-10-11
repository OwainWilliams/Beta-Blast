import Phaser from 'phaser';
import { HOLD_COLOURS } from './config';
import { LOSE_ROW } from './game/grid';
import { txt } from './ui';

export interface OpponentState {
  score: number;
  pending: number; // rows queued against them
  rows: string[];
}

const COL_W = 7.4;
const ROW_H = 6.4;
const OBSTACLE = { 6: 0x9aa5ba, 7: 0x23b5ab } as const; // volume, slick

/** The opponent's wall in miniature, bottom left, with their score and the rows queued against them. */
export class OpponentPanel {
  score = 0;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly pendingText: Phaser.GameObjects.Text;
  private readonly left = 44;
  private readonly top = 624;

  constructor(scene: Phaser.Scene) {
    scene.add.rectangle(81, 663, 104, 102, 0x000000, 0.3).setStrokeStyle(1, 0x55608a, 0.6);
    txt(scene, 81, 614, 'OPPONENT', 10, '#9aa6cf');
    this.gfx = scene.add.graphics();
    this.scoreText = txt(scene, 81, 712, 'Score 0', 11, '#c9d1ee');
    this.pendingText = txt(scene, 138, 614, '', 11, '#ff6b6b');
    this.update({ score: 0, pending: 0, rows: [] });
  }

  update(s: OpponentState): void {
    this.score = s.score;
    this.scoreText.setText(`Score ${s.score}`);
    this.pendingText.setText(s.pending > 0 ? `+${s.pending}` : '');
    const g = this.gfx;
    g.clear();
    // the red line, where their wall means they have lost
    g.lineStyle(1, 0xe5484d, 0.7).lineBetween(this.left - 2, this.top + (LOSE_ROW - 0.5) * ROW_H, this.left + 10 * COL_W + 2, this.top + (LOSE_ROW - 0.5) * ROW_H);
    s.rows.slice(0, LOSE_ROW + 1).forEach((row, r) => {  // anything past the red line means they have lost; don't draw over the score
      const shifted = row.length < 10; // shifted rows are one hold shorter and sit half a hold across
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        const type = Number(ch);
        const colour = type < 5 ? HOLD_COLOURS[type] : OBSTACLE[type as 6 | 7];
        g.fillStyle(colour, 1).fillCircle(this.left + COL_W / 2 + (c + (shifted ? 0.5 : 0)) * COL_W, this.top + ROW_H / 2 + r * ROW_H, 2.7);
      }
    });
  }
}
