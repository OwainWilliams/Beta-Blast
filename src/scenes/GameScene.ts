import Phaser from 'phaser';
import { GRID_X, HEIGHT, HOLD_COLOURS, LAUNCH_X, LAUNCH_Y, LOSE_ROW, LOSE_Y, WIDTH } from '../config';
import { Engine, Flight, MAX_AIM, Removed, SPEED, ShotResult } from '../game/engine';
import { BOMB, Hold, H, SLICK, VOLUME, WILD } from '../game/grid';
import { gradeLevel, LevelSpec } from '../game/levels';
import { pauseMusic, resumeMusic, setIntensity, startMusic, stopMusic, toggleMusic } from '../game/music';
import { isMutedNow, sfx, toggleMute, unlockAudio } from '../game/audio';
import { getBest, getMusic, getShake, hintSeen, markHint, recordResult, setShake } from '../game/storage';
import { ChalkBag, chalkPuff } from '../chalkBag';
import { makeButton, makeClimber, textureFor, txt } from '../ui';

const TRACK_X = 15;
const TRACK_TOP = 40;
const TRACK_BOTTOM = 520;
const HINT_MS = 4200;
const GAUGE_X = 525;
const GAUGE_TOP = 60;
const GAUGE_BOTTOM = 520;

type State = 'aiming' | 'flying' | 'resolving' | 'over';

interface Flying extends Flight {
  type: number;
  sprite: Phaser.GameObjects.Image;
}

export interface GameData {
  level?: LevelSpec;
  from?: 'editor';
  code?: string;
}

export class GameScene extends Phaser.Scene {
  private data0!: GameData;
  private level!: LevelSpec;
  private engine!: Engine;
  private sprites = new Map<Hold, Phaser.GameObjects.Image>();
  private state: State = 'aiming';
  private paused = false;
  private pauseUi: Phaser.GameObjects.Container | null = null;

  private aim = 0;
  private flight: Flying | null = null;
  private curSprite!: Phaser.GameObjects.Image;
  private nxtSprite!: Phaser.GameObjects.Image;
  private ghost!: Phaser.GameObjects.Image;
  private bag!: ChalkBag;
  private pumpLabel!: Phaser.GameObjects.Text;
  private guide!: Phaser.GameObjects.Graphics;
  private pips!: Phaser.GameObjects.Graphics;
  private scoreText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;
  private trackClimber!: Phaser.GameObjects.Container;
  private baseClimber!: Phaser.GameObjects.Container;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private gaugeFill: Phaser.GameObjects.Rectangle | null = null;
  private lastTickSec = -1;

