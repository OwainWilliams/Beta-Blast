import { describe, expect, it } from 'vitest';
import { formatTime } from '../src/game/format';

describe('formatTime', () => {
  it('formats minutes and padded seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(126)).toBe('2:06');
    expect(formatTime(3725)).toBe('62:05');
  });

  it('rounds to the nearest second without printing :60', () => {
    expect(formatTime(59.6)).toBe('1:00');
    expect(formatTime(119.6)).toBe('2:00');
    expect(formatTime(119.4)).toBe('1:59');
    expect(formatTime(0.4)).toBe('0:00');
  });

  it('never goes negative', () => {
    expect(formatTime(-5)).toBe('0:00');
  });
});
