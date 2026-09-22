import { describe, expect, test } from 'vitest';
import { isColorName } from '../../utils/colors.ts';
import { PALETTE, paletteIndex } from '../labels.ts';

describe('[labels] paletteIndex', () => {
  test('a label always lands on the same entry', () => {
    expect(paletteIndex('db')).toBe(paletteIndex('db'));
    expect(PALETTE[paletteIndex('db')]).toBeDefined();
  });

  test('labels spread across the palette', () => {
    const labels = [
      'api',
      'build',
      'dash',
      'db',
      'docs',
      'fmt',
      'lint',
      'serve',
      'test',
      'types',
      'watch',
      'web',
      'worker',
    ];
    const used = new Set(labels.map((label) => paletteIndex(label)));

    // Not a promise that nothing collides — thirteen labels, twelve colors —
    // but a hash that clumped, one that only counted a label's length say,
    // would never reach this.
    expect(used.size).toBeGreaterThanOrEqual(PALETTE.length / 2);
  });

  test('a long label stays inside the palette', () => {
    const index = paletteIndex('watch:server:browser:esm'.repeat(20));

    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(PALETTE.length);
  });

  test('the empty label is answered too', () => {
    expect(PALETTE[paletteIndex('')]).toBeDefined();
  });

  test('every palette entry is a color node:util knows', () => {
    for (const pair of PALETTE) {
      expect(isColorName(pair.bgColor)).toBe(true);
      expect(isColorName(pair.color)).toBe(true);
    }
  });
});
