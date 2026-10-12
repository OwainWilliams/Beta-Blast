import Phaser from 'phaser';
import { WIDTH } from './config';
import { hintSeen, markHint } from './game/storage';
import { txt } from './ui';

const SHOW_MS = 4200;

/** One-off tips. Each tip appears once ever, and they queue up so two never overlap. */
export class Hints {
  private queue: { id: string; text: string }[] = [];
  private showing = false;
  private box: Phaser.GameObjects.Container | null = null;

  /** `canShow` says whether a tip may appear right now (not while paused, not once the round is over). */
  constructor(private readonly scene: Phaser.Scene, private readonly canShow: () => boolean) {}

  show(id: string, text: string): void {
    if (hintSeen(id) || this.queue.some((h) => h.id === id)) return;
    this.queue.push({ id, text });
    this.next();
  }

  /** Call when whatever was holding tips back (a pause) is over. */
  resume(): void {
    this.next();
  }

  /** Drop everything queued and take down the tip on screen. */
  clear(): void {
    this.queue = [];
    this.box?.destroy();
    this.box = null;
  }

  private next(): void {
    if (this.showing || !this.canShow()) return;
    const tip = this.queue.shift();
    if (!tip) return;
    this.showing = true;
    markHint(tip.id);
    const label = txt(this.scene, 0, 0, tip.text, 14).setWordWrapWidth(430);
    const box = this.scene.add.rectangle(0, 0, 470, label.height + 18, 0x0d1020, 0.9).setStrokeStyle(2, 0xffd166, 0.8);
    this.box = this.scene.add.container(WIDTH / 2, 546, [box, label]).setDepth(70).setAlpha(0);
    this.scene.tweens.add({ targets: this.box, alpha: 1, duration: 200 });
    this.scene.time.delayedCall(SHOW_MS, () => {
      const shown = this.box;
      if (!shown) return; // cleared in the meantime
      this.scene.tweens.add({
        targets: shown,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          shown.destroy();
          this.box = null;
          this.showing = false;
          this.next();
        },
      });
    });
  }
}
