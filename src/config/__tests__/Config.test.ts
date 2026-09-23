import { describe, expect, test } from 'vitest';
import type { ColorLevel } from '../../utils/colors.ts';
import { createConfig } from '../Config.ts';
import { parseCli } from '../parseCli.ts';

describe('[config] color autodetection', () => {
  /** A stand-in for one end of the run's output. */
  function stream(isTTY: boolean): NodeJS.WritableStream {
    return { isTTY } as unknown as NodeJS.WritableStream;
  }

  function colorFor(
    destinations: { stderr: boolean; stdout: boolean },
    env: NodeJS.ProcessEnv = {},
    argv: string[] = ['echo hi'],
    configJs: object = {},
  ): ColorLevel {
    return createConfig({
      cli: parseCli(argv),
      configJs,
      cwd: process.cwd(),
      destinations: {
        stderr: stream(destinations.stderr),
        stdout: stream(destinations.stdout),
      },
      env,
    }).color;
  }

  test('on when everything runset writes to is a terminal', () => {
    expect(colorFor({ stderr: true, stdout: true })).toBe('basic');
  });

  test('soft where the terminal shows 256 colors, never all', () => {
    const tty = { stderr: true, stdout: true };
    expect(colorFor(tty, { TERM: 'xterm' })).toBe('basic');
    expect(colorFor(tty, { TERM: 'xterm-256color' })).toBe('soft');
    expect(colorFor(tty, { COLORTERM: 'truecolor' })).toBe('soft');
  });

  test('a mode is taken as given, wherever it comes from', () => {
    const pipe = { stderr: false, stdout: false };
    expect(colorFor(pipe, {}, ['--color', 'soft', 'echo hi'])).toBe('soft');
    expect(colorFor(pipe, {}, ['echo hi'], { color: 'all' })).toBe('all');
    expect(
      colorFor(pipe, { NO_COLOR: '1' }, ['--color', 'basic', 'echo hi']),
    ).toBe('basic');
    expect(
      colorFor(pipe, { FORCE_COLOR: '2' }, ['--color', 'auto', 'echo hi']),
    ).toBe('soft');
  });

  test('an unknown mode is refused', () => {
    expect(() =>
      colorFor({ stderr: true, stdout: true }, {}, ['--color', 'shades', 'x']),
    ).toThrow('color is one of auto, none, basic, soft, all, got "shades".');
  });

  test('off when either end is a pipe or a file', () => {
    // runset's own messages go to stderr and the commands' output to stdout;
    // escape codes are only wanted where something renders them.
    expect(colorFor({ stderr: true, stdout: false })).toBe('none');
    expect(colorFor({ stderr: false, stdout: true })).toBe('none');
  });

  test('NO_COLOR outranks a terminal', () => {
    expect(colorFor({ stderr: true, stdout: true }, { NO_COLOR: '1' })).toBe(
      'none',
    );
  });

  test('FORCE_COLOR outranks a pipe', () => {
    expect(
      colorFor({ stderr: false, stdout: false }, { FORCE_COLOR: '1' }),
    ).toBe('basic');
  });

  test('and the flag outranks both', () => {
    expect(
      colorFor({ stderr: true, stdout: true }, { FORCE_COLOR: '1' }, [
        '--no-color',
        'echo hi',
      ]),
    ).toBe('none');
  });
});

describe('[config] env', () => {
  function configFor(configJs: object, argv: string[] = ['echo hi']) {
    return createConfig({
      cli: parseCli(argv),
      configJs,
      cwd: process.cwd(),
      env: { FROM_PROCESS: 'p' },
    });
  }

  test('the file and --env merge per variable, the flag winning', () => {
    const config = configFor({ env: { A: 'file', B: 'file' } }, [
      '-e',
      'B=flag',
      'echo hi',
    ]);

    expect(config.env).toEqual({ A: 'file', B: 'flag', FROM_PROCESS: 'p' });
  });

  test('a non-string value is refused', () => {
    expect(() => configFor({ env: { PORT: 4000 } })).toThrow(
      /env\.PORT must be a string/,
    );
    expect(() => configFor({ env: ['A=1'] })).toThrow(/env must be an object/);
  });
});
