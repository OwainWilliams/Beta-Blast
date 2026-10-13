import Phaser from 'phaser';
import { BOMB, D, SLICK, VOLUME, WILD } from '../game/grid';
import { codeFromInput, decodeRoute, routeLevel } from '../game/routes';
import { codeFromInput as joinCodeFromInput } from '../net/codes';
import { holdColours, WIDTH, HEIGHT, GRID_X } from '../config';
import { currentTheme, THEMES } from '../game/themes';

const shade = (c: number, amt: number) =>
  amt >= 0
    ? Phaser.Display.Color.IntegerToColor(c).lighten(amt).color
    : Phaser.Display.Color.IntegerToColor(c).darken(-amt).color;

// All art is drawn in code, so the game ships with no image files.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    for (const t of THEMES) if (t.logo) this.load.svg(t.logo.key, t.logo.file);
  }

  /** The artwork that follows the theme: the route-coloured holds, the mega jug and the wall. */
  applyTheme(): void {
    const stale = [0, 1, 2, 3, 4, WILD].map((t) => `hold-${t}`).concat('wall');
    for (const key of stale) if (this.textures.exists(key)) this.textures.remove(key); // generateTexture would draw over the old one
    holdColours().forEach((col, i) => this.makeHold(i, col));
    this.makeWild();
    this.makeWall();
  }

  create(): void {
    this.applyTheme();
    this.makeBomb();
    this.makeVolume(false);
    this.makeVolume(true);
    this.makeSlick();
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture('chalk', 8, 8);
    g.destroy();
    // soft round puff: stacked translucent circles fake a radial gradient
    const d = this.add.graphics();
    for (let i = 0; i < 12; i++) d.fillStyle(0xffffff, 0.07).fillCircle(16, 16, 16 - i * 1.25);
    d.generateTexture('dust', 32, 32);
    d.destroy();
    // a shared link like ?route=CP1-... goes straight into that route
    const code = codeFromInput(window.location.search);
    const route = code ? decodeRoute(code) : null;
    const join = joinCodeFromInput(window.location.search); // a ?join=KEYWORD link from a friend
    if (code && route) this.scene.start('Game', { level: routeLevel(route, code) });
    else if (join) this.scene.start('Lobby', { join });
    else this.scene.start('Menu');
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

  // Mega jug: a big jug striped in every route colour, because it can become any of them.
  private makeWild(): void {
    const g = this.add.graphics();
    const c = D / 2;
    g.fillStyle(0x20242f).fillCircle(c, c + 2, 22);
    holdColours().forEach((col, i) => {
      g.fillStyle(col);
      g.slice(c, c, 21, Phaser.Math.DegToRad(-90 + i * 72), Phaser.Math.DegToRad(-90 + (i + 1) * 72), false);
      g.fillPath();
    });
    g.fillStyle(0x20242f, 0.55).fillEllipse(c, c + 3, 22, 9); // jug slot
    g.fillStyle(0xffffff, 0.5).fillEllipse(c - 7, c - 11, 12, 7);
    g.lineStyle(2, 0x20242f, 1).strokeCircle(c, c, 21);
    g.generateTexture(`hold-${WILD}`, D, D);
    g.destroy();
  }

  private makeVolume(cracked: boolean): void {
    const g = this.add.graphics();
    const c = D / 2;
    g.fillStyle(0x4a5368).fillRoundedRect(2, 3, 44, 44, 9);
    g.fillStyle(0x9aa5ba).fillRoundedRect(2, 1, 44, 43, 9);
    g.fillStyle(0xc4cddd).fillTriangle(4, 6, 40, 4, 4, 38); // lit face
    g.fillStyle(0x7a869c).fillTriangle(44, 8, 44, 42, 10, 42); // shaded face
    g.fillStyle(0x3b4256).fillCircle(c, c - 1, 6); // T-nut bolt
    g.fillStyle(0xdfe6f2, 0.8).fillCircle(c - 2, c - 3, 2);
    if (cracked) {
      g.lineStyle(3, 0x20242f, 1).beginPath();
      g.moveTo(12, 6).lineTo(20, 18).lineTo(15, 26).lineTo(27, 34).lineTo(24, 44).strokePath();
      g.lineStyle(2, 0x20242f, 1).beginPath().moveTo(20, 18).lineTo(34, 14).strokePath();
    }
    g.generateTexture(cracked ? 'hold-6c' : `hold-${VOLUME}`, D, D);
    g.destroy();
  }

  private makeSlick(): void {
    const g = this.add.graphics();
    const c = D / 2;
    g.fillStyle(0x0e6f6a).fillCircle(c, c + 2, 22);
    g.fillStyle(0x23b5ab).fillCircle(c, c, 21);
    g.fillStyle(0x7ae6dc, 0.9).fillEllipse(c - 5, c - 8, 22, 9); // gloss
    g.fillStyle(0xffffff, 0.85).fillEllipse(c - 9, c - 10, 8, 4);
    g.fillStyle(0x0e6f6a, 0.9).fillTriangle(c + 8, c + 5, c + 14, c + 5, c + 11, c + 13); // drip
    g.fillCircle(c + 11, c + 14, 3);
    g.generateTexture(`hold-${SLICK}`, D, D);
    g.destroy();
  }

  private makeWall(): void {
    const g = this.add.graphics();
    const t = currentTheme().wall;
    g.fillStyle(t.bg).fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(t.panel).fillRect(GRID_X, 0, WIDTH - GRID_X * 2, 600);
    // panel seams
    g.lineStyle(2, t.seam, 1);
    for (let x = GRID_X; x <= WIDTH - GRID_X; x += 240) g.lineBetween(x, 0, x, 600);
    for (let y = 0; y <= 600; y += 240) g.lineBetween(GRID_X, y, WIDTH - GRID_X, y);
    // T-nut holes
    g.fillStyle(t.hole, 1);
    for (let y = 24; y < 600; y += 48) for (let x = GRID_X + 24; x < WIDTH - GRID_X; x += 48) g.fillCircle(x, y, 2.5);
    // crash pad
    g.fillStyle(t.pad).fillRect(0, 600, WIDTH, HEIGHT - 600);
    g.fillStyle(t.padEdge).fillRect(0, 600, WIDTH, 6);
    g.lineStyle(2, t.padLine, 1);
    for (let x = 0; x <= WIDTH; x += 90) g.lineBetween(x, 606, x, HEIGHT);
    g.generateTexture('wall', WIDTH, HEIGHT);
    g.destroy();
  }
}
