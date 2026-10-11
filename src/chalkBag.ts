import Phaser from 'phaser';
import { txt } from './ui';

const BAG = 0xd9622b;
const BAG_DARK = 0x9c4116;
const BAG_LIGHT = 0xf4905a;

/**
 * Soft chalk cloud drifting out along (dx, dy). Used for the shot, landings and the bag's drips.
 * `power` scales how big and far it goes.
 */
export function chalkPuff(scene: Phaser.Scene, x: number, y: number, dx: number, dy: number, power = 1, depth = 9): void {
  const px = -dy; // perpendicular, for sideways spread
  const py = dx;
  const clouds = Math.round(12 * power) + 3;
  for (let i = 0; i < clouds; i++) {
    const along = Phaser.Math.Between(30, 110) * power;
    const side = Phaser.Math.Between(-34, 34) * power;
    const p = scene.add
      .image(x + dx * Phaser.Math.Between(0, 12), y + dy * Phaser.Math.Between(0, 12), 'dust')
      .setDepth(depth)
      .setAlpha(1)
      .setScale(0.9 * power);
    scene.tweens.add({
      targets: p,
      x: p.x + dx * along + px * side,
      y: p.y + dy * along + py * side - 10 * power,
      scale: Phaser.Math.FloatBetween(2.2, 3.6) * power,
      alpha: 0,
      duration: Phaser.Math.Between(550, 950),
      ease: 'Quad.easeOut',
      onComplete: () => p.destroy(),
    });
  }
  // a few bigger flecks that fly further
  for (let i = 0; i < Math.round(6 * power); i++) {
    const fleck = scene.add.image(x, y, 'chalk').setDepth(depth).setAlpha(0.95);
    const spread = Phaser.Math.FloatBetween(-0.5, 0.5);
    const dist = Phaser.Math.Between(40, 110) * power;
    scene.tweens.add({
      targets: fleck,
      x: x + (dx * Math.cos(spread) - dy * Math.sin(spread)) * dist,
      y: y + (dx * Math.sin(spread) + dy * Math.cos(spread)) * dist,
      scale: 0.3,
      alpha: 0,
      duration: Phaser.Math.Between(350, 650),
      ease: 'Cubic.easeOut',
      onComplete: () => fleck.destroy(),
    });
  }
  // a faint cloud that lingers where it started
  const haze = scene.add.image(x, y, 'dust').setDepth(depth).setAlpha(0.55).setScale(2.2 * power);
  scene.tweens.add({ targets: haze, scale: 4.2 * power, alpha: 0, duration: 1100, ease: 'Sine.easeOut', onComplete: () => haze.destroy() });
}

/**
 * The launcher: a chalk bag. It is drawn in two halves, a back (open mouth full of chalk)
 * and a front (the pouch and lip), so the loaded hold can sit between them and look
 * like it is poking out of the bag. Both halves pivot about the mouth.
 */
export class ChalkBag {
  private readonly back: Phaser.GameObjects.Container;
  private readonly front: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene, readonly x: number, readonly y: number) {
    this.back = scene.add.container(x, y, [this.drawBack()]).setDepth(6);
    this.front = scene.add.container(x, y, this.drawFront()).setDepth(8);
  }

  private drawBack(): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    g.fillStyle(BAG_DARK).fillEllipse(0, 0, 68, 19);
    g.fillStyle(0xf4f4f0, 0.97).fillEllipse(0, 1, 54, 12); // chalk inside
    g.fillStyle(0xd8d8d2, 0.9).fillEllipse(-8, 2, 20, 5);
    g.lineStyle(3, BAG_LIGHT).strokeEllipse(0, 0, 68, 19);
    return g;
  }

  private drawFront(): Phaser.GameObjects.GameObject[] {
    const g = this.scene.add.graphics();
    // pouch
    const body = [
      [-31, 2], [31, 2], [36, 20], [33, 40], [19, 47], [-19, 47], [-33, 40], [-36, 20],
    ].map(([px, py]) => new Phaser.Geom.Point(px, py));
    g.fillStyle(BAG).fillPoints(body, true);
    g.fillStyle(BAG_DARK, 0.55).fillPoints(
      [[16, 3], [31, 3], [36, 20], [33, 40], [19, 47], [15, 44]].map(([px, py]) => new Phaser.Geom.Point(px, py)),
      true,
    );
    g.fillStyle(BAG_LIGHT, 0.45).fillEllipse(-22, 24, 8, 26);
    // lower half of the lip, drawn over the hold
    const lip: Phaser.Geom.Point[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (Math.PI * i) / 12;
      lip.push(new Phaser.Geom.Point(Math.cos(a) * 34, 1 + Math.sin(a) * 9.5));
    }
    for (let i = 12; i >= 0; i--) {
      const a = (Math.PI * i) / 12;
      lip.push(new Phaser.Geom.Point(Math.cos(a) * 31, 1 + Math.sin(a) * 6.5));
    }
    g.fillStyle(BAG_LIGHT).fillPoints(lip, true);
    // stitching
    g.lineStyle(1.5, 0xffffff, 0.45);
    for (let a = 0.25; a < 2.9; a += 0.3) g.lineBetween(Math.cos(a) * 29, 9 + Math.sin(a) * 4.5, Math.cos(a + 0.12) * 29, 9 + Math.sin(a + 0.12) * 4.5);
    // logo patch
    g.fillStyle(0xf4f4f0, 0.93).fillEllipse(2, 27, 30, 19);
    // drawstring and toggle
    g.lineStyle(2.5, 0xf4f4f0, 0.95).beginPath().moveTo(-31, 3).lineTo(-39, 15).lineTo(-37, 26).strokePath();
    g.fillStyle(0x20242f).fillCircle(-37, 28, 3.5);
    const logo = txt(this.scene, 2, 27, 'C&P', 10, '#9c4116');
    return [g, logo];
  }

  /** Lean the bag toward where you are aiming. */
  tilt(aim: number): void {
    const r = aim * 0.4;
    this.back.setRotation(r);
    this.front.setRotation(r);
  }

  /** Recoil: the bag squeezes as the hold leaves it. */
  kick(): void {
    this.scene.tweens.add({ targets: [this.back, this.front], scaleX: 1.12, scaleY: 0.8, duration: 80, yoyo: true, ease: 'Quad.easeOut' });
  }

  /** A pinch of chalk falls from the rim now and then. */
  drip(): void {
    const speck = this.scene.add.image(this.x + Phaser.Math.Between(-24, 24), this.y + 6, 'chalk').setDepth(9).setAlpha(0.9).setScale(0.6);
    this.scene.tweens.add({ targets: speck, y: speck.y + Phaser.Math.Between(25, 55), alpha: 0, duration: 650, ease: 'Quad.easeIn', onComplete: () => speck.destroy() });
  }
}
