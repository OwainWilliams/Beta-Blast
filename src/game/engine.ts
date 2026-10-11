// The rules of the game, with no Phaser in sight. The scene feeds it shots and
// animates what comes back, and the balance bot plays it headlessly.
import { BOMB, Cell, COLS, D, Grid, Hold, isColour, isObstacle, LOSE_ROW, makeHold, R, SLICK, VOLUME, WILD } from './grid';
import { attackFor, VERSUS_RULES } from './versus';
import { LevelSpec, mulberry32, survivalColours, survivalInterval, survivalSlickRate, survivalStage, survivalVolumeRate } from './levels';

export const SPEED = 950; // px/s
export const MAX_AIM = 1.35; // radians from vertical
export const FIELD_W = COLS * D;
export const LAUNCH_LX = FIELD_W / 2;
export const LAUNCH_LY = 640;

export interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number;
}

export interface Removed {
  cell: Cell;
  hold: Hold;
}

export interface ShotResult {
  placed: { cell: Cell; hold: Hold; slid: boolean; wild: boolean } | null;
  popped: Removed[];
  fallen: Removed[];
  cracked: Hold[]; // obstacles damaged but still standing
  newRow: Hold[] | null; // set when the wall dropped a row
  pop: number; // points
  bank: number;
  fall: number;
  combo: number;
  won: boolean;
  lost: boolean;
  leftover: Removed[]; // obstacles still on the wall when the route is sent, or swept away in survival
  sweep: boolean; // survival or versus: every colour was cleared, so fresh rows were added
  attack: number; // versus: rows sent to the opponent
  cancelled: number; // versus: queued rows this shot cancelled
  incoming: Hold[] | null; // versus: rows the opponent sent that landed on this shot
  incomingRows: number;
}

export interface TickResult {
  newRow: Hold[] | null; // set when the timer added a row
  lost: boolean;
  stage: number | null; // set when survival reached a new stage
}

export const SWEEP_BONUS = 500;
export const SWEEP_ROWS = 3;
export const STAGE_BONUS = 250;

const key = (c: Cell) => `${c[0]},${c[1]}`;

export class Engine {
  readonly grid = new Grid();
  readonly rng: () => number;
  readonly startCount: number;
  cur = 0;
  nxt = 0;
  misses = 0;
  drops = 0;
  score = 0;
  combo = 0;
  bestCombo = 0;
  dropClock = 0; // seconds since the last row was added
  pending = 0; // versus: rows the opponent has sent that have not landed yet
  sent = 0;
  received = 0;
  private readonly queueRng: () => number; // versus: the same stream for both players
  elapsed = 0; // seconds the timer has run (survival time)
  private lastStage = 1;

  constructor(readonly level: LevelSpec) {
    this.rng = mulberry32(level.seed);
    this.queueRng = mulberry32((level.seed ^ 0x5bd1e995) >>> 0);
    if (level.layout) this.loadLayout(level.layout);
    else this.generate();
    // a hand-built route may have holds hanging in mid-air
    for (const [r, c] of this.grid.findFloating()) this.grid.set(r, c, null);
    this.startCount = Math.max(1, this.grid.count());
    this.cur = this.pickType();
    this.nxt = this.pickType();
  }

  private loadLayout(layout: number[][]): void {
    layout.forEach((row, r) => {
      this.grid.ensureRow(r);
      row.forEach((type, c) => {
        if (type >= 0 && c < this.grid.rowLength(r)) this.grid.set(r, c, makeHold(type));
      });
    });
  }

  private generate(): void {
    const { rows, colours, volumeRate = 0, slickRate = 0 } = this.level;
    for (let r = 0; r < rows; r++) {
      this.grid.ensureRow(r);
      for (let c = 0; c < this.grid.rowLength(r); c++) {
        // bias towards the neighbouring colour so the wall forms clusters
        const left = c > 0 ? this.grid.get(r, c - 1) : null;
        const sameAsLeft = !!left && isColour(left.type) && this.rng() < 0.35;
        let type = sameAsLeft ? left!.type : Math.floor(this.rng() * colours);
        const roll = this.rng();
        if (r > 0) {
          if (roll < volumeRate) type = VOLUME;
          else if (roll < volumeRate + slickRate) type = SLICK;
        }
        this.grid.set(r, c, makeHold(type));
      }
    }
  }

  // ---------- queue ----------

  pickType(): number {
    if (this.level.shared) return this.drawShared();
    const present = this.grid.presentTypes();
    if (!present.length) return 0;
    if (this.level.bombs && this.rng() < 1 / 14) return BOMB;
    if (this.level.wilds && this.rng() < 1 / 18) return WILD;
    return present[Math.floor(this.rng() * present.length)];
  }

