import Phaser from 'phaser';
import { BOMB, D } from '../game/grid';
import { HOLD_COLOURS, WIDTH, HEIGHT, GRID_X } from '../config';

const shade = (c: number, amt: number) =>
  amt >= 0
    ? Phaser.Display.Color.IntegerToColor(c).lighten(amt).color
    : Phaser.Display.Color.IntegerToColor(c).darken(-amt).color;

// All art is drawn in code, so the game ships with no image files.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    HOLD_COLOURS.forEach((col, i) => this.makeHold(i, col));
    this.makeBomb();
    this.makeWall();
    this.makeBarrel();
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture('chalk', 8, 8);
    g.destroy();
    this.scene.start('Menu');
  }

  private makeHold(type: number, col: number): void {
    const g = this.add.graphics();
    const dark = shade(col, -35);
    const light = shade(col, 35);
    const c = D / 2;
    // Each colour is also a different hold shape, so colour is never the only cue.
    switch (type) {
      case 0: // jug
        g.fillStyle(dark).fillCircle(c, c + 2, 22);
        g.fillStyle(col).fillCircle(c, c, 21);
        g.fillStyle(0x000000, 0.35).fillEllipse(c, c + 4, 24, 10);
        g.fillStyle(light, 0.6).fillEllipse(c - 7, c - 11, 12, 7);
        break;
      case 1: // crimp
        g.fillStyle(dark).fillRoundedRect(2, 11, 44, 28, 11);
        g.fillStyle(col).fillRoundedRect(3, 10, 42, 26, 11);
        g.fillStyle(0x000000, 0.35).fillRoundedRect(8, 26, 32, 6, 3);
        g.fillStyle(light, 0.6).fillRoundedRect(9, 13, 18, 5, 2);
        break;
      case 2: // sloper
        g.fillStyle(dark).fillEllipse(c, c + 7, 46, 36);
        g.fillStyle(col).fillEllipse(c, c + 5, 44, 34);
        g.fillStyle(light, 0.55).fillEllipse(c - 6, c - 3, 20, 10);
        break;
      case 3: { // pinch
        const pts = Array.from({ length: 6 }, (_, k) => {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          return new Phaser.Geom.Point(c + Math.cos(a) * 22, c + Math.sin(a) * 22);
        });
        g.fillStyle(dark).fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x, p.y + 2)), true);
        g.fillStyle(col).fillPoints(pts, true);
        g.fillStyle(light, 0.5).fillTriangle(c - 14, c - 6, c, c - 18, c + 4, c - 8);
        break;
      }
      default: // pocket
        g.fillStyle(dark).fillCircle(c, c + 2, 22);
        g.fillStyle(col).fillCircle(c, c, 21);
        g.fillStyle(0x000000, 0.55).fillCircle(c, c + 1, 9);
        g.lineStyle(2, light, 0.7).strokeCircle(c, c, 11);
    }
    g.generateTexture(`hold-${type}`, D, D);
    g.destroy();
  }

  private makeBomb(): void {
    const g = this.add.graphics();
    const c = D / 2;
    g.fillStyle(0x9aa0aa).fillCircle(c, c + 2, 22);
    g.fillStyle(0xf4f4f0).fillCircle(c, c, 21);
    g.fillStyle(0xd5d8dd).fillCircle(c - 8, c - 6, 5).fillCircle(c + 9, c + 5, 6).fillCircle(c - 4, c + 10, 4);
    g.lineStyle(3, 0x6b7280).beginPath();
    g.moveTo(c - 8, c - 2).lineTo(c, c + 6).lineTo(c + 8, c - 6).strokePath(); // "C"-ish chalk scribble
    g.generateTexture(`hold-${BOMB}`, D, D);
    g.destroy();
  }

  private makeWall(): void {
    const g = this.add.graphics();
    g.fillStyle(0x1d2230).fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(0x262c3d).fillRect(GRID_X, 0, WIDTH - GRID_X * 2, 600);
    // panel seams
    g.lineStyle(2, 0x151925, 1);
    for (let x = GRID_X; x <= WIDTH - GRID_X; x += 240) g.lineBetween(x, 0, x, 600);
    for (let y = 0; y <= 600; y += 240) g.lineBetween(GRID_X, y, WIDTH - GRID_X, y);
    // T-nut holes
    g.fillStyle(0x161a26, 1);
    for (let y = 24; y < 600; y += 48) for (let x = GRID_X + 24; x < WIDTH - GRID_X; x += 48) g.fillCircle(x, y, 2.5);
    // crash pad
    g.fillStyle(0x3a4160).fillRect(0, 600, WIDTH, HEIGHT - 600);
    g.fillStyle(0x4b5480).fillRect(0, 600, WIDTH, 6);
    g.lineStyle(2, 0x2c3250, 1);
    for (let x = 0; x <= WIDTH; x += 90) g.lineBetween(x, 606, x, HEIGHT);
    g.generateTexture('wall', WIDTH, HEIGHT);
    g.destroy();
  }

  private makeBarrel(): void {
    const g = this.add.graphics();
    g.fillStyle(0x59627f).fillRoundedRect(0, 0, 22, 58, 6);
    g.fillStyle(0x8a94b8).fillRoundedRect(3, 2, 6, 54, 3);
    g.generateTexture('barrel', 22, 58);
    g.destroy();
  }
}
