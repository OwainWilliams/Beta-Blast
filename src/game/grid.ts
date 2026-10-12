// Pure hex-grid logic for the wall. No Phaser imports, so it is easy to test.
// Coordinates are local to the grid (the scene adds its own x offset).

export const COLS = 10;
export const R = 24; // hold radius
export const D = R * 2;
export const H = R * Math.sqrt(3); // row height
export const LOSE_ROW = 12;

// Hold types: 0-4 are the coloured holds you match.
export const BOMB = 5; // chalk bomb (only ever shot, never on the wall)
export const VOLUME = 6; // big obstacle, takes 2 nearby pops to break
export const SLICK = 7; // greasy obstacle, shots that land next to it slide down
export const WILD = 8; // mega jug: a shot that becomes whichever colour pops the most (never stored on the wall)

export const isColour = (type: number): boolean => type >= 0 && type < 5;
export const isObstacle = (type: number): boolean => type === VOLUME || type === SLICK;

export interface Hold {
  type: number;
  hp?: number; // obstacles only
}

export type Cell = [number, number];

export function makeHold(type: number): Hold {
  return type === VOLUME ? { type, hp: 2 } : type === SLICK ? { type, hp: 1 } : { type };
}

export class Grid {
  rows: (Hold | null)[][] = [];
  // Flips whenever a row is added on top, so existing holds keep their x position.
  private parity = 0;

  isShifted(r: number): boolean {
    return (r + this.parity) % 2 === 1;
  }
  rowLength(r: number): number {
    return this.isShifted(r) ? COLS - 1 : COLS;
  }
  cellX(r: number, c: number): number {
    return this.isShifted(r) ? D + c * D : R + c * D;
  }
  cellY(r: number): number {
    return R + r * H;
  }

  ensureRow(r: number): void {
    while (this.rows.length <= r) {
      this.rows.push(new Array(this.rowLength(this.rows.length)).fill(null));
    }
  }

  get(r: number, c: number): Hold | null {
    return this.rows[r]?.[c] ?? null;
  }
  set(r: number, c: number, hold: Hold | null): void {
    this.ensureRow(r);
    this.rows[r][c] = hold;
  }

  neighbors(r: number, c: number): Cell[] {
    const out: Cell[] = [];
    const push = (nr: number, nc: number) => {
      if (nr >= 0 && nc >= 0 && nc < this.rowLength(nr)) out.push([nr, nc]);
    };
    push(r, c - 1);
    push(r, c + 1);
    for (const nr of [r - 1, r + 1]) {
      if (this.isShifted(r)) {
        push(nr, c);
        push(nr, c + 1);
      } else {
        push(nr, c - 1);
        push(nr, c);
      }
    }
    return out;
  }

  hasOccupiedNeighbor(r: number, c: number): boolean {
    return this.neighbors(r, c).some(([nr, nc]) => this.get(nr, nc));
  }

  /** Does a ball centred at (x, y) touch any hold? */
  collides(x: number, y: number): boolean {
    const r0 = Math.round((y - R) / H);
    const limit = (D * 0.88) ** 2;
    for (let r = Math.max(0, r0 - 2); r <= r0 + 2 && r < this.rows.length; r++) {
      const row = this.rows[r];
      for (let c = 0; c < row.length; c++) {
        if (!row[c]) continue;
        const dx = this.cellX(r, c) - x;
        const dy = this.cellY(r) - y;
        if (dx * dx + dy * dy < limit) return true;
      }
    }
    return false;
  }

  /** Nearest empty cell a ball at (x, y) can stick to (top row, or next to a hold). */
  nearestEmpty(x: number, y: number): Cell | null {
    const r0 = Math.round((y - R) / H);
    for (const span of [1, 2, 3]) {
      let best: Cell | null = null;
      let bestDist = Infinity;
      for (let r = Math.max(0, r0 - span); r <= r0 + span; r++) {
        this.ensureRow(r);
        for (let c = 0; c < this.rows[r].length; c++) {
          if (this.rows[r][c]) continue;
          if (r > 0 && !this.hasOccupiedNeighbor(r, c)) continue;
          const d = Math.hypot(this.cellX(r, c) - x, this.cellY(r) - y);
          if (d < bestDist) {
            bestDist = d;
            best = [r, c];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Connected same-colour holds, starting from (r, c). */
  findMatches(r: number, c: number): Cell[] {
    const start = this.get(r, c);
    if (!start) return [];
    const seen = new Set<string>([`${r},${c}`]);
    const out: Cell[] = [[r, c]];
    for (let i = 0; i < out.length; i++) {
      for (const [nr, nc] of this.neighbors(out[i][0], out[i][1])) {
        const key = `${nr},${nc}`;
        if (seen.has(key)) continue;
        if (this.get(nr, nc)?.type !== start.type) continue;
        seen.add(key);
        out.push([nr, nc]);
      }
    }
    return out;
  }

  /** A chalk bomb clears itself and every hold touching it. */
  blast(r: number, c: number): Cell[] {
    const out: Cell[] = [[r, c]];
    for (const [nr, nc] of this.neighbors(r, c)) {
      if (this.get(nr, nc)) out.push([nr, nc]);
    }
    return out;
  }

  /** Holds that are no longer connected to the top row. */
  findFloating(): Cell[] {
    const seen = new Set<string>();
    const queue: Cell[] = [];
    if (this.rows[0]) {
      for (let c = 0; c < this.rows[0].length; c++) {
        if (this.rows[0][c]) {
          seen.add(`0,${c}`);
          queue.push([0, c]);
        }
      }
    }
    for (let i = 0; i < queue.length; i++) {
      for (const [nr, nc] of this.neighbors(queue[i][0], queue[i][1])) {
        const key = `${nr},${nc}`;
        if (seen.has(key) || !this.get(nr, nc)) continue;
        seen.add(key);
        queue.push([nr, nc]);
      }
    }
    return this.cells().filter(([r, c]) => !seen.has(`${r},${c}`));
  }

  /** Push every row down and add a new one on top. */
  addRowTop(types: number[]): void {
    this.parity ^= 1;
    const len = this.rowLength(0);
    this.rows.unshift(Array.from({ length: len }, (_, i) => makeHold(types[i % types.length])));
  }

  cells(): Cell[] {
    const out: Cell[] = [];
    this.rows.forEach((row, r) => row.forEach((h, c) => h && out.push([r, c])));
    return out;
  }
  count(): number {
    let n = 0;
    for (const row of this.rows) for (const h of row) if (h) n++;
    return n;
  }
  /** The row of the lowest hold, or -1 for an empty wall. */
  lowestRow(): number {
    for (let r = this.rows.length - 1; r >= 0; r--) if (this.rows[r].some(Boolean)) return r;
    return -1;
  }
  /** The colours still on the wall, in order. */
  presentTypes(): number[] {
    const set = new Set<number>();
    for (const row of this.rows) for (const h of row) if (h && isColour(h.type)) set.add(h.type);
    return [...set].sort((a, b) => a - b);
  }
  /** Is there anything left to pop? Cheaper than presentTypes() when only a yes or no is needed. */
  hasColour(): boolean {
    return this.rows.some((row) => row.some((h) => h && isColour(h.type)));
  }
}
