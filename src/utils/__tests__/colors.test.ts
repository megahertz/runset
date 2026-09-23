import { stripVTControlCharacters } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createConfig } from '../../config/Config.ts';
import { parseCli } from '../../config/parseCli.ts';
import { createPlan } from '../../plan/plan.ts';
import type { ColorMode } from '../../types.ts';
import {
  BASIC_PALETTE,
  fallbackColor,
  isColorName,
  paint,
  PALETTE,
  paletteIndex,
  shade,
} from '../colors.ts';

describe('[colors] extended shades', () => {
  test('mixes built-in styles and shades, closing each independently', () => {
    expect(paint('api', ['bgCoral', 'ink', 'bold'])).toBe(
      '\u001B[48;5;210m\u001B[38;5;235m\u001B[1mapi\u001B[22m\u001B[39m\u001B[49m',
    );
    expect(paint('api', ['bgNavy', 'paper'])).toBe(
      '\u001B[48;5;24m\u001B[38;5;255mapi\u001B[39m\u001B[49m',
    );
  });

  test('falls back to theme colors for basic terminals', () => {
    expect(
      ['bgCoral', 'ink', 'bgNavy', 'paper'].map((name) => fallbackColor(name)),
    ).toEqual(['bgRedBright', 'black', 'bgBlue', 'whiteBright']);
    expect(fallbackColor('cyan')).toBe('cyan');
  });

  test('ignores unknown names, including object prototype properties', () => {
    for (const name of [
      'chartreuse',
      'constructor',
      '__proto__',
      'bgConstructor',
    ]) {
      expect(isColorName(name)).toBe(false);
      expect(paint('text', [name])).toBe('text');
    }
  });

  test('restores a shade after an embedded foreground reset', () => {
    const text = paint('one\u001B[39mtwo', ['coral']);
    expect(text).toBe('\u001B[38;5;210mone\u001B[38;5;210mtwo\u001B[39m');
    expect(stripVTControlCharacters(text)).toBe('onetwo');
  });

  test('every label pair has at least 4.5:1 contrast', () => {
    function luminance(index: number): number {
      const cube = [0, 95, 135, 175, 215, 255];
      const offset = index - 16;
      const rgb =
        index >= 232
          ? Array.from({ length: 3 }, () => 8 + (index - 232) * 10)
          : [
              cube[Math.floor(offset / 36)] ?? Number.NaN,
              cube[Math.floor(offset / 6) % 6] ?? Number.NaN,
              cube[offset % 6] ?? Number.NaN,
            ];
      const linear = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear.reduce(
        (total, value, i) =>
          total + value * ([0.2126, 0.7152, 0.0722][i] ?? Number.NaN),
        0,
      );
    }

    for (const { bgColor, color } of PALETTE) {
      const background = luminance(shade(bgColor)?.index ?? Number.NaN);
      const foreground = luminance(shade(color)?.index ?? Number.NaN);
      expect(
        (Math.max(background, foreground) + 0.05) /
          (Math.min(background, foreground) + 0.05),
        bgColor,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('[colors] paletteIndex', () => {
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

    // Not a promise that nothing collides,
    // but a hash that clumped, one that only counted a label's length say,
    // would never reach this.
    expect(used.size).toBeGreaterThanOrEqual(labels.length / 2);
  });

  test('a long label stays inside the palette', () => {
    const index = paletteIndex('watch:server:browser:esm'.repeat(20));

    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(PALETTE.length);
  });

  test('the empty label is answered too', () => {
    expect(PALETTE[paletteIndex('')]).toBeDefined();
  });

  test('every palette entry is a color runset knows', () => {
    for (const pair of PALETTE) {
      expect(isColorName(pair.bgColor)).toBe(true);
      expect(isColorName(pair.color)).toBe(true);
    }
  });
});

describe('[colors] terminal palettes', () => {
  function plan(color: ColorMode, commands: string[]) {
    return createPlan({
      config: createConfig({
        cli: parseCli([]),
        configJs: { color, commands, parallel: true },
        env: {},
      }),
    });
  }

  test('all uses every shade before reusing one', () => {
    const { commands } = plan(
      'all',
      Array.from(
        { length: PALETTE.length + 1 },
        (_, i) => `echo hi::label=task${i}`,
      ),
    );
    expect(
      new Set(
        commands.slice(0, PALETTE.length).map((command) => command.bgColor),
      ).size,
    ).toBe(PALETTE.length);
    expect(new Set(commands.map((command) => command.color))).toEqual(
      new Set(['ink', 'paper']),
    );
    for (const command of commands) {
      expect(
        PALETTE.find((pair) => pair.bgColor === command.bgColor)?.color,
      ).toBe(command.color);
    }
    expect(
      PALETTE.some(
        (pair) => pair.bgColor === commands[PALETTE.length]?.bgColor,
      ),
    ).toBe(true);
  });

  test('basic terminals use distinct theme colors before reusing one', () => {
    const { commands } = plan(
      'basic',
      Array.from(
        { length: BASIC_PALETTE.length },
        (_, i) => `echo hi::label=task${i}`,
      ),
    );
    expect(new Set(commands.map((command) => command.bgColor)).size).toBe(
      BASIC_PALETTE.length,
    );
    expect(
      commands.every((command) =>
        BASIC_PALETTE.some((pair) => pair.bgColor === command.bgColor),
      ),
    ).toBe(true);
  });

  test('soft leaves out the deep shades, not the ones asked for', () => {
    const { commands } = createPlan({
      config: createConfig({
        cli: parseCli(['--color', 'soft']),
        configJs: {
          commands: [
            ...PALETTE.map((_, i) => `echo hi::label=task${i}`),
            'echo hi::label=mine,bg-color=bgNavy,color=paper',
          ],
          parallel: true,
        },
        env: {},
      }),
    });
    const mine = commands.pop();
    expect(new Set(commands.map((command) => command.color))).toEqual(
      new Set(['ink']),
    );
    expect(mine?.bgColor).toBe('bgNavy');
  });

  test('reserves an explicitly chosen shade', () => {
    const preferred = PALETTE[paletteIndex('api')]?.bgColor;
    const { commands } = plan('all', [
      `echo hi::label=custom,bg-color=${preferred}`,
      'echo hi::label=api',
    ]);
    expect(commands[0]?.bgColor).toBe(preferred);
    expect(commands[1]?.bgColor).not.toBe(preferred);
  });
});
