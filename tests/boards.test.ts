import { describe, expect, it } from 'vitest';
import { boardKind, boardTitle, isBoard, OVERALL } from '../src/game/boards';

describe('boards', () => {
  it('knows the overall ranking alongside grades, Survival and Dailies', () => {
    for (const ok of ['v0', 'v12', 'survival', 'overall', 'daily-2026-10-12']) expect(isBoard(ok)).toBe(true);
    for (const bad of ['', 'Overall', 'overall2', 'all', 'v', 'daily', 'daily-2026-1-1', null, 5]) expect(isBoard(bad)).toBe(false);
    expect(OVERALL).toBe('overall');
  });

  it('names and sorts them', () => {
    expect(boardTitle('overall')).toBe('Overall');
    expect(boardKind('overall')).toBe('overall');
    expect(boardKind('v3')).toBe('grade');
    expect(boardKind('survival')).toBe('survival');
    expect(boardKind('daily-2026-10-12')).toBe('daily');
    expect(boardTitle('daily-2026-10-12', '2026-10-12')).toBe('Daily Boulder');
  });
});
