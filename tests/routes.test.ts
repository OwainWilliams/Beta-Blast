import { describe, expect, it } from 'vitest';
import { codeFromInput, decodeRoute, emptyLayout, encodeRoute, MAX_EDIT_ROWS, routeLevel } from '../src/game/routes';

function sample() {
  const layout = emptyLayout();
  layout[0][0] = 0;
  layout[0][1] = 1;
  layout[0][9] = 4;
  layout[1][3] = 6;
  layout[2][5] = 7;
  layout[3][0] = 2;
  return { layout, shotsPerDrop: 5, bombs: true };
}

describe('route codes', () => {
  it('round-trips a route', () => {
    const route = sample();
    const back = decodeRoute(encodeRoute(route))!;
    expect(back.shotsPerDrop).toBe(5);
    expect(back.bombs).toBe(true);
    // rows after the last used one are trimmed
    expect(back.layout).toHaveLength(4);
    expect(back.layout).toEqual(route.layout.slice(0, 4));
  });

  it('keeps full-height routes', () => {
    const route = sample();
    route.layout[MAX_EDIT_ROWS - 1][2] = 3;
    expect(decodeRoute(encodeRoute(route))!.layout).toHaveLength(MAX_EDIT_ROWS);
  });

  it('rejects tampered or junk codes', () => {
    const code = encodeRoute(sample());
    const flipped = code.slice(0, 8) + (code[8] === 'A' ? 'B' : 'A') + code.slice(9);
    expect(decodeRoute(flipped)).toBeNull();
    expect(decodeRoute('')).toBeNull();
    expect(decodeRoute('hello')).toBeNull();
    expect(decodeRoute('CP1-')).toBeNull();
    expect(decodeRoute('CP1-!!!!')).toBeNull();
    expect(decodeRoute(code.slice(0, -4))).toBeNull();
  });

  it('rejects a route with nothing to pop', () => {
    const layout = emptyLayout();
    layout[0][0] = 6; // only an obstacle
    expect(decodeRoute(encodeRoute({ layout, shotsPerDrop: 6, bombs: false }))).toBeNull();
  });

  it('accepts a bare code or a link', () => {
    const code = encodeRoute(sample());
    expect(codeFromInput(code)).toBe(code);
    expect(codeFromInput(`  https://example.com/game/?route=${encodeURIComponent(code)}  `)).toBe(code);
    expect(codeFromInput('nonsense')).toBeNull();
  });

  it('builds a level with a stable id', () => {
    const code = encodeRoute(sample());
    const a = routeLevel(decodeRoute(code)!, code);
    const b = routeLevel(decodeRoute(code)!, code);
    expect(a.id).toBe(b.id);
    expect(a.custom).toBe(true);
  });
});
