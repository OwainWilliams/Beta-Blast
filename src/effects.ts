// Small visual effects, so the game scene doesn't have to carry the details of each one.
import Phaser from 'phaser';
import { GRID_X, HEIGHT, HOLD_COLOURS, WIDTH } from './config';
import { txt } from './ui';

/** A short message that floats up from a spot and fades ("+120"). */
export function floatText(scene: Phaser.Scene, x: number, y: number, text: string, color = '#ffd166', size = 18): void {
  const t = txt(scene, x, y, text, size, color).setDepth(50);
  scene.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 900, onComplete: () => t.destroy() });
}

/** A handful of chalk flecks bursting out of a popped hold. */
export function chalkBurst(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 6; i++) {
    const p = scene.add.image(x, y, 'chalk').setAlpha(0.9).setDepth(40);
    scene.tweens.add({
      targets: p,
      x: x + Phaser.Math.Between(-34, 34),
      y: y + Phaser.Math.Between(-34, 20),
      alpha: 0,
      scale: 0.2,
      duration: 450,
      onComplete: () => p.destroy(),
    });
  }
}

/** A ring of flecks in one hold colour, for a mega jug showing what it turned into. */
export function colourRing(scene: Phaser.Scene, x: number, y: number, type: number): void {
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    const fleck = scene.add.image(x, y, 'chalk').setTint(HOLD_COLOURS[type]).setDepth(40).setScale(1.2);
    scene.tweens.add({
      targets: fleck,
      x: x + Math.cos(a) * 42,
      y: y + Math.sin(a) * 42,
      alpha: 0,
      scale: 0.3,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => fleck.destroy(),
    });
  }
}

/** A shower of chalk and tape falling down the whole screen. */
export function confetti(scene: Phaser.Scene): void {
  for (let i = 0; i < 70; i++) {
    const colour = i % 3 === 0 ? 0xffffff : HOLD_COLOURS[i % HOLD_COLOURS.length];
    const bit = scene.add.rectangle(Phaser.Math.Between(GRID_X, WIDTH - GRID_X), -20, 8, 14, colour).setDepth(80);
    scene.tweens.add({
      targets: bit,
      y: HEIGHT + 20,
      x: bit.x + Phaser.Math.Between(-80, 80),
      angle: Phaser.Math.Between(-540, 540),
      duration: Phaser.Math.Between(1200, 2200),
      delay: Phaser.Math.Between(0, 500),
      ease: 'Quad.easeIn',
      onComplete: () => bit.destroy(),
    });
  }
}

export interface PopWordOptions {
  x?: number;
  y?: number;
  size?: number;
  color?: string;
  from?: number; // starting scale
  to?: number; // scale it settles at
  growMs?: number;
  holdMs?: number; // how long it stays before fading
  fadeMs?: number;
  depth?: number;
}

/** A word that pops in at the centre of the screen, stays a moment, then fades ("3", "SENT!", "TOP!"). */
export function popWord(scene: Phaser.Scene, word: string, o: PopWordOptions = {}): Phaser.GameObjects.Text {
  const { x = WIDTH / 2, y = 300, size = 90, color = '#ffd166', from = 0.1, to = 1, growMs = 450, holdMs = 1500, fadeMs = 300, depth = 90 } = o;
  const t = txt(scene, x, y, word, size, color).setDepth(depth).setScale(from);
  scene.tweens.add({ targets: t, scale: to, duration: growMs, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, alpha: 0, duration: fadeMs, delay: holdMs, onComplete: () => t.destroy() });
  return t;
}
