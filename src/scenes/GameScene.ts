import Phaser from 'phaser';
import { GRID_X, LAUNCH_X, LAUNCH_Y, LOSE_ROW, LOSE_Y, WIDTH } from '../config';
import { Recorder, Replay, STEP } from '../game/replay';
import { Engine, Flight, MAX_AIM, Removed, SPEED, STAGE_BONUS, SWEEP_BONUS, ShotResult } from '../game/engine';
import { BOMB, Cell, Hold, H, SLICK, VOLUME, WILD } from '../game/grid';
import { gradeLevel, LevelSpec, survivalLevel, versusLevel } from '../game/levels';
import { changeGrade, pauseMusic, resumeMusic, setIntensity, startMusic, stopMusic, toggleMusic } from '../game/music';
import { isMutedNow, sfx, toggleMute, unlockAudio } from '../game/audio';
import { getAuth, getBest, getBestTime, getLookCode, getMusic, getPlayerName, getShake, recordResult, recordTime, setShake } from '../game/storage';
import { ChalkBag, chalkPuff } from '../chalkBag';
import { chalkBurst, colourRing, confetti, floatText, popWord } from '../effects';
import { Hints } from '../hints';
import { chooseName } from '../game/account';
import { boardFor, postScore, rememberBoard } from '../game/leaderboard';
import { RoundResult, showLeaveQuestion, showPauseMenu, showRoundResult, showVersusResult } from '../overlays';
import { askName, Climber, makeClimber, textureFor, txt } from '../ui';
import { MAX_ATTACK, MAX_ROWS, Msg } from '../net/protocol';
import { CloseReason, Session } from '../net/session';
import { OpponentPanel } from '../versusPanel';

const TRACK_X = 15;
const TRACK_TOP = 40;
const TRACK_BOTTOM = 520;
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
  versus?: Session; // a two-player match
}

export class GameScene extends Phaser.Scene {
  private data0!: GameData;
  private level!: LevelSpec;
  private engine!: Engine;
  private sprites = new Map<Hold, Phaser.GameObjects.Image>();
  private state: State = 'aiming';
  private paused = false;
  private recorder = new Recorder();
  private stepClock = 0; // real time not yet played as fixed steps
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
  private trackClimber: Climber | null = null;
  private stageText: Phaser.GameObjects.Text | null = null;
  private clockText: Phaser.GameObjects.Text | null = null;
  private lastClock = -1;
  private stageBanner: Phaser.GameObjects.Text[] = [];
  private baseClimber: Climber | null = null;
  private net: Session | null = null;
  private panel: OpponentPanel | null = null;
  private incomingText: Phaser.GameObjects.Text | null = null;
  private opponentGone = false;
  private leaveUi: Phaser.GameObjects.Container | null = null;
  private versusResult: { opponentLeft: () => void } | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private gaugeFill: Phaser.GameObjects.Rectangle | null = null;
  private lastTickSec = -1;

  private hints!: Hints;

  constructor() {
    super('Game');
  }

  init(data: GameData): void {
    this.data0 = data;
    this.level = data.level ?? gradeLevel(0);
  }

  /** A scene object is reused when a round restarts, so everything that belongs to a round starts afresh here. */
  private resetRound(): void {
    this.sprites.clear();
    this.hints = new Hints(this, () => !this.paused && this.state !== 'over');
    this.pauseUi = null;
    this.paused = false;
    this.time.paused = false;
    this.flight = null;
    this.aim = 0;
    this.state = 'aiming';
    this.engine = new Engine(this.level);
    this.recorder = new Recorder();
    this.stepClock = 0;
    this.net = this.data0.versus ?? null;
    this.panel = null;
    this.incomingText = null;
    this.opponentGone = false;
    this.leaveUi = null;
    this.versusResult = null;
    this.baseClimber = null;
    this.trackClimber = null;
    this.lastClock = -1;
    this.lastTickSec = -1;
    this.stageBanner = [];
  }