  private hintQueue: { id: string; text: string }[] = [];
  private hintShowing = false;
  private hintBox: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Game');
  }

  init(data: GameData): void {
    this.data0 = data;
    this.level = data.level ?? gradeLevel(0);
  }

  create(): void {
    this.sprites.clear();
    this.hintQueue = [];
    this.hintShowing = false;
    this.hintBox = null;
    this.pauseUi = null;
    this.paused = false;
    this.time.paused = false;
    this.flight = null;
    this.aim = 0;
    this.state = 'aiming';
    this.engine = new Engine(this.level);

    this.add.image(0, 0, 'wall').setOrigin(0);
    for (const [r, c] of this.engine.grid.cells()) this.makeSprite(this.engine.grid.get(r, c)!, r, c);

    const line = this.add.graphics();
    line.lineStyle(3, 0xe5484d, 0.7);
    for (let x = GRID_X; x < WIDTH - GRID_X; x += 16) line.lineBetween(x, LOSE_Y, x + 8, LOSE_Y);

    this.buildTrack();
    this.buildHud();
    this.buildLauncher();
    this.buildInput();
    this.refreshPips();
    this.updateProgress(false);

    this.hint('aim', 'Aim with the mouse or your finger, then release to shoot');
    if (this.gaugeFill) this.hint('timer', 'The gauge on the right fills with time. When it is full, the wall drops a row');
    this.refreshQueue(); // queues the bomb / mega jug tips if one is already loaded
    const kinds = new Set(this.engine.grid.cells().map(([r, c]) => this.engine.grid.get(r, c)!.type));
    if (kinds.has(VOLUME)) this.hint('volume', 'Grey volumes crack when you pop holds next to them. Two pops breaks one');
    if (kinds.has(SLICK)) this.hint('slick', 'Teal slick holds are greasy: shots that land beside one slide down');

    this.lastTickSec = -1;
    startMusic(this.level.grade);
    // Key objects outlive the scene, so drop our listeners on shutdown.
    this.events.once('shutdown', () => {
      Object.values(this.keys).forEach((k) => k.removeAllListeners());
      stopMusic(0);
    });
  }

  // ---------- setup ----------

  private buildTrack(): void {
    const g = this.add.graphics();
    g.lineStyle(3, 0x55608a, 1).lineBetween(TRACK_X, TRACK_TOP, TRACK_X, TRACK_BOTTOM);
    for (let i = 0; i <= 10; i++) {
      const y = TRACK_BOTTOM - ((TRACK_BOTTOM - TRACK_TOP) * i) / 10;
      g.lineBetween(TRACK_X - 5, y, TRACK_X + 5, y);
    }
    txt(this, TRACK_X, TRACK_TOP - 16, 'TOP', 10, '#ffd166');
    this.trackClimber = makeClimber(this, TRACK_X, TRACK_BOTTOM, 0.45);
  }

  private buildHud(): void {
    txt(this, GRID_X + 40, 575, this.level.custom ? 'Custom' : this.level.label, 22, '#ffd166');
    this.scoreText = txt(this, LAUNCH_X, 575, 'Score 0', 20);
    txt(this, WIDTH - GRID_X - 60, 575, `Best ${getBest(this.level.id)}`, 16, '#c9d1ee', false);
    this.comboText = txt(this, LAUNCH_X, 548, '', 20, '#ff9f43').setDepth(5).setVisible(false);
    this.muteText = txt(this, WIDTH - 24, 700, isMutedNow() ? '🔇' : '🔊', 18).setInteractive({ useHandCursor: true });
    this.muteText.on('pointerup', () => this.muteText.setText(toggleMute() ? '🔇' : '🔊'));
    this.pumpLabel = txt(this, LAUNCH_X, 708, 'PUMP', 11, '#9aa6cf');
    this.pips = this.add.graphics();

    // Row timer: a gauge down the right edge that fills as the next row of holds gets closer.
    this.gaugeFill = null;
    if ((this.level.dropInterval ?? 0) > 0) {
      this.add.rectangle(GAUGE_X, (GAUGE_TOP + GAUGE_BOTTOM) / 2, 8, GAUGE_BOTTOM - GAUGE_TOP + 2, 0x1a1f2c).setStrokeStyle(1, 0x55608a);
      this.gaugeFill = this.add.rectangle(GAUGE_X, GAUGE_TOP, 6, 0, 0x55608a).setOrigin(0.5, 0);
      txt(this, GAUGE_X, GAUGE_BOTTOM + 14, 'ROW', 9, '#9aa6cf');
    }

    const pause = this.add.rectangle(WIDTH - 15, 22, 24, 30, 0x000000, 0.35).setInteractive({ useHandCursor: true });
    txt(this, WIDTH - 15, 22, '❚❚', 10, '#c9d1ee');
    pause.on('pointerup', () => this.setPaused(true));
  }

  private buildLauncher(): void {
    this.guide = this.add.graphics();
    this.ghost = this.add.image(0, 0, 'hold-0').setAlpha(0.35).setVisible(false);
    // the bag's mouth sits just under the loaded hold, so the hold pokes out of it
    this.bag = new ChalkBag(this, LAUNCH_X, LAUNCH_Y + 8);
    this.curSprite = this.add.image(LAUNCH_X, LAUNCH_Y, `hold-${this.engine.cur}`).setDepth(7);
    this.time.addEvent({ delay: 1300, loop: true, callback: () => this.state === 'aiming' && !this.paused && this.bag.drip() });
    this.nxtSprite = this.add.image(LAUNCH_X + 120, LAUNCH_Y + 22, `hold-${this.engine.nxt}`).setScale(0.7);
    txt(this, LAUNCH_X + 120, LAUNCH_Y - 8, 'NEXT', 11, '#9aa6cf');
    this.baseClimber = makeClimber(this, 80, 690, 1.3);
    this.tweens.add({ targets: this.baseClimber, y: 686, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private buildInput(): void {
    this.keys = this.input.keyboard!.addKeys('LEFT,RIGHT,A,D,SPACE,UP,S,DOWN,R,M,ESC,P') as Record<string, Phaser.Input.Keyboard.Key>;
    const aimAt = (p: Phaser.Input.Pointer) => {
      if (this.state !== 'aiming' || this.paused || p.y > LAUNCH_Y - 20) return;
      this.aim = Phaser.Math.Clamp(Math.atan2(p.x - LAUNCH_X, LAUNCH_Y - p.y), -MAX_AIM, MAX_AIM);
    };
    this.input.on('pointermove', aimAt);
    this.input.on('pointerdown', aimAt);
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      unlockAudio();
      if (this.state !== 'aiming' || this.paused) return;
      if (p.x < GRID_X || p.x > WIDTH - GRID_X) return; // side margins hold the track and pause button
      if (Phaser.Math.Distance.Between(p.x, p.y, this.nxtSprite.x, this.nxtSprite.y) < 32) this.swap();
      else if (p.y < LAUNCH_Y + 40) this.fire();
    });
    this.keys.SPACE.on('down', () => this.fire());
    this.keys.UP.on('down', () => this.fire());
    this.keys.S.on('down', () => this.swap());
    this.keys.DOWN.on('down', () => this.swap());
    this.keys.R.on('down', () => this.restart());
    this.keys.ESC.on('down', () => this.setPaused(!this.paused));
    this.keys.P.on('down', () => this.setPaused(!this.paused));
    this.keys.M.on('down', () => this.muteText.setText(toggleMute() ? '🔇' : '🔊'));
  }

  // ---------- helpers ----------

  private pos(r: number, c: number): { x: number; y: number } {
    return { x: GRID_X + this.engine.grid.cellX(r, c), y: this.engine.grid.cellY(r) };
  }

  private makeSprite(hold: Hold, r: number, c: number): Phaser.GameObjects.Image {
    const { x, y } = this.pos(r, c);
    const img = this.add.image(x, y, textureFor(hold));
    this.sprites.set(hold, img);
    return img;
  }

  private shake(duration: number, intensity: number): void {
    if (getShake()) this.cameras.main.shake(duration, intensity);
  }

  private refreshQueue(): void {
    const { cur, nxt } = this.engine;
    this.curSprite.setTexture(`hold-${cur}`);
    this.nxtSprite.setTexture(`hold-${nxt}`);
    if (cur === WILD || nxt === WILD) this.hint('wild', 'Mega jug! It turns into whichever colour pops the most where it lands');
    if (cur === BOMB || nxt === BOMB) this.hint('bomb', 'Chalk bomb! It clears every hold it touches');
  }

  private swap(): void {
    if (this.state !== 'aiming' || this.paused) return;
    this.engine.swap();
    this.refreshQueue();
    sfx.bounce();
  }

  private refreshPips(): void {
    const n = this.level.shotsPerDrop;
    const startX = LAUNCH_X + 14 - ((n - 1) * 22) / 2;
    this.pumpLabel.setX(startX - 36);
    this.pips.clear();
    for (let i = 0; i < n; i++) {
      const used = i < this.engine.misses;
      this.pips.fillStyle(used ? 0xe5484d : 0xf4f4f0, used ? 1 : 0.85).fillCircle(startX + i * 22, 708, 6);
    }
  }

  private updateProgress(animate = true): void {
    const y = TRACK_BOTTOM - (TRACK_BOTTOM - TRACK_TOP) * this.engine.progress();
    if (animate) this.tweens.add({ targets: this.trackClimber, y, duration: 350, ease: 'Sine.easeOut' });
    else this.trackClimber.y = y;
  }

  private popup(x: number, y: number, text: string, color = '#ffd166', size = 18): void {
    const t = txt(this, x, y, text, size, color).setDepth(50);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  private chalkBurst(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      const p = this.add.image(x, y, 'chalk').setAlpha(0.9).setDepth(40);
      this.tweens.add({
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

  // ---------- hints ----------

  /** Show a one-off tip. Each tip appears once ever, queued so they never overlap. */
  private hint(id: string, text: string): void {
    if (hintSeen(id) || this.hintQueue.some((h) => h.id === id)) return;
    this.hintQueue.push({ id, text });
    this.nextHint();
  }

  private nextHint(): void {
    if (this.hintShowing || this.paused || this.state === 'over') return;
    const next = this.hintQueue.shift();
    if (!next) return;
    this.hintShowing = true;
    markHint(next.id);
    const label = txt(this, 0, 0, next.text, 14).setWordWrapWidth(430);
    const box = this.add.rectangle(0, 0, 470, label.height + 18, 0x0d1020, 0.9).setStrokeStyle(2, 0xffd166, 0.8);
    this.hintBox = this.add.container(WIDTH / 2, 546, [box, label]).setDepth(70).setAlpha(0);
    this.tweens.add({ targets: this.hintBox, alpha: 1, duration: 200 });
    this.time.delayedCall(HINT_MS, () => {
      const hb = this.hintBox;
      if (!hb) return;
      this.tweens.add({
        targets: hb,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          hb.destroy();
          this.hintBox = null;
          this.hintShowing = false;
          this.nextHint();
        },
      });
    });
  }

  // ---------- shooting ----------

  private fire(): void {
    if (this.state !== 'aiming' || this.paused) return;
    const type = this.engine.shoot();
    const f = this.engine.launch(this.aim);
    const sprite = this.add.image(LAUNCH_X, LAUNCH_Y, `hold-${type}`).setDepth(10);
    this.flight = { ...f, type, sprite };
    this.refreshQueue();
    // chalk puff out of the bag, and the next hold pops up into the mouth
    chalkPuff(this, LAUNCH_X, LAUNCH_Y, Math.sin(this.aim), -Math.cos(this.aim));
    this.bag.kick();
    this.curSprite.setScale(0.3);
    this.tweens.add({ targets: this.curSprite, scale: 1, duration: 200, delay: 90, ease: 'Back.easeOut' });
    this.guide.clear();
    this.ghost.setVisible(false);
    this.state = 'flying';
    sfx.shoot();
  }

  private drawGuide(): void {
    this.guide.clear();
    const { end, points } = this.engine.trace(this.aim);
    this.guide.fillStyle(0xffffff, 0.55);
    points.forEach((p, i) => {
      if (i % 2 === 1) this.guide.fillCircle(GRID_X + p.x, p.y, 2.5);
    });
    const cell = this.engine.preview(end.x, end.y);
    if (!cell) {
      this.ghost.setVisible(false);
      return;
    }
    const { x, y } = this.pos(cell[0], cell[1]);
    const type = this.engine.cur === WILD ? this.engine.resolveWild(cell) : this.engine.cur;
    this.ghost.setTexture(`hold-${type}`).setPosition(x, y).setVisible(true);
  }

  update(_time: number, delta: number): void {
    if (this.paused) return;
    const dt = delta / 1000;
    if (this.state === 'aiming' || this.state === 'flying') this.runTimer(dt);
    if (this.state === 'aiming') {
      const left = this.keys.LEFT.isDown || this.keys.A.isDown;
      const right = this.keys.RIGHT.isDown || this.keys.D.isDown;
      if (left) this.aim -= 1.6 * dt;
      if (right) this.aim += 1.6 * dt;
      this.aim = Phaser.Math.Clamp(this.aim, -MAX_AIM, MAX_AIM);
      this.bag.tilt(this.aim);
      this.drawGuide();
    } else if (this.state === 'flying' && this.flight) {
      const f = this.flight;
      const before = f.bounces;
      const hit = this.engine.advance(f, SPEED * dt);
      if (f.bounces > before) sfx.bounce();
      f.sprite.setPosition(GRID_X + f.x, f.y);
      if (hit) this.land(f);
    }
  }

  // ---------- the row timer ----------

  /** Advance the drop timer, add a row when it runs out, and keep the gauge, tick and music in step. */
  private runTimer(dt: number): void {
    const t = this.engine.tick(dt);
    if (t) {
      this.showDropRow(t.newRow, 'TIME!  The wall drops');
      this.updateProgress();
      this.lastTickSec = -1;
      if (t.lost) {
        this.endGame(false);
        return;
      }
    }
    const frac = this.engine.timerFraction();
    if (this.gaugeFill) {
      const warn = Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(0x55, 0x60, 0x8a), new Phaser.Display.Color(0xe5, 0x48, 0x4d), 100, Math.round(frac * 100));
      this.gaugeFill.setFillStyle(Phaser.Display.Color.GetColor(warn.r, warn.g, warn.b));
      this.gaugeFill.setSize(6, (GAUGE_BOTTOM - GAUGE_TOP) * frac);
      this.gaugeFill.setAlpha(frac > 0.8 ? 0.65 + 0.35 * Math.sin(this.time.now / 70) : 1);
      // a soft tick for each of the last three seconds
      const left = (this.level.dropInterval ?? 0) * (1 - frac);
      const sec = Math.ceil(left);
      if (left <= 3 && sec !== this.lastTickSec) {
        this.lastTickSec = sec;
        sfx.tick();
      }
    }
    // busier music as the wall gets low or the timer is about to run out
    const wall = Phaser.Math.Clamp((this.engine.grid.lowestRow() - 7) / (LOSE_ROW - 1 - 7), 0, 1);
    const time = Phaser.Math.Clamp((frac - 0.5) / 0.5, 0, 1);
    setIntensity(0.25 + 0.75 * Math.max(wall, time));
  }

  // ---------- resolving a shot ----------

  private land(f: Flying): void {
    this.state = 'resolving';
    this.flight = null;
    const res = this.engine.land(f.type, f.x, f.y, f.bounces);
    f.sprite.destroy();
    if (!res.placed) return this.endGame(false, res);

    const [r, c] = res.placed.cell;
    const img = this.makeSprite(res.placed.hold, r, c);
    const target = this.pos(r, c);
    img.setPosition(GRID_X + f.x, f.y);
    this.tweens.add({
      targets: img,
      x: target.x,
      y: target.y,
      duration: res.placed.slid ? 260 : 60,
      ease: res.placed.slid ? 'Bounce.easeOut' : 'Linear',
      onComplete: () => {
        // a hold that pops is already on its way out, so only the ones that stay get to settle
        if (!res.popped.length) this.settle(img, r, c, !res.newRow);
      },
    });
    if (res.placed.slid) sfx.slide();
    else sfx.land();
    if (res.placed.wild) this.revealWild(target.x, target.y, res.placed.hold.type);
    chalkPuff(this, target.x, target.y, 0, 1, 0.45, 12); // a little chalk dust where it sticks

    this.scoreText.setText(`Score ${this.engine.score}`);
    this.showCombo(res.combo);

    if (res.popped.length) this.celebratePop(res, target);
    else {
      if (res.newRow) this.showDropRow(res.newRow);
      this.hint('match', 'Match 3 or more of the same hold to pop them');
      if (this.engine.misses > 0) this.hint('pump', 'Misses fill the pump pips. Fill them all and the wall drops a row');
    }

    for (const h of res.cracked) {
      const s = this.sprites.get(h);
      if (!s) continue;
      s.setTexture(textureFor(h));
      this.tweens.add({ targets: s, angle: { from: -8, to: 8 }, duration: 60, yoyo: true, repeat: 2, onComplete: () => s.setAngle(0) });
      sfx.crack();
    }

    this.refreshPips();
    this.updateProgress();

    if (res.won || res.lost) return this.endGame(res.won, res);
    this.refreshQueue();
    this.time.delayedCall(300, () => {
      if (this.state === 'resolving') this.state = 'aiming';
    });
  }

  /** A mega jug showing its true colour: a ring of coloured flecks. */
  private revealWild(x: number, y: number, type: number): void {
    sfx.wild();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10;
      const fleck = this.add.image(x, y, 'chalk').setTint(HOLD_COLOURS[type]).setDepth(40).setScale(1.2);
      this.tweens.add({
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

  /** A landed hold squashes on impact and springs back, and its neighbours get a small nudge. */
  private settle(img: Phaser.GameObjects.Image, r: number, c: number, ripple: boolean): void {
    if (!img.active) return;
    this.tweens.add({
      targets: img,
      scaleX: 1.2,
      scaleY: 0.82,
      duration: 60,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (!img.active) return;
        this.tweens.add({ targets: img, scaleX: 1, scaleY: 1, duration: 320, ease: 'Elastic.easeOut', easeParams: [1, 0.5] });
      },
    });
    if (!ripple) return;
    const grid = this.engine.grid;
    for (const [nr, nc] of grid.neighbors(r, c)) {
      const hold = grid.get(nr, nc);
      const s = hold && this.sprites.get(hold);
      if (!s || s === img) continue;
      const dx = s.x - img.x;
      const dy = s.y - img.y;
      const len = Math.hypot(dx, dy) || 1;
      this.tweens.add({ targets: s, x: s.x + (dx / len) * 3.5, y: s.y + (dy / len) * 3.5, duration: 70, yoyo: true, ease: 'Sine.easeOut' });
    }
  }

  private celebratePop(res: ShotResult, at: { x: number; y: number }): void {
    this.removeHolds(res.popped, 'pop');
    sfx.pop(res.popped.length, res.combo);
    const mult = res.combo > 1 ? ` x${(1 + 0.2 * Math.min(res.combo - 1, 5)).toFixed(1)}` : '';
    this.popup(at.x, at.y, `+${res.pop + res.bank}${mult}`);
    if (res.bank) this.popup(at.x, at.y + 24, `Bank shot! +${res.bank}`, '#7ae6dc', 15);
    if (res.fallen.length) {
      this.removeHolds(res.fallen, 'fall');
      this.popup(at.x, at.y + 48, `Drop x${res.fallen.length}! +${res.fall}`, '#ffb86b');
      sfx.fall();
    }
    if (res.popped.length + res.fallen.length >= 8) this.shake(180, 0.004);
    this.hint('cut', 'Holds cut off from the top fall away for bonus points');
    if (res.combo >= 2) this.hint('combo', 'Pop on back-to-back shots to build a combo multiplier');
  }

  private showCombo(combo: number): void {
    if (combo < 2) return void this.comboText.setVisible(false);
    this.comboText.setText(`COMBO x${combo}`).setVisible(true).setScale(1.4);
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  private removeHolds(list: Removed[], mode: 'pop' | 'fall'): void {
    list.forEach(({ hold }, i) => {
      const sprite = this.sprites.get(hold);
      this.sprites.delete(hold);
      if (!sprite) return;
      if (mode === 'pop') {
        this.chalkBurst(sprite.x, sprite.y);
        this.tweens.add({ targets: sprite, scale: 1.4, alpha: 0, duration: 180, delay: i * 25, onComplete: () => sprite.destroy() });
      } else {
        this.tweens.add({
          targets: sprite,
          y: sprite.y + 500 + Math.random() * 150,
          angle: Phaser.Math.Between(-120, 120),
          alpha: 0.2,
          duration: 700,
          delay: Math.random() * 150,
          ease: 'Quad.easeIn',
          onComplete: () => sprite.destroy(),
        });
      }
    });
  }

  private showDropRow(newRow: Hold[], label = 'PUMPED!  The wall drops'): void {
    const grid = this.engine.grid;
    newRow.forEach((hold, c) => {
      this.makeSprite(hold, 0, c).y -= H;
    });
    for (const [r, c] of grid.cells()) {
      const img = this.sprites.get(grid.get(r, c)!);
      const target = this.pos(r, c);
      if (img) this.tweens.add({ targets: img, x: target.x, y: target.y, duration: 250, ease: 'Back.easeOut' });
    }
    const t = txt(this, WIDTH / 2, 250, label, 26, '#ff8a8a').setDepth(60);
    this.tweens.add({ targets: t, alpha: 0, y: 220, duration: 1200, delay: 300, onComplete: () => t.destroy() });
    this.shake(200, 0.006);
    sfx.drop();
  }

  // ---------- end of round ----------

  private endGame(won: boolean, res?: ShotResult): void {
    this.state = 'over';
    stopMusic(1.2);
    this.guide.clear();
    this.ghost.setVisible(false);
    this.hintQueue = [];
    this.hintBox?.destroy();
    this.hintBox = null;
    let bonus = 0;
    let flash = false;
    if (won) {
      this.removeHolds(res?.leftover ?? [], 'fall');
      ({ bonus, flash } = this.engine.finishWin());
      this.scoreText.setText(`Score ${this.engine.score}`);
      this.tweens.add({ targets: this.trackClimber, y: TRACK_TOP, duration: 500 });
      // the climber tops out in a cloud of chalk, and the bag sends a big puff straight up
      this.time.delayedCall(500, () => {
        chalkPuff(this, TRACK_X + 6, TRACK_TOP - 4, 1, -0.3, 0.6, 90);
        const top = txt(this, TRACK_X + 46, TRACK_TOP + 12, 'TOP!', 16, '#ffd166').setDepth(90).setScale(0.2);
        this.tweens.add({ targets: top, scale: 1.2, duration: 250, ease: 'Back.easeOut' });
        this.tweens.add({ targets: top, alpha: 0, duration: 400, delay: 1100, onComplete: () => top.destroy() });
      });
      chalkPuff(this, LAUNCH_X, LAUNCH_Y, 0, -1, 1.8, 90);
      this.bag.kick();
      this.tweens.add({ targets: this.baseClimber, y: 650, duration: 220, yoyo: true, repeat: 4 });
      sfx.win();
      this.sendMoment(flash);
    } else {
      this.tweens.add({ targets: this.trackClimber, y: TRACK_BOTTOM + 90, angle: 270, alpha: 0, duration: 700, ease: 'Quad.easeIn' });
      this.tweens.add({ targets: this.baseClimber, angle: 90, duration: 300 });
      this.shake(300, 0.01);
      sfx.lose();
    }
    recordResult(this.level.id, this.engine.score, won);
    this.time.delayedCall(won ? 2000 : 900, () => this.showOverlay(won, bonus, flash));
  }

  /** Big "SENT!" with a flash and a shower of chalk and tape. */
  private sendMoment(flash: boolean): void {
    this.cameras.main.flash(250, 255, 255, 255);
    const t = txt(this, WIDTH / 2, 300, flash ? 'FLASH!' : 'SENT!', 90, '#ffd166').setDepth(90).setScale(0.1);
    this.tweens.add({ targets: t, scale: 1, duration: 450, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, duration: 300, delay: 1500, onComplete: () => t.destroy() });
    for (let i = 0; i < 70; i++) {
      const colour = i % 3 === 0 ? 0xffffff : HOLD_COLOURS[i % HOLD_COLOURS.length];
      const bit = this.add.rectangle(Phaser.Math.Between(GRID_X, WIDTH - GRID_X), -20, 8, 14, colour).setDepth(80);
      this.tweens.add({
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

  private leave(): void {
    this.scene.start(this.data0.from === 'editor' ? 'Editor' : 'Menu', { code: this.data0.code });
  }

  private restart(): void {
    this.scene.restart(this.data0);
  }

  private showOverlay(won: boolean, bonus: number, flash: boolean): void {
    const e = this.engine;
    const c = this.add.container(0, 0).setDepth(100);
    c.add(this.add.rectangle(WIDTH / 2, 360, WIDTH, 720, 0x000000, 0.7).setInteractive());
    c.add(txt(this, WIDTH / 2, 170, won ? 'SENT!' : 'FELL!', 64, won ? '#ffd166' : '#ff8a8a'));
    c.add(txt(this, WIDTH / 2, 230, `${this.level.custom ? 'Custom route' : this.level.label}  ·  Score ${e.score}`, 24));
    c.add(txt(this, WIDTH / 2, 264, `Best ${getBest(this.level.id)}  ·  Best combo x${e.bestCombo}`, 16, '#c9d1ee', false));
    if (won) c.add(txt(this, WIDTH / 2, 298, flash ? `FLASH! No pumps. Bonus +${bonus}` : `Route bonus +${bonus}`, 18, '#ffd166'));
    let y = 370;
    if (won && !this.level.daily && !this.level.custom) {
      c.add(makeButton(this, WIDTH / 2, y, 260, 54, `Next: V${this.level.grade + 1}`, () => this.scene.restart({ level: gradeLevel(this.level.grade + 1) }), 0x2e8b57));
      y += 70;
    }
    c.add(makeButton(this, WIDTH / 2, y, 260, 54, won ? 'Climb again' : 'Try again', () => this.restart()));
    c.add(makeButton(this, WIDTH / 2, y + 70, 260, 54, this.data0.from === 'editor' ? 'Back to editor' : 'Menu', () => this.leave(), 0x59627f));
  }

  // ---------- pause ----------

  private setPaused(on: boolean): void {
    if (this.state === 'over' || on === this.paused) return;
    this.paused = on;
    this.time.paused = on;
    if (on) {
      this.tweens.pauseAll();
      pauseMusic();
    } else {
      this.tweens.resumeAll();
      resumeMusic();
    }
    if (!on) {
      this.pauseUi?.destroy();
      this.pauseUi = null;
      this.nextHint();
      return;
    }
    const c = this.add.container(0, 0).setDepth(200);
    this.pauseUi = c;
    c.add(this.add.rectangle(WIDTH / 2, 360, WIDTH, 720, 0x000000, 0.75).setInteractive());
    c.add(txt(this, WIDTH / 2, 150, 'PAUSED', 54, '#ffd166'));
    const label = (b: Phaser.GameObjects.Container) => b.list[1] as Phaser.GameObjects.Text;
    const toggle = (y: number, text: () => string, flip: () => void): Phaser.GameObjects.Container => {
      const b: Phaser.GameObjects.Container = makeButton(this, WIDTH / 2, y, 280, 48, text(), () => {
        flip();
        label(b).setText(text());
      }, 0x59627f);
      return b;
    };
    c.add(makeButton(this, WIDTH / 2, 235, 280, 48, 'Resume', () => this.setPaused(false), 0x2e8b57));
    c.add(makeButton(this, WIDTH / 2, 293, 280, 48, 'Restart', () => this.restart(), 0x2f6fdd));
    c.add(toggle(351, () => `Sound: ${isMutedNow() ? 'off' : 'on'}`, () => {
      toggleMute();
      this.muteText.setText(isMutedNow() ? '🔇' : '🔊');
    }));
    c.add(toggle(409, () => `Music: ${getMusic() ? 'on' : 'off'}`, () => void toggleMusic()));
    c.add(toggle(467, () => `Screen shake: ${getShake() ? 'on' : 'off'}`, () => setShake(!getShake())));
    c.add(makeButton(this, WIDTH / 2, 525, 280, 48, this.data0.from === 'editor' ? 'Back to editor' : 'Menu', () => this.leave(), 0x8a3b3b));
    c.add(txt(this, WIDTH / 2, 575, 'P or Esc to resume', 14, '#9aa6cf', false));
  }
}
