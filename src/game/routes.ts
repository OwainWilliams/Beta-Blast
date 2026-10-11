// Share codes for hand-built routes: "CP1-" + base64url of
//   [rows, pumpLimit | bombs<<4, ...two cells per byte, checksum]
// A cell is 0-4 (colours), 6 (volume), 7 (slick) or 15 (empty).
import { COLS, isColour } from './grid';
import { hashString, LevelSpec } from './levels';

export const MAX_EDIT_ROWS = 10;
export const MIN_PUMP = 3;
export const MAX_PUMP = 9;
const PREFIX = 'CP1-';
const EMPTY = 0xf;
const VALID = new Set([0, 1, 2, 3, 4, 6, 7]);

export interface Route {
  layout: number[][]; // hold type per cell, -1 = empty. Row 0 is the top, full width.
  shotsPerDrop: number;
  bombs: boolean;
}

export const rowLen = (r: number): number => (r % 2 === 0 ? COLS : COLS - 1);

export function emptyLayout(rows = MAX_EDIT_ROWS): number[][] {
  return Array.from({ length: rows }, (_, r) => new Array(rowLen(r)).fill(-1));
}

const checksum = (bytes: number[]) => bytes.reduce((a, b) => (a * 31 + b + 1) & 0xff, 7);

export function encodeRoute(route: Route): string {
  let rows = 1;
  route.layout.forEach((row, r) => {
    if (row.some((t) => t >= 0)) rows = r + 1;
  });
  const nibbles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < rowLen(r); c++) {
      const t = route.layout[r]?.[c] ?? -1;
      nibbles.push(t < 0 ? EMPTY : t);
    }
  }
  if (nibbles.length % 2) nibbles.push(EMPTY);
  const bytes = [rows, (route.shotsPerDrop & 0xf) | (route.bombs ? 0x10 : 0)];
  for (let i = 0; i < nibbles.length; i += 2) bytes.push((nibbles[i] << 4) | nibbles[i + 1]);
  bytes.push(checksum(bytes));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return PREFIX + b64;
}

export function decodeRoute(code: string): Route | null {
  try {
    if (!code.startsWith(PREFIX)) return null;
    const b64 = code.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Array.from(raw, (ch) => ch.charCodeAt(0));
    if (bytes.length < 4) return null;
    const rows = bytes[0];
    if (rows < 1 || rows > MAX_EDIT_ROWS) return null;
    let cells = 0;
    for (let r = 0; r < rows; r++) cells += rowLen(r);
    if (bytes.length !== 2 + Math.ceil(cells / 2) + 1) return null;
    if (checksum(bytes.slice(0, -1)) !== bytes[bytes.length - 1]) return null;
    const shotsPerDrop = bytes[1] & 0xf;
    if (shotsPerDrop < MIN_PUMP || shotsPerDrop > MAX_PUMP) return null;

    const nibbles: number[] = [];
    for (let i = 2; i < bytes.length - 1; i++) nibbles.push(bytes[i] >> 4, bytes[i] & 0xf);
    const layout: number[][] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < rowLen(r); c++) {
        const n = nibbles[i++];
        if (n !== EMPTY && !VALID.has(n)) return null;
        row.push(n === EMPTY ? -1 : n);
      }
      layout.push(row);
    }
    if (!layout.some((row) => row.some(isColour))) return null; // nothing to pop
    return { layout, shotsPerDrop, bombs: !!(bytes[1] & 0x10) };
  } catch {
    return null;
  }
}

/** Accepts a bare code or a full link containing ?route=CODE. */
export function codeFromInput(input: string): string | null {
  const text = input.trim();
  const m = /[?&]route=([^&#\s]+)/.exec(text);
  const code = decodeURIComponent(m ? m[1] : text);
  return decodeRoute(code) ? code : null;
}

export function routeLevel(route: Route, code: string): LevelSpec {
  return {
    id: `code-${hashString(code).toString(36)}`,
    label: 'Custom route',
    grade: 3,
    seed: hashString(code),
    colours: 5,
    rows: 0,
    shotsPerDrop: route.shotsPerDrop,
    bombs: route.bombs,
    custom: true,
    layout: route.layout,
    code,
  };
}
