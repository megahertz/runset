import { describe, expect, test } from 'vitest';
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
  ): boolean {
    return createConfig({
      cli: parseCli(argv),
      configJs: {},
      cwd: process.cwd(),
      destinations: {
        stderr: stream(destinations.stderr),
        stdout: stream(destinations.stdout),
      },
      env,
    }).color;
  }

  test('on when everything runset writes to is a terminal', () => {
    expect(colorFor({ stderr: true, stdout: true })).toBe(true);
  });

  test('off when either end is a pipe or a file', () => {
    // runset's own messages go to stderr and the commands' output to stdout;
    // escape codes are only wanted where something renders them.
    expect(colorFor({ stderr: true, stdout: false })).toBe(false);
    expect(colorFor({ stderr: false, stdout: true })).toBe(false);
  });

  test('NO_COLOR outranks a terminal', () => {
    expect(colorFor({ stderr: true, stdout: true }, { NO_COLOR: '1' })).toBe(
      false,
    );
  });

  test('FORCE_COLOR outranks a pipe', () => {
    expect(
      colorFor({ stderr: false, stdout: false }, { FORCE_COLOR: '1' }),
    ).toBe(true);
  });

  test('and the flag outranks both', () => {
    expect(
      colorFor({ stderr: true, stdout: true }, { FORCE_COLOR: '1' }, [
        '--no-color',
        'echo hi',
      ]),
    ).toBe(false);
  });
});