  /**
   * Two-player mode: draw from a stream that depends only on the seed and how many holds have been drawn,
   * never on the board, so both players are dealt the same holds. (If a colour is already gone from your
   * wall it is swapped for one you can use, which only affects you.)
   */
  private drawShared(): number {
    const bomb = this.queueRng();
    const wild = this.queueRng();
    const colour = this.queueRng();
    const present = this.grid.presentTypes();
    if (!present.length) return 0;
    if (this.level.bombs && bomb < 1 / 14) return BOMB;
    if (this.level.wilds && wild < 1 / 18) return WILD;
    const type = Math.floor(colour * this.level.colours);
    return present.includes(type) ? type : this.replacement();
  }

  /** A colour that is still on the wall, chosen locally. Used when a queued colour has been cleared. */
  private replacement(): number {
    const present = this.grid.presentTypes();
    return present.length ? present[Math.floor(this.rng() * present.length)] : 0;
  }

  swap(): void {
    [this.cur, this.nxt] = [this.nxt, this.cur];
  }

  /** Take the loaded hold and advance the queue. */
  shoot(): number {
    const type = this.cur;
    this.cur = this.nxt;
    this.nxt = this.pickType();
    return type;
  }

  private refreshQueue(): void {
    const present = this.grid.presentTypes();
    const stale = (t: number) => isColour(t) && !present.includes(t);
    const fresh = () => (this.level.shared ? this.replacement() : this.pickType());
    if (stale(this.cur)) this.cur = fresh();
    if (stale(this.nxt)) this.nxt = fresh();
  }

  // ---------- flight ----------

  /** Move a ball `dist` px along its heading, bouncing off the side walls. True once it touches something. */
  advance(b: Flight, dist: number): boolean {
    const steps = Math.max(1, Math.ceil(dist / 6));
    const step = dist / steps;
    const len = Math.hypot(b.vx, b.vy);
    let ux = b.vx / len;
    const uy = b.vy / len;
    const minX = R;
    const maxX = FIELD_W - R;
    for (let i = 0; i < steps; i++) {
      b.x += ux * step;
      b.y += uy * step;
      if (b.x < minX) {
        b.x = 2 * minX - b.x;
        ux = -ux;
        b.vx = -b.vx;
        b.bounces++;
      } else if (b.x > maxX) {
        b.x = 2 * maxX - b.x;
        ux = -ux;
        b.vx = -b.vx;
        b.bounces++;
      }
      if (b.y <= R) {
        b.y = R;
        return true;
      }
      if (this.grid.collides(b.x, b.y)) return true;
    }
    return false;
  }

  launch(aim: number): Flight {
    return { x: LAUNCH_LX, y: LAUNCH_LY, vx: Math.sin(aim) * SPEED, vy: -Math.cos(aim) * SPEED, bounces: 0 };
  }

