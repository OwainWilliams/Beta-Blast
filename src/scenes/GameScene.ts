import Phaser from 'phaser';
import { GRID_X, LAUNCH_X, LAUNCH_Y, LOSE_ROW, LOSE_Y, WIDTH } from '../config';
import { BOMB, Cell, Grid, H, Hold, R } from '../game/grid';
import { gradeLevel, LevelSpec, MAX_GRADE, mulberry32 } from '../game/levels';
import { isMutedNow, sfx, toggleMute, unlockAudio } from '../game/audio';
import { getBest, recordResult } from '../game/storage';
import { makeButton, makeClimber, txt } from '../ui';

const SPEED = 950; // px/s
const MAX_AIM = 1.35; // radians from vertical
const TRACK_X = 15;
const TRACK_TOP = 40;
const TRACK_BOTTOM = 520;
const MIN_X = GRID_X + R;
const MAX_X = WIDTH - GRID_X - R;

type State = 'aiming' | 'flying' | 'resolving' | 'over';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: number;
  bounces: number;
  sprite: Phaser.GameObjects.Image;
}

export class GameScene extends Phaser.Scene {
  private level!: LevelSpec;
  private grid!: Grid;
  private rng!: () => number;
  private sprites = new Map<Hold, Phaser.GameObjects.Image>();
  private state: State = 'aiming';

  private aim = 0;
  private ball: Ball | null = null;
  private cur = 0;
  private nxt = 0;
  private curSprite!: Phaser.GameObjects.Image;
  private nxtSprite!: Phaser.GameObjects.Image;
  private barrel!: Phaser.GameObjects.Image;
  private guide!: Phaser.GameObjects.Graphics;
  private pips!: Phaser.GameObjects.Graphics;
  private scoreText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;
  private trackClimber!: Phaser.GameObjects.Container;
  private baseClimber!: Phaser.GameObjects.Container;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private score = 0;
  private misses = 0;
  private drops = 0;
  private startCount = 1;

  constructor() {
    super('Game');
  }

  init(data: { level?: LevelSpec }): void {
    this.level = data.level ?? gradeLevel(0);
  }

  create(): void {
    this.sprites.clear();
    this.score = 0;
    this.misses = 0;
    this.drops = 0;
    this.ball = null;
    this.aim = 0;
    this.state = 'aiming';
    this.grid = new Grid();
    this.rng = mulberry32(this.level.seed);

    this.add.image(0, 0, 'wall').setOrigin(0);
    this.buildWall();
    this.startCount = Math.max(1, this.grid.count());

    // lose line
    const line = this.add.graphics();
    line.lineStyle(3, 0xe5484d, 0.7);
    for (let x = GRID_X; x < WIDTH - GRID_X; x += 16) line.lineBetween(x, LOSE_Y, x + 8, LOSE_Y);

    this.buildTrack();
    this.buildHud();
    this.buildLauncher();
    this.buildInput();
    this.refreshPips();
    this.updateProgress(false);
    // Key objects outlive the scene, so drop our listeners on shutdown.
    this.events.once('shutdown', () => Object.values(this.keys).forEach((k) => k.removeAllListeners()));
  }

  // ---------- setup ----------

