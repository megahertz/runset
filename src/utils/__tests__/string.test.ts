import { describe, expect, test } from 'vitest';
import { formatDuration } from '../string.ts';

describe('formatDuration', () => {
  test('milliseconds under a second', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(849.6)).toBe('850ms');
  });

  test('seconds with one decimal from a second up', () => {
    expect(formatDuration(999.6)).toBe('1.0s');
    expect(formatDuration(2140)).toBe('2.1s');
    expect(formatDuration(75_000)).toBe('75.0s');
  });
});