  /** Where a shot at this angle ends up. */
  trace(aim: number, step = 12, keepPoints = true): { end: Flight; points: { x: number; y: number }[] } {
    const b = this.launch(aim);
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 600; i++) {
      const hit = this.advance(b, step);
      if (keepPoints) points.push({ x: b.x, y: b.y });
      if (hit) break;
    }
    return { end: b, points };
  }

  /** The cell a ball touching down at (x, y) will end up in, slick holds included. */
  preview(x: number, y: number): Cell | null {
    const cell = this.grid.nearestEmpty(x, y);
    return cell ? this.slide(cell) : null;
  }

  /**
   * The colour a mega jug turns into at `cell`: the one that makes the biggest group,
   * or failing a match, the colour it is touching most so it joins that cluster.
   */
  resolveWild(cell: Cell): number {
    const [r, c] = cell;
    const touching = new Map<number, number>();
    for (const [nr, nc] of this.grid.neighbors(r, c)) {
      const h = this.grid.get(nr, nc);
      if (h && isColour(h.type)) touching.set(h.type, (touching.get(h.type) ?? 0) + 1);
    }
    let best = this.grid.presentTypes()[0] ?? 0;
    let bestSize = -1;
    let bestTouch = -1;
    for (const [type, n] of touching) {
      this.grid.set(r, c, { type });
      const size = this.grid.findMatches(r, c).length;
      this.grid.set(r, c, null);
      if (size > bestSize || (size === bestSize && n > bestTouch)) {
        best = type;
        bestSize = size;
        bestTouch = n;
      }
    }
    return best;
  }

  /** Next to a slick hold the ball slides off, down and away, if there is room. */
  private slide(cell: Cell): Cell {
    const near = this.grid.neighbors(cell[0], cell[1]);
    const slicks = near.filter(([r, c]) => this.grid.get(r, c)?.type === SLICK);
    if (!slicks.length) return cell;
    let best: Cell | null = null;
    let bestDist = -1;
    for (const [r, c] of near) {
      if (r !== cell[0] + 1 || this.grid.get(r, c) || !this.grid.hasOccupiedNeighbor(r, c)) continue;
      const d = slicks.reduce(
        (sum, [sr, sc]) => sum + Math.hypot(this.grid.cellX(r, c) - this.grid.cellX(sr, sc), this.grid.cellY(r) - this.grid.cellY(sr)),
        0,
      );
      if (d > bestDist) {
        bestDist = d;
        best = [r, c];
      }
    }
    return best ?? cell;
  }

  // ---------- resolving a shot ----------

  land(type: number, x: number, y: number, bounces: number): ShotResult {
    const res: ShotResult = {
      placed: null,
      popped: [],
      fallen: [],
      cracked: [],
      newRow: null,
      pop: 0,
      bank: 0,
      fall: 0,
      combo: this.combo,
      won: false,
      lost: false,
      leftover: [],
      sweep: false,
      attack: 0,
      cancelled: 0,
      incoming: null,
      incomingRows: 0,
    };
    const snapped = this.grid.nearestEmpty(x, y);
    if (!snapped) {
      res.lost = true;
      return res;
    }
    const cell = this.slide(snapped);
    const hold = makeHold(type === WILD ? this.resolveWild(cell) : type);
    this.grid.set(cell[0], cell[1], hold);
    res.placed = { cell, hold, slid: cell !== snapped, wild: type === WILD };

    let hit: Cell[] = [];
    if (type === BOMB) hit = this.grid.blast(cell[0], cell[1]);
    else {
      const match = this.grid.findMatches(cell[0], cell[1]);
      if (match.length >= 3) hit = match;
    }

    if (hit.length) {
      if (type !== BOMB) hit.push(...this.damageObstacles(hit, res));
      for (const c of hit) {
        res.popped.push({ cell: c, hold: this.grid.get(c[0], c[1])! });
        this.grid.set(c[0], c[1], null);
      }
      const n = hit.length;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.misses = 0;
      const mult = 1 + 0.2 * Math.min(this.combo - 1, 5);
      res.pop = Math.round((n * 10 + Math.max(0, n - 3) * 5) * mult);
      res.bank = bounces * 25;
      for (const c of this.grid.findFloating()) {
        res.fallen.push({ cell: c, hold: this.grid.get(c[0], c[1])! });
        this.grid.set(c[0], c[1], null);
      }
      const k = res.fallen.length;
      res.fall = (20 * k * (k + 1)) / 2;
      this.score += res.pop + res.bank + res.fall;
    } else {
      this.combo = 0;
      this.misses++;
    }
    res.combo = this.combo;

    if (this.grid.presentTypes().length === 0) {
      for (const c of this.grid.cells()) {
        res.leftover.push({ cell: c, hold: this.grid.get(c[0], c[1])! });
        this.grid.set(c[0], c[1], null);
      }
      if (!this.level.survival && !this.level.versus) {
        res.won = true;
        return res;
      }
      // Survival and versus never end by clearing the wall: you get a bonus and the next three rows arrive at once.
      res.sweep = true;
      res.newRow = [];
      for (let i = 0; i < SWEEP_ROWS; i++) res.newRow.push(...this.addRow(false));
      this.score += SWEEP_BONUS;
    }

    if (this.level.versus) this.exchangeRows(res, hit.length > 0);
    if (!hit.length && this.misses >= this.level.shotsPerDrop) res.newRow = this.addRow(true);
    if (this.grid.lowestRow() >= LOSE_ROW) res.lost = true;
    else this.refreshQueue();
    return res;
  }

  /** Two-player: send rows for this shot's connection, cancel rows queued against you, and let the rest land when due. */
  private exchangeRows(res: ShotResult, popped: boolean): void {
    if (popped) {
      const attack = attackFor(res.popped.length, res.fallen.length, res.sweep);
      const cancel = VERSUS_RULES.cancelWithPops ? Math.min(this.pending, attack) : 0;
      this.pending -= cancel;
      res.cancelled = cancel;
      res.attack = attack - cancel;
      this.sent += res.attack;
    }
    if (this.pending > 0 && (!popped || !VERSUS_RULES.deferUntilMiss)) {
      res.incomingRows = this.pending;
      res.incoming = [];
      for (let i = 0; i < this.pending; i++) res.incoming.push(...this.addRow(false));
      this.received += this.pending;
      this.pending = 0;
    }
  }

  /** The opponent sent rows. They wait in the queue until they land (see exchangeRows). */
  receive(rows: number): void {
    this.pending += rows;
  }

  /** The wall as short strings, one per row, for the opponent's mini view. */
  snapshot(): string[] {
    const rows = this.grid.rows.map((row) => row.map((h) => (h ? String(h.type) : '.')).join(''));
    while (rows.length && /^\.*$/.test(rows[rows.length - 1])) rows.pop();
    return rows;
  }

  /** Each obstacle touching the popped holds takes one hit. Returns those that broke. */
  private damageObstacles(popped: Cell[], res: ShotResult): Cell[] {
    const inPop = new Set(popped.map(key));
    const touched = new Map<Hold, Cell>();
    for (const [r, c] of popped) {
      for (const n of this.grid.neighbors(r, c)) {
        const h = this.grid.get(n[0], n[1]);
        if (h && isObstacle(h.type) && !inPop.has(key(n))) touched.set(h, n);
      }
    }
    const broken: Cell[] = [];
    for (const [h, cell] of touched) {
      h.hp = (h.hp ?? 1) - 1;
      if (h.hp <= 0) broken.push(cell);
      else res.cracked.push(h);
    }
    return broken;
  }

  /** What a new row is made of. Normal levels reuse the colours still on the wall; survival follows the stage. */
  private rowTypes(): number[] {
    if (!this.level.survival) {
      const present = this.grid.presentTypes();
      // with nothing left on the wall (after a sweep) any of the level's colours will do
      return Array.from({ length: COLS }, () => (present.length ? present[Math.floor(this.rng() * present.length)] : Math.floor(this.rng() * this.level.colours)));
    }
    const stage = this.stage();
    const colours = survivalColours(stage);
    const volume = survivalVolumeRate(stage);
    const slick = survivalSlickRate(stage);
    return Array.from({ length: COLS }, () => {
      const roll = this.rng();
      if (roll < volume) return VOLUME;
      if (roll < volume + slick) return SLICK;
      return Math.floor(this.rng() * colours);
    });
  }

  /** Survival stage, which goes up with time survived. Always 1 on normal levels. */
  stage(): number {
    return this.level.survival ? survivalStage(this.elapsed) : 1;
  }

  /** Seconds between timed rows right now. In survival this tightens with the stage. */
  currentInterval(): number {
    return this.level.survival ? survivalInterval(this.stage()) : (this.level.dropInterval ?? 0);
  }

  /** Push the wall down a row. Any new row restarts the timer. `resetPump` is for the pump drop only. */
  private addRow(resetPump: boolean): Hold[] {
    this.grid.addRowTop(this.rowTypes());
    if (resetPump) this.misses = 0;
    this.drops++;
    this.dropClock = 0;
    return this.grid.rows[0].filter((h): h is Hold => !!h);
  }

  /**
   * Advance the drop timer by `dt` seconds. When it runs out a new row is added, so a game that
   * drags on keeps getting harder. Call it while the player is aiming or a shot is in the air.
   * Returns what happened, or null if nothing did.
   */
  tick(dt: number): TickResult | null {
    const interval = this.currentInterval();
    if (interval <= 0) return null;
    if (!this.level.survival && this.grid.presentTypes().length === 0) return null;
    this.elapsed += dt;
    this.dropClock += dt;
    let newRow: Hold[] | null = null;
    let stage: number | null = null;
    if (this.level.survival && this.stage() > this.lastStage) {
      this.lastStage = this.stage();
      stage = this.lastStage;
      this.score += STAGE_BONUS;
    }
    if (this.dropClock >= this.currentInterval()) newRow = this.addRow(false);
    if (!newRow && stage === null) return null;
    return { newRow, lost: this.grid.lowestRow() >= LOSE_ROW, stage };
  }

  /** 0 right after a row, 1 when the next one is due. 0 when the level has no timer. */
  timerFraction(): number {
    const interval = this.currentInterval();
    return interval > 0 ? Math.min(1, this.dropClock / interval) : 0;
  }

  /** Called once when the route is sent. */
  finishWin(): { bonus: number; flash: boolean } {
    const flash = this.drops === 0;
    const bonus = 100 * (this.level.grade + 1) + (flash ? 500 : 0);
    this.score += bonus;
    return { bonus, flash };
  }

  /** 0 at the bottom of the route, 1 at the top. */
  progress(): number {
    const remaining = this.grid.count();
    return Math.min(1, Math.max(0, 1 - remaining / Math.max(this.startCount, remaining)));
  }
}