  private buildWall(): void {
    const { rows, colours } = this.level;
    for (let r = 0; r < rows; r++) {
      this.grid.ensureRow(r);
      for (let c = 0; c < this.grid.rowLength(r); c++) {
        // bias towards the neighbouring colour so the wall forms clusters
        const left = c > 0 ? this.grid.get(r, c - 1) : null;
        const type = left && this.rng() < 0.35 ? left.type : Math.floor(this.rng() * colours);
        const hold = { type };
        this.grid.set(r, c, hold);
        this.makeSprite(hold, r, c);
      }
    }
  }

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
    txt(this, GRID_X + 40, 575, this.level.label, 22, '#ffd166');
    this.scoreText = txt(this, LAUNCH_X, 575, 'Score 0', 20);
    txt(this, WIDTH - GRID_X - 60, 575, `Best ${getBest(this.level.id)}`, 16, '#c9d1ee', false);
    this.muteText = txt(this, WIDTH - 24, 700, isMutedNow() ? '🔇' : '🔊', 18).setInteractive({ useHandCursor: true });
    this.muteText.on('pointerup', () => this.muteText.setText(toggleMute() ? '🔇' : '🔊'));
    txt(this, LAUNCH_X, 676, 'PUMP', 11, '#9aa6cf');
    this.pips = this.add.graphics();
  }

  private buildLauncher(): void {
    this.guide = this.add.graphics();
    this.barrel = this.add.image(LAUNCH_X, LAUNCH_Y + 10, 'barrel').setOrigin(0.5, 1);
    this.add.circle(LAUNCH_X, LAUNCH_Y + 10, 30, 0x3a4160).setStrokeStyle(3, 0x59627f);
    this.cur = this.pickType();
    this.nxt = this.pickType();
    this.curSprite = this.add.image(LAUNCH_X, LAUNCH_Y, `hold-${this.cur}`);
    this.nxtSprite = this.add.image(LAUNCH_X + 120, LAUNCH_Y + 22, `hold-${this.nxt}`).setScale(0.7);
    txt(this, LAUNCH_X + 120, LAUNCH_Y - 8, 'NEXT', 11, '#9aa6cf');
    this.baseClimber = makeClimber(this, 80, 690, 1.3);
    this.tweens.add({ targets: this.baseClimber, y: 686, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private buildInput(): void {
    this.keys = this.input.keyboard!.addKeys('LEFT,RIGHT,A,D,SPACE,UP,S,DOWN,R,M,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
    const aimAt = (p: Phaser.Input.Pointer) => {
      if (this.state !== 'aiming' || p.y > LAUNCH_Y - 20) return;
      this.aim = Phaser.Math.Clamp(Math.atan2(p.x - LAUNCH_X, LAUNCH_Y - p.y), -MAX_AIM, MAX_AIM);
    };
    this.input.on('pointermove', aimAt);
    this.input.on('pointerdown', aimAt);
    this.input.on('pointerup', (p: Pointer) => {
      unlockAudio();
      if (this.state !== 'aiming') return;
      if (Phaser.Math.Distance.Between(p.x, p.y, this.nxtSprite.x, this.nxtSprite.y) < 32) this.swap();
      else if (p.y < LAUNCH_Y + 40) this.fire();
    });
    this.keys.SPACE.on('down', () => this.fire());
    this.keys.UP.on('down', () => this.fire());
    this.keys.S.on('down', () => this.swap());
    this.keys.DOWN.on('down', () => this.swap());
    this.keys.R.on('down', () => this.scene.restart({ level: this.level }));
    this.keys.ESC.on('down', () => this.scene.start('Menu'));
    this.keys.M.on('down', () => this.muteText.setText(toggleMute() ? '🔇' : '🔊'));
  }

  // ---------- helpers ----------

  private pos(r: number, c: number): { x: number; y: number } {
    return { x: GRID_X + this.grid.cellX(r, c), y: this.grid.cellY(r) };
  }

  private makeSprite(hold: Hold, r: number, c: number): Phaser.GameObjects.Image {
    const { x, y } = this.pos(r, c);
    const img = this.add.image(x, y, `hold-${hold.type}`);
    this.sprites.set(hold, img);
    return img;
  }

  private pickType(): number {
    const present = this.grid.presentTypes();
    if (!present.length) return 0;
    if (this.level.bombs && this.rng() < 1 / 14) return BOMB;
    return present[Math.floor(this.rng() * present.length)];
  }

  private refreshQueue(): void {
    this.curSprite.setTexture(`hold-${this.cur}`);
    this.nxtSprite.setTexture(`hold-${this.nxt}`);
  }

  private swap(): void {
    if (this.state !== 'aiming') return;
    [this.cur, this.nxt] = [this.nxt, this.cur];
    this.refreshQueue();
    sfx.bounce();
  }

  private refreshPips(): void {
    const n = this.level.shotsPerDrop;
    const startX = LAUNCH_X - ((n - 1) * 22) / 2;
    this.pips.clear();
    for (let i = 0; i < n; i++) {
      const used = i < this.misses;
      this.pips.fillStyle(used ? 0xe5484d : 0xf4f4f0, used ? 1 : 0.85).fillCircle(startX + i * 22, 696, 7);
    }
  }

  private updateProgress(animate = true): void {
    const remaining = this.grid.count();
    const t = Phaser.Math.Clamp(1 - remaining / Math.max(this.startCount, remaining), 0, 1);
    const y = TRACK_BOTTOM - (TRACK_BOTTOM - TRACK_TOP) * t;
    if (animate) this.tweens.add({ targets: this.trackClimber, y, duration: 350, ease: 'Sine.easeOut' });
    else this.trackClimber.y = y;
  }

  private addScore(points: number, x: number, y: number, label = ''): void {
    this.score += points;
    this.scoreText.setText(`Score ${this.score}`);
    const t = txt(this, x, y, `${label}${label ? ' ' : ''}+${points}`, 18, '#ffd166').setDepth(50);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 800, onComplete: () => t.destroy() });
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

  // ---------- shooting ----------

  private fire(): void {
    if (this.state !== 'aiming') return;
    const sprite = this.add.image(LAUNCH_X, LAUNCH_Y, `hold-${this.cur}`).setDepth(10);
    this.ball = {
      x: LAUNCH_X,
      y: LAUNCH_Y,
      vx: Math.sin(this.aim) * SPEED,
      vy: -Math.cos(this.aim) * SPEED,
      type: this.cur,
      bounces: 0,
      sprite,
    };
    this.cur = this.nxt;
    this.nxt = this.pickType();
    this.refreshQueue();
    this.guide.clear();
    this.state = 'flying';
    sfx.shoot();
  }

  /** Move a ball `dist` px along its heading, bouncing off the side walls. */
  private advance(b: { x: number; y: number; vx: number; vy: number; bounces: number }, dist: number): boolean {
    const steps = Math.max(1, Math.ceil(dist / 6));
    const len = Math.hypot(b.vx, b.vy);
    let ux = b.vx / len;
    const uy = b.vy / len;
    for (let i = 0; i < steps; i++) {
      b.x += ux * (dist / steps);
      b.y += uy * (dist / steps);
      if (b.x < MIN_X) {
        b.x = 2 * MIN_X - b.x;
        ux = -ux;
        b.vx = -b.vx;
        b.bounces++;
      } else if (b.x > MAX_X) {
        b.x = 2 * MAX_X - b.x;
        ux = -ux;
        b.vx = -b.vx;
        b.bounces++;
      }
      if (b.y <= R) {
        b.y = R;
        return true;
      }
      if (this.grid.collides(b.x - GRID_X, b.y)) return true;
    }
    return false;
  }

  private drawGuide(): void {
    this.guide.clear();
    const b = { x: LAUNCH_X, y: LAUNCH_Y, vx: Math.sin(this.aim), vy: -Math.cos(this.aim), bounces: 0 };
    this.guide.fillStyle(0xffffff, 0.55);
    for (let i = 0; i < 160; i++) {
      const hit = this.advance(b, 12);
      if (i % 2 === 1 || hit) this.guide.fillCircle(b.x, b.y, hit ? 4 : 2.5);
      if (hit) break;
    }
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    if (this.state === 'aiming') {
      const left = this.keys.LEFT.isDown || this.keys.A.isDown;
      const right = this.keys.RIGHT.isDown || this.keys.D.isDown;
      if (left) this.aim -= 1.6 * dt;
      if (right) this.aim += 1.6 * dt;
      this.aim = Phaser.Math.Clamp(this.aim, -MAX_AIM, MAX_AIM);
      this.barrel.setRotation(this.aim);
      this.drawGuide();
    } else if (this.state === 'flying' && this.ball) {
      const b = this.ball;
      const before = b.bounces;
      const hit = this.advance(b, SPEED * dt);
      if (b.bounces > before) sfx.bounce();
      b.sprite.setPosition(b.x, b.y);
      if (hit) this.land(b);
    }
  }

  // ---------- resolving a shot ----------

  private land(b: Ball): void {
    this.state = 'resolving';
    this.ball = null;
    const cell = this.grid.nearestEmpty(b.x - GRID_X, b.y);
    b.sprite.destroy();
    if (!cell) return this.endGame(false);

    const [r, c] = cell;
    const hold: Hold = { type: b.type };
    this.grid.set(r, c, hold);
    const img = this.makeSprite(hold, r, c);
    const target = this.pos(r, c);
    img.setPosition(b.x, b.y);
    this.tweens.add({ targets: img, x: target.x, y: target.y, duration: 60 });
    sfx.land();

    let popped: Cell[] = [];
    if (b.type === BOMB) popped = this.grid.blast(r, c);
    else {
      const match = this.grid.findMatches(r, c);
      if (match.length >= 3) popped = match;
    }

    if (popped.length) {
      this.misses = 0;
      const n = popped.length;
      const bank = b.bounces * 25;
      this.removeHolds(popped, 'pop');
      this.addScore(n * 10 + Math.max(0, n - 3) * 5 + bank, target.x, target.y, bank ? `Bank x${b.bounces}!` : '');
      sfx.pop(n);
      const falling = this.grid.findFloating();
      if (falling.length) {
        this.removeHolds(falling, 'fall');
        const k = falling.length;
        this.addScore((20 * k * (k + 1)) / 2, target.x, target.y + 28, `Drop x${k}!`);
        sfx.fall();
      }
      if (n + falling.length >= 8) this.cameras.main.shake(180, 0.004);
    } else {
      this.misses++;
      if (this.misses >= this.level.shotsPerDrop) this.dropRow();
    }

    this.refreshPips();
    this.updateProgress();

    if (this.grid.count() === 0) return this.endGame(true);
    if (this.grid.lowestRow() >= LOSE_ROW) return this.endGame(false);

    // re-roll queued holds whose colour has been cleared from the wall
    const present = this.grid.presentTypes();
    const stale = (t: number) => t !== BOMB && !present.includes(t);
    if (stale(this.cur)) this.cur = this.pickType();
    if (stale(this.nxt)) this.nxt = this.pickType();
    this.refreshQueue();
    this.time.delayedCall(300, () => {
      if (this.state === 'resolving') this.state = 'aiming';
    });
  }

  private removeHolds(cells: Cell[], mode: 'pop' | 'fall'): void {
    cells.forEach(([r, c], i) => {
      const hold = this.grid.get(r, c);
      if (!hold) return;
      const sprite = this.sprites.get(hold);
      this.grid.set(r, c, null);
      this.sprites.delete(hold);
      if (!sprite) return;
      if (mode === 'pop') {
        this.chalkBurst(sprite.x, sprite.y);
        this.tweens.add({
          targets: sprite,
          scale: 1.4,
          alpha: 0,
          duration: 180,
          delay: i * 25,
          onComplete: () => sprite.destroy(),
        });
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

  private dropRow(): void {
    this.misses = 0;
    this.drops++;
    const present = this.grid.presentTypes();
    const types = Array.from({ length: 10 }, () => present[Math.floor(this.rng() * present.length)] ?? 0);
    this.grid.addRowTop(types);
    for (let c = 0; c < this.grid.rows[0].length; c++) {
      const hold = this.grid.get(0, c)!;
      const img = this.makeSprite(hold, 0, c);
      img.y -= H;
    }
    this.grid.cells().forEach(([r, c]) => {
      const img = this.sprites.get(this.grid.get(r, c)!);
      const target = this.pos(r, c);
      if (img) this.tweens.add({ targets: img, x: target.x, y: target.y, duration: 250, ease: 'Back.easeOut' });
    });
    const t = txt(this, WIDTH / 2, 250, 'PUMPED!  The wall drops', 26, '#ff8a8a').setDepth(60);
    this.tweens.add({ targets: t, alpha: 0, y: 220, duration: 1200, delay: 300, onComplete: () => t.destroy() });
    this.cameras.main.shake(200, 0.006);
    sfx.drop();
  }

  // ---------- end of round ----------

  private endGame(won: boolean): void {
    this.state = 'over';
    this.guide.clear();
    let bonus = 0;
    let flash = false;
    if (won) {
      bonus = 100 * (this.level.grade + 1);
      if (this.drops === 0) {
        flash = true;
        bonus += 500;
      }
      this.score += bonus;
      this.scoreText.setText(`Score ${this.score}`);
      this.tweens.add({ targets: this.trackClimber, y: TRACK_TOP, duration: 500 });
      this.tweens.add({ targets: this.baseClimber, y: 650, duration: 220, yoyo: true, repeat: 4 });
      sfx.win();
    } else {
      this.tweens.add({ targets: this.trackClimber, y: TRACK_BOTTOM + 90, angle: 270, alpha: 0, duration: 700, ease: 'Quad.easeIn' });
      this.tweens.add({ targets: this.baseClimber, angle: 90, duration: 300 });
      this.cameras.main.shake(300, 0.01);
      sfx.lose();
    }
    recordResult(this.level.id, this.score, won);
    this.time.delayedCall(900, () => this.showOverlay(won, bonus, flash));
  }

  private showOverlay(won: boolean, bonus: number, flash: boolean): void {
    const c = this.add.container(0, 0).setDepth(100);
    c.add(this.add.rectangle(WIDTH / 2, 360, WIDTH, 720, 0x000000, 0.7).setInteractive());
    c.add(txt(this, WIDTH / 2, 190, won ? 'SENT!' : 'FELL!', 64, won ? '#ffd166' : '#ff8a8a'));
    c.add(txt(this, WIDTH / 2, 250, `${this.level.label}  ·  Score ${this.score}`, 24));
    c.add(txt(this, WIDTH / 2, 284, `Best ${getBest(this.level.id)}`, 18, '#c9d1ee', false));
    if (won) c.add(txt(this, WIDTH / 2, 320, flash ? `FLASH! No pumps. Bonus +${bonus}` : `Route bonus +${bonus}`, 18, '#ffd166'));
    let y = 390;
    if (won && !this.level.daily && this.level.grade < MAX_GRADE) {
      c.add(makeButton(this, WIDTH / 2, y, 260, 54, `Next: V${this.level.grade + 1}`, () => this.scene.restart({ level: gradeLevel(this.level.grade + 1) }), 0x2e8b57));
      y += 70;
    }
    c.add(makeButton(this, WIDTH / 2, y, 260, 54, won ? 'Climb again' : 'Try again', () => this.scene.restart({ level: this.level })));
    c.add(makeButton(this, WIDTH / 2, y + 70, 260, 54, 'Menu', () => this.scene.start('Menu'), 0x59627f));
  }
}

type Pointer = Phaser.Input.Pointer;