  create(): void {
    this.resetRound();
    this.add.image(0, 0, 'wall').setOrigin(0);
    for (const [r, c] of this.engine.grid.cells()) this.makeSprite(this.engine.grid.get(r, c)!, r, c);

    const line = this.add.graphics();
    line.lineStyle(3, 0xe5484d, 0.7);
    for (let x = GRID_X; x < WIDTH - GRID_X; x += 16) line.lineBetween(x, LOSE_Y, x + 8, LOSE_Y);

    if (!this.level.survival && !this.level.versus) this.buildTrack();
    this.buildHud();
    this.buildLauncher();
    this.buildInput();
    this.refreshPips();
    this.updateProgress(false);

    this.hints.show('aim', 'Aim with the mouse or your finger, then release to shoot');
    if (this.level.survival) this.hints.show('survival', 'Survival: rows never stop and getting harder. Clear holds to hold them back and last as long as you can');
    if (this.gaugeFill) this.hints.show('timer', 'The gauge on the right fills with time. When it is full, the wall drops a row');
    this.refreshQueue(); // queues the bomb / mega jug tips if one is already loaded
    const kinds = new Set(this.engine.grid.cells().map(([r, c]) => this.engine.grid.get(r, c)!.type));
    if (kinds.has(VOLUME)) this.hints.show('volume', 'Grey volumes crack when you pop holds next to them. Two pops breaks one');
    if (kinds.has(SLICK)) this.hints.show('slick', 'Teal slick holds are greasy: shots that land beside one slide down');

    startMusic(this.level.grade);
    if (this.net) this.startVersus();
    // Key objects outlive the scene, so drop our listeners on shutdown.
    this.events.once('shutdown', () => {
      Object.values(this.keys).forEach((k) => k.removeAllListeners());
      this.net?.setHandler(null); // the match goes on across scenes; the next scene picks it up
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
    this.stageText = null;
    this.clockText = null;
    if (this.level.survival) this.stageText = txt(this, GRID_X + 48, 575, 'STAGE 1', 20, '#ffd166');
    else txt(this, GRID_X + 40, 575, this.level.custom ? 'Custom' : this.level.label, 22, '#ffd166');
    this.scoreText = txt(this, LAUNCH_X, 575, 'Score 0', 20);
    if (this.level.survival) this.clockText = txt(this, WIDTH - GRID_X - 50, 575, '0:00', 20, '#c9d1ee');
    else if (this.level.versus) this.incomingText = txt(this, WIDTH - GRID_X - 66, 575, '', 14, '#9aa6cf');
    else txt(this, WIDTH - GRID_X - 60, 575, `Best ${getBest(this.level.id)}`, 16, '#c9d1ee', false);
    this.comboText = txt(this, LAUNCH_X, 548, '', 20, '#ff9f43').setDepth(5).setVisible(false);
    this.muteText = txt(this, WIDTH - 24, 700, isMutedNow() ? '🔇' : '🔊', 18).setInteractive({ useHandCursor: true });
    this.muteText.on('pointerup', () => this.toggleSound());
    this.pumpLabel = txt(this, LAUNCH_X, 708, 'PUMP', 11, '#9aa6cf');
    this.pips = this.add.graphics();

    // Row timer: a gauge down the right edge that fills as the next row of holds gets closer.
    this.gaugeFill = null;
    if ((this.level.dropInterval ?? 0) > 0) {
      this.add.rectangle(GAUGE_X, (GAUGE_TOP + GAUGE_BOTTOM) / 2, 8, GAUGE_BOTTOM - GAUGE_TOP + 2, 0x1a1f2c).setStrokeStyle(1, 0x55608a);
      this.gaugeFill = this.add.rectangle(GAUGE_X, GAUGE_TOP, 6, 0, 0x55608a).setOrigin(0.5, 0);
      txt(this, GAUGE_X, GAUGE_BOTTOM + 14, 'ROW', 9, '#9aa6cf');
    }

    // a network match can't be paused, so the button asks whether you want to leave instead
    const pause = this.add.rectangle(WIDTH - 15, 22, 24, 30, 0x000000, 0.35).setInteractive({ useHandCursor: true });
    txt(this, WIDTH - 15, 22, this.level.versus ? '✕' : '❚❚', 10, '#c9d1ee');
    pause.on('pointerup', () => (this.level.versus ? this.askLeave() : this.setPaused(true)));
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
    if (!this.level.versus) {
      this.baseClimber = makeClimber(this, 80, 690, 1.3);
      this.tweens.add({ targets: this.baseClimber, y: 686, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
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
    this.keys.R.on('down', () => !this.level.versus && this.restart());
    this.keys.ESC.on('down', () => (this.level.versus ? this.askLeave() : this.setPaused(!this.paused)));
    this.keys.P.on('down', () => !this.level.versus && this.setPaused(!this.paused));
    this.keys.M.on('down', () => this.toggleSound());
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

  private toggleSound(): void {
    toggleMute();
    this.muteText.setText(isMutedNow() ? '🔇' : '🔊');
  }

  private shake(duration: number, intensity: number): void {
    if (getShake()) this.cameras.main.shake(duration, intensity);
  }

  private refreshQueue(): void {
    const { cur, nxt } = this.engine;
    this.curSprite.setTexture(`hold-${cur}`);
    this.nxtSprite.setTexture(`hold-${nxt}`);
    if (cur === WILD || nxt === WILD) this.hints.show('wild', 'Mega jug! It turns into whichever colour pops the most where it lands');
    if (cur === BOMB || nxt === BOMB) this.hints.show('bomb', 'Chalk bomb! It clears every hold it touches');
  }

  private swap(): void {
    if (this.state !== 'aiming' || this.paused) return;
    this.engine.swap();
    this.recorder.swap();
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
    if (!this.trackClimber) return;
    const y = TRACK_BOTTOM - (TRACK_BOTTOM - TRACK_TOP) * this.engine.progress();
    if (animate) {
      this.tweens.add({ targets: this.trackClimber, y, duration: 350, ease: 'Sine.easeOut' });
      this.trackClimber.climb(350);
    }
    else this.trackClimber.y = y;
  }

  // ---------- shooting ----------

  private fire(): void {
    if (this.state !== 'aiming' || this.paused) return;
    const aim = this.recorder.fire(this.aim);
    const type = this.engine.shoot();
    const f = this.engine.launch(aim);
    const sprite = this.add.image(LAUNCH_X, LAUNCH_Y, `hold-${type}`).setDepth(10);
    this.flight = { ...f, type, sprite };
    this.refreshQueue();
    // chalk puff out of the bag, and the next hold pops up into the mouth
    chalkPuff(this, LAUNCH_X, LAUNCH_Y, Math.sin(aim), -Math.cos(aim));
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

  override update(_time: number, delta: number): void {
    if (this.paused) return;
    const dt = delta / 1000;
    // The engine runs in fixed steps, so a recorded round plays back identically (see replay.ts)
    this.stepClock = Math.min(this.stepClock + dt, 0.25);
    while (this.stepClock >= STEP) {
      this.stepClock -= STEP;
      this.step();
    }
    if (this.state === 'aiming') {
      const left = this.keys.LEFT.isDown || this.keys.A.isDown;
      const right = this.keys.RIGHT.isDown || this.keys.D.isDown;
      if (left) this.aim -= 1.6 * dt;
      if (right) this.aim += 1.6 * dt;
      this.aim = Phaser.Math.Clamp(this.aim, -MAX_AIM, MAX_AIM);
      this.bag.tilt(this.aim);
      this.drawGuide();
    }
  }

  /** One fixed slice of game time: the row timer, and the ball in flight. */
  private step(): void {
    if (this.state === 'aiming' || this.state === 'flying') this.runTimer(STEP);
    if (this.state === 'aiming') this.recorder.aimed();
    else if (this.state === 'flying' && this.flight) {
      const f = this.flight;
      const before = f.bounces;
      const hit = this.engine.advance(f, SPEED * STEP);
      if (f.bounces > before) sfx.bounce();
      f.sprite.setPosition(GRID_X + f.x, f.y);
      if (hit) this.land(f);
    }
  }

  // ---------- the row timer ----------

  /** Advance the drop timer, add a row when it runs out, and keep the gauge, tick and music in step. */
  private runTimer(dt: number): void {
    const t = this.engine.tick(dt);
    if (t?.newRow) {
      // survival rows come every few seconds, so they get a lighter touch than a pump drop
      this.showDropRow(t.newRow, this.level.survival ? '' : 'TIME!  The wall drops');
      this.updateProgress();
      this.lastTickSec = -1;
    }
    if (t?.stage) this.stageUp(t.stage);
    if (t?.lost) {
      this.endGame(false);
      return;
    }
    if (this.clockText) {
      const sec = Math.floor(this.engine.elapsed);
      if (sec !== this.lastClock) {
        this.lastClock = sec;
        this.clockText.setText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
      }
    }
    const frac = this.engine.timerFraction();
    if (this.gaugeFill) {
      const warn = Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(0x55, 0x60, 0x8a), new Phaser.Display.Color(0xe5, 0x48, 0x4d), 100, Math.round(frac * 100));
      this.gaugeFill.setFillStyle(Phaser.Display.Color.GetColor(warn.r, warn.g, warn.b));
      this.gaugeFill.setSize(6, (GAUGE_BOTTOM - GAUGE_TOP) * frac);
      this.gaugeFill.setAlpha(frac > 0.8 ? 0.65 + 0.35 * Math.sin(this.time.now / 70) : 1);
      // a soft tick for each of the last three seconds
      const left = this.engine.currentInterval() * (1 - frac);
      const sec = Math.ceil(left);
      if (left <= 3 && sec !== this.lastTickSec) {
        this.lastTickSec = sec;
        sfx.tick();
      }
    }
    setIntensity(this.musicIntensity(frac));
  }

  /** Busier music as the wall gets low or the timer is about to run out. 0.25 is calm, 1 is about to lose. */
  private musicIntensity(timerFraction: number): number {
    const wall = Phaser.Math.Clamp((this.engine.grid.lowestRow() - 7) / (LOSE_ROW - 1 - 7), 0, 1);
    const time = Phaser.Math.Clamp((timerFraction - 0.5) / 0.5, 0, 1);
    return 0.25 + 0.75 * Math.max(wall, time);
  }

  /** Survival: every colour is gone. Leftover obstacles drop away and three fresh rows arrive. */
  private cleanSweep(res: ShotResult): void {
    this.removeHolds(res.leftover, 'fall');
    this.showDropRow(res.newRow ?? [], `CLEAN SWEEP!  +${SWEEP_BONUS}`, 3);
    sfx.win();
    this.cameras.main.flash(180, 255, 255, 255);
  }

  /** Survival moved up a stage: faster rows, and sometimes something new on the wall. */
  private stageUp(stage: number): void {
    const news: Record<number, string> = { 3: 'Four colours now', 4: 'Volumes appear', 5: 'All five colours', 6: 'Slick holds appear' };
    this.stageText?.setText(`STAGE ${stage}`);
    for (const old of this.stageBanner) old.destroy(); // a new stage replaces any banner still showing
    changeGrade(stage - 1); // the music picks up the pace at the next loop
    sfx.stage();
    const banner = txt(this, WIDTH / 2, 300, `STAGE ${stage}`, 60, '#ffd166').setDepth(70).setScale(0.3);
    const lines = [`+${STAGE_BONUS}  ·  rows come faster`, news[stage]].filter(Boolean).join('\n');
    const sub = txt(this, WIDTH / 2, 352, lines, 18, '#ffffff').setDepth(70).setAlpha(0);
    this.tweens.add({ targets: banner, scale: 1, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 300, delay: 150 });
    this.stageBanner = [banner, sub];
    this.tweens.add({ targets: [banner, sub], alpha: 0, duration: 400, delay: 1700, onComplete: () => { banner.destroy(); sub.destroy(); } });
    this.scoreText.setText(`Score ${this.engine.score}`);
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
        if (!res.popped.length) this.settle(img, r, c, !res.newRow && !res.incoming);
      },
    });
    if (res.placed.slid) sfx.slide();
    else sfx.land();
    if (res.placed.wild) this.revealWild(target.x, target.y, res.placed.hold.type);
    chalkPuff(this, target.x, target.y, 0, 1, 0.45, 12); // a little chalk dust where it sticks

    this.scoreText.setText(`Score ${this.engine.score}`);
    this.showCombo(res.combo);

    if (res.popped.length) {
      this.celebratePop(res, target);
      if (res.sweep) this.cleanSweep(res);
    } else {
      this.hints.show('match', 'Match 3 or more of the same hold to pop them');
      if (this.engine.misses > 0) this.hints.show('pump', 'Misses fill the pump pips. Fill them all and the wall drops a row');
    }

    // rows that landed on this shot: the pump drop and/or rows the opponent sent
    if (!res.sweep) {
      const added = [...(res.newRow ?? []), ...(res.incoming ?? [])];
      if (added.length) {
        const label = res.incomingRows ? `INCOMING!  +${res.incomingRows}` : 'PUMPED!  The wall drops';
        this.showDropRow(added, label, (res.newRow ? 1 : 0) + res.incomingRows);
      }
    }
    if (this.net) this.versusAfterShot(res, target);

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

  /** A mega jug showing its true colour. */
  private revealWild(x: number, y: number, type: number): void {
    sfx.wild();
    colourRing(this, x, y, type);
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
    floatText(this, at.x, at.y, `+${res.pop + res.bank}${mult}`);
    if (res.bank) floatText(this, at.x, at.y + 24, `Bank shot! +${res.bank}`, '#7ae6dc', 15);
    if (res.fallen.length) {
      this.removeHolds(res.fallen, 'fall');
      floatText(this, at.x, at.y + 48, `Drop x${res.fallen.length}! +${res.fall}`, '#ffb86b');
      sfx.fall();
    }
    if (res.popped.length + res.fallen.length >= 8) this.shake(180, 0.004);
    this.hints.show('cut', 'Holds cut off from the top fall away for bonus points');
    if (res.combo >= 2) this.hints.show('combo', 'Pop on back-to-back shots to build a combo multiplier');
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
        chalkBurst(this, sprite.x, sprite.y);
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

  /** Animate new rows arriving at the top. `rows` is how many were added at once; an empty label skips the banner. */
  private showDropRow(newHolds: Hold[], label = 'PUMPED!  The wall drops', rows = 1): void {
    const grid = this.engine.grid;
    const where = new Map<Hold, Cell>();
    for (const [r, c] of grid.cells()) where.set(grid.get(r, c)!, [r, c]);
    for (const hold of newHolds) {
      const cell = where.get(hold);
      if (cell) this.makeSprite(hold, cell[0], cell[1]).y -= H * rows;
    }
    for (const [r, c] of grid.cells()) {
      const img = this.sprites.get(grid.get(r, c)!);
      const target = this.pos(r, c);
      if (img) this.tweens.add({ targets: img, x: target.x, y: target.y, duration: 250, ease: 'Back.easeOut' });
    }
    if (label) {
      const t = txt(this, WIDTH / 2, 250, label, 26, label.startsWith('CLEAN') ? '#ffd166' : '#ff8a8a').setDepth(60);
      this.tweens.add({ targets: t, alpha: 0, y: 220, duration: 1200, delay: 300, onComplete: () => t.destroy() });
    }
    this.shake(label ? 200 : 120, label ? 0.006 : 0.003);
    sfx.drop();
  }

  // ---------- end of round ----------

  private endGame(won: boolean, res?: ShotResult, reason?: CloseReason): void {
    this.state = 'over';
    this.flight?.sprite.destroy(); // the timer or the opponent can end the game while a shot is in the air
    this.flight = null;
    if (this.net && !won) this.net.send({ t: 'over' });
    this.leaveUi?.destroy();
    this.leaveUi = null;
    this.paused = false;
    stopMusic(1.2);
    this.guide.clear();
    this.ghost.setVisible(false);
    this.hints.clear();
    let bonus = 0;
    let flash = false;
    const previousBest = getBest(this.level.id);
    const previousTime = getBestTime(this.level.id);
    if (won) {
      this.removeHolds(res?.leftover ?? [], 'fall');
      if (!this.level.versus) ({ bonus, flash } = this.engine.finishWin());
      this.scoreText.setText(`Score ${this.engine.score}`);
      if (this.trackClimber) {
        this.tweens.add({ targets: this.trackClimber, y: TRACK_TOP, duration: 500 });
        this.trackClimber.climb(500);
      }
      // the climber tops out in a cloud of chalk, and the bag sends a big puff straight up
      this.time.delayedCall(500, () => {
        chalkPuff(this, TRACK_X + 6, TRACK_TOP - 4, 1, -0.3, 0.6, 90);
        popWord(this, 'TOP!', { x: TRACK_X + 46, y: TRACK_TOP + 12, size: 16, from: 0.2, to: 1.2, growMs: 250, holdMs: 1100, fadeMs: 400 });
      });
      chalkPuff(this, LAUNCH_X, LAUNCH_Y, 0, -1, 1.8, 90);
      this.bag.kick();
      if (this.baseClimber) this.tweens.add({ targets: this.baseClimber, y: 650, duration: 220, yoyo: true, repeat: 4 });
      sfx.win();
      this.sendMoment(this.level.versus ? 'YOU WIN!' : flash ? 'FLASH!' : 'SENT!');
    } else {
      if (this.trackClimber) this.tweens.add({ targets: this.trackClimber, y: TRACK_BOTTOM + 90, angle: 270, alpha: 0, duration: 700, ease: 'Quad.easeIn' });
      if (this.baseClimber) this.tweens.add({ targets: this.baseClimber, angle: 90, duration: 300 });
      this.shake(300, 0.01);
      sfx.lose();
    }
    if (this.level.versus) {
      this.time.delayedCall(won ? 2000 : 900, () => this.showVersusResult(won, reason));
      return;
    }
    recordResult(this.level.id, this.engine.score, won);
    if (this.level.survival) recordTime(this.level.id, this.engine.elapsed);
    const records = { score: this.engine.score > previousBest, time: Math.round(this.engine.elapsed) > previousTime };
    this.time.delayedCall(won ? 2000 : 900, () => this.showResult(won, bonus, flash, records));
  }

  /** Big "SENT!" with a flash and a shower of chalk and tape. */
  private sendMoment(label: string): void {
    this.cameras.main.flash(250, 255, 255, 255);
    popWord(this, label, { size: label.length > 6 ? 70 : 90 });
    confetti(this);
  }

  private leave(): void {
    this.net?.close();
    this.scene.start(this.data0.from === 'editor' ? 'Editor' : 'Menu', { code: this.data0.code });
  }

  private restart(): void {
    this.scene.restart(this.level.survival ? { level: survivalLevel() } : this.data0);
  }

  private showResult(won: boolean, bonus: number, flash: boolean, records: { score: boolean; time: boolean }): void {
    const e = this.engine;
    const id = this.level.id;
    showRoundResult(this, {
      won,
      label: this.level.custom ? 'Custom route' : this.level.label,
      score: e.score,
      bestScore: getBest(id),
      bestCombo: e.bestCombo,
      bonus,
      flash,
      survival: this.level.survival ? { seconds: e.elapsed, stage: e.stage(), bestSeconds: getBestTime(id), newBestScore: records.score, newBestTime: records.time } : undefined,
      post: this.leaderboardPost(),
      next: won && !this.level.daily && !this.level.custom ? { label: `Next: V${this.level.grade + 1}`, go: () => this.scene.restart({ level: gradeLevel(this.level.grade + 1) }) } : undefined,
      again: () => this.restart(),
      leaveLabel: this.leaveLabel(),
      leave: () => this.leave(),
    });
  }

  /** What the results screen needs to post this score, or nothing if this round has no leaderboard. */
  private leaderboardPost(): RoundResult['post'] {
    const board = boardFor(this.level);
    if (!board) return undefined;
    rememberBoard(board);
    if (this.engine.score <= 0) return undefined;
    const { score, elapsed: seconds } = this.engine;
    const replay: Replay = { seed: this.level.survival ? this.level.seed : undefined, shots: this.recorder.shots, tail: this.recorder.tail };
    return {
      name: getPlayerName(),
      ask: askName,
      send: async (name) => {
        // signed in but no account name yet: the name chosen here becomes the account's
        if (getAuth() && !getAuth()!.name) {
          const named = await chooseName(name);
          if (!named.ok) return named;
        }
        return postScore(board, name, score, seconds, getLookCode(), replay);
      },
      view: () => this.scene.start('Leaderboard', { board }),
    };
  }

  private leaveLabel(): string {
    return this.data0.from === 'editor' ? 'Back to editor' : 'Menu';
  }

  // ---------- two-player match ----------

  private startVersus(): void {
    const net = this.net!;
    this.panel = new OpponentPanel(this);
    this.refreshIncoming();
    this.hints.show('versus', 'Pop holds to send rows to your opponent. Popping also blocks rows heading your way. Miss, and they land');
    net.setHandler({ message: (m) => this.onNetMessage(m), close: (reason) => this.onOpponentGone(reason) });
    this.sendState();
    // 3, 2, 1, go: nobody may shoot until both players see the same start
    this.state = 'resolving';
    ['3', '2', '1', 'GO!'].forEach((label, i, all) => {
      this.time.delayedCall(600 + i * 800, () => {
        if (this.state === 'over') return;
        popWord(this, label, { from: 0.4, growMs: 260, holdMs: 450, depth: 70 });
        sfx.tick();
        if (i === all.length - 1 && this.state === 'resolving') this.state = 'aiming';
      });
    });
  }

  private onNetMessage(m: Msg): void {
    switch (m.t) {
      case 'attack':
        this.engine.receive(m.n);
        this.refreshIncoming();
        this.sendState();
        sfx.drop();
        break;
      case 'state':
        this.panel?.update(m);
        break;
      case 'over':
        if (this.state !== 'over') this.endGame(true);
        break;
      case 'start': // the host wants a rematch
        if (this.net?.role === 'guest' && this.state === 'over') this.scene.restart({ level: versusLevel(m.seed), versus: this.net });
        break;
    }
  }

  private onOpponentGone(reason: CloseReason): void {
    this.opponentGone = true;
    if (this.state !== 'over') this.endGame(true, undefined, reason);
    else this.versusResult?.opponentLeft();
  }

  /** Tell the opponent how my wall looks. */
  private sendState(): void {
    this.net?.send({ t: 'state', score: Math.min(this.engine.score, 1e9), pending: Math.min(this.engine.pending, 99), rows: this.engine.snapshot().slice(0, MAX_ROWS) });
  }

  private refreshIncoming(): void {
    const n = this.engine.pending;
    this.incomingText?.setText(n > 0 ? `INCOMING ${n}` : 'no rows incoming').setColor(n > 0 ? '#ff6b6b' : '#9aa6cf');
  }

  /** After each of my shots: send rows for connections, show what got blocked, and update the opponent. */
  private versusAfterShot(res: ShotResult, at: { x: number; y: number }): void {
    for (let left = res.attack; left > 0; left -= MAX_ATTACK) this.net!.send({ t: 'attack', n: Math.min(left, MAX_ATTACK) });
    if (res.attack > 0) floatText(this, at.x, at.y + 76, `Sent ${res.attack} row${res.attack > 1 ? 's' : ''}!`, '#7ae6dc', 17);
    if (res.cancelled > 0) floatText(this, at.x, at.y + 100, `Blocked ${res.cancelled}!`, '#7ee787', 17);
    this.refreshIncoming();
    this.sendState();
  }

  /** Leaving a match is a forfeit, so ask first. The match carries on behind the question. */
  private askLeave(): void {
    if (this.paused || this.state === 'over') return;
    this.paused = true;
    this.leaveUi = showLeaveQuestion(
      this,
      () => {
        this.paused = false;
        this.leaveUi?.destroy();
        this.leaveUi = null;
      },
      () => this.leave(),
    );
  }

  private showVersusResult(won: boolean, reason?: CloseReason): void {
    const e = this.engine;
    this.versusResult = showVersusResult(this, {
      won,
      reason,
      score: e.score,
      opponentScore: this.panel?.score ?? 0,
      sent: e.sent,
      received: e.received,
      bestCombo: e.bestCombo,
      isHost: this.net?.role === 'host',
      opponentGone: this.opponentGone,
      rematch: () => this.startRematch(),
      leave: () => this.leave(),
    });
  }

  private startRematch(): void {
    const net = this.net;
    if (!net || this.opponentGone) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    net.send({ t: 'start', seed });
    this.scene.restart({ level: versusLevel(seed), versus: net });
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
      this.hints.resume();
      return;
    }
    this.pauseUi = showPauseMenu(this, {
      resume: () => this.setPaused(false),
      restart: () => this.restart(),
      leaveLabel: this.leaveLabel(),
      leave: () => this.leave(),
      soundLabel: () => `Sound: ${isMutedNow() ? 'off' : 'on'}`,
      toggleSound: () => this.toggleSound(),
      musicLabel: () => `Music: ${getMusic() ? 'on' : 'off'}`,
      toggleMusic: () => void toggleMusic(),
      shakeLabel: () => `Screen shake: ${getShake() ? 'on' : 'off'}`,
      toggleShake: () => setShake(!getShake()),
    });
  }
}
