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
  return { layout, shotsPerDrop: 5, bombs: true, wilds: true, timer: 2 };
}

describe('route codes', () => {
  it('round-trips a route', () => {
    const route = sample();
    const back = decodeRoute(encodeRoute(route))!;
    expect(back.shotsPerDrop).toBe(5);
    expect(back.bombs).toBe(true);
    expect(back.wilds).toBe(true);
    expect(back.timer).toBe(2);
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

  it('keeps bombs and mega jugs independent', () => {
    const route = { ...sample(), bombs: false, wilds: true, timer: 2 };
    expect(decodeRoute(encodeRoute(route))).toMatchObject({ bombs: false, wilds: true, timer: 2 });
    expect(decodeRoute(encodeRoute({ ...route, bombs: true, wilds: false, timer: 0 }))).toMatchObject({ bombs: true, wilds: false, timer: 0 });
  });

  it('keeps every timer setting, independent of the other flags', () => {
    for (const timer of [0, 1, 2, 3]) {
      const route = { ...sample(), bombs: false, wilds: true, timer };
      expect(decodeRoute(encodeRoute(route))).toMatchObject({ bombs: false, wilds: true, timer, shotsPerDrop: 5 });
    }
  });

  it('turns the timer setting into seconds between rows', () => {
    const level = (timer: number) => {
      const code = encodeRoute({ ...sample(), timer });
      return routeLevel(decodeRoute(code)!, code);
    };
    expect(level(0).dropInterval).toBe(0);
    expect(level(1).dropInterval).toBe(40);
    expect(level(2).dropInterval).toBe(20);
    expect(level(3).dropInterval).toBe(10);
  });

  it('still reads codes made before the timer existed, with no timer', () => {
    // CP1 code from the mega jug release: flag byte had bits 6 and 7 clear
    const bytes = [1, 0x25, 0x00, 0xff, 0xff, 0xff, 0xff];
    const sum = bytes.reduce((a, b) => (a * 31 + b + 1) & 0xff, 7);
    const code = 'CP1-' + btoa(String.fromCharCode(...bytes, sum)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeRoute(code)).toMatchObject({ shotsPerDrop: 5, bombs: false, wilds: true, timer: 0 });
  });

  it('rejects a route with nothing to pop', () => {
    const layout = emptyLayout();
    layout[0][0] = 6; // only an obstacle
    expect(decodeRoute(encodeRoute({ layout, shotsPerDrop: 6, bombs: false, wilds: false, timer: 0 }))).toBeNull();
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
