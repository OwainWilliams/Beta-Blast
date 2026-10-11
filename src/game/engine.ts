// The rules of the game, with no Phaser in sight. The scene feeds it shots and
// animates what comes back, and the balance bot plays it headlessly.
import { BOMB, Cell, COLS, D, Grid, Hold, isColour, isObstacle, LOSE_ROW, makeHold, R, SLICK, VOLUME } from './grid';
import { LevelSpec, mulberry32 } from './levels';

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
  placed: { cell: Cell; hold: Hold; slid: boolean } | null;
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
  leftover: Removed[]; // obstacles still on the wall when the route is sent
}

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

  constructor(readonly level: LevelSpec) {
    this.rng = mulberry32(level.seed);
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
    const present = this.grid.presentTypes();
    if (!present.length) return 0;
    if (this.level.bombs && this.rng() < 1 / 14) return BOMB;
    return present[Math.floor(this.rng() * present.length)];
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
    if (stale(this.cur)) this.cur = this.pickType();
    if (stale(this.nxt)) this.nxt = this.pickType();
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
    };
    const snapped = this.grid.nearestEmpty(x, y);
    if (!snapped) {
      res.lost = true;
      return res;
    }
    const cell = this.slide(snapped);
    const hold = makeHold(type);
    this.grid.set(cell[0], cell[1], hold);
    res.placed = { cell, hold, slid: cell !== snapped };

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
      res.won = true;
      for (const c of this.grid.cells()) {
        res.leftover.push({ cell: c, hold: this.grid.get(c[0], c[1])! });
        this.grid.set(c[0], c[1], null);
      }
      return res;
    }

    if (!hit.length && this.misses >= this.level.shotsPerDrop) res.newRow = this.addRow();
    if (this.grid.lowestRow() >= LOSE_ROW) res.lost = true;
    else this.refreshQueue();
    return res;
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

  private addRow(): Hold[] {
    const present = this.grid.presentTypes();
    const types = Array.from({ length: COLS }, () => present[Math.floor(this.rng() * present.length)] ?? 0);
    this.grid.addRowTop(types);
    this.misses = 0;
    this.drops++;
    return this.grid.rows[0].filter((h): h is Hold => !!h);
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
