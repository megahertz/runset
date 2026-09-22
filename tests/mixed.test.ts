import { describe, expect, test } from 'vitest';
import type { CommandDefinition } from '../src/index.ts';
import { Run, runset } from '../src/index.ts';
import { run } from './helpers/cli.ts';
import { fixturePath, tempDir } from './helpers/tempDir.ts';

/** `b` and `c` overlap freely; `d` and `e` are strictly ordered after them. */
const B_AND_C = ['bcbc', 'bccb', 'cbbc', 'cbcb'];

describe('[mixed] -p and -s groups run one after another', () => {
  test('a leading bare command forms its own implicit serial group', async () => {
    await using dir = await tempDir();
    await run(
      [
        'test-task:append a',
        '-p',
        'test-task:append b',
        'test-task:append c',
        '-s',
        'test-task:append d',
        'test-task:append e',
      ],
      dir.path,
    );

    expect(await dir.result()).toBeOneOf(
      B_AND_C.map((middle) => `aa${middle}ddee`),
    );
  });

  test('groups work without a leading implicit group', async () => {
    await using dir = await tempDir();
    await run(
      [
        '-p',
        'test-task:append b',
        'test-task:append c',
        '-s',
        'test-task:append d',
        'test-task:append e',
      ],
      dir.path,
    );

    expect(await dir.result()).toBeOneOf(
      B_AND_C.map((middle) => `${middle}ddee`),
    );
  });

  test('--jobs applies to every parallel group in the run', async () => {
    await using dir = await tempDir();
    await run(
      [
        '-j',
        '1',
        '-p',
        'test-task:append b',
        'test-task:append c',
        '-s',
        'test-task:append d',
      ],
      dir.path,
    );

    // With one job at a time a "parallel" group degenerates into a serial one.
    expect(await dir.result()).toBe('bbccdd');
  });

  test('a config-file pipeline folds neighbouring parallel commands together', async () => {
    await using dir = await tempDir();
    await dir.write(
      'runset.config.json',
      JSON.stringify({
        commands: [
          'test-task:append a',
          'test-task:append b::parallel',
          'test-task:append c::parallel',
          'test-task:append d',
        ],
      }),
    );

    await run([], dir.path);
    expect(await dir.result()).toBeOneOf(
      B_AND_C.map((middle) => `aa${middle}dd`),
    );
  });

  test('the library API folds the same way', async () => {
    await using dir = await tempDir();
    await runset(
      [
        'test-task:append a',
        { command: 'test-task:append b', parallel: true },
        { command: 'test-task:append c', parallel: true },
        'test-task:append d',
      ],
      { cwd: dir.path },
    );

    expect(await dir.result()).toBeOneOf(
      B_AND_C.map((middle) => `aa${middle}dd`),
    );
  });

  test('falsy entries are dropped so `flag && {…}` works', async () => {
    await using dir = await tempDir();
    const shouldRunC = false;

    await runset(
      [
        'test-task:append a',
        shouldRunC && 'test-task:append c',
        'test-task:append d',
      ],
      { cwd: dir.path },
    );

    expect(await dir.result()).toBe('aadd');
  });

  test('two -p groups still run one after another', async () => {
    await using dir = await tempDir();
    await run(
      ['-p', 'test-task:append a', '-p', 'test-task:append b'],
      dir.path,
    );

    // A group of one is just that command, so these stay strictly ordered.
    expect(await dir.result()).toBe('aabb');
  });

  test('a disabled command is skipped', async () => {
    await using dir = await tempDir();
    await runset(
      ['test-task:append a', { command: 'test-task:append c', disabled: true }],
      { cwd: dir.path },
    );

    expect(await dir.result()).toBe('aa');
  });
});

describe('[mixed] a settings entry is `-p`/`-s` written down', () => {
  /** The stage each command landed in, which is the whole shape of a run. */
  function stages(commands: CommandDefinition[]): number[] {
    // Only a plan is built, so the fixture itself will do: nothing runs in it.
    return Run.fromConfigJs({ commands, cwd: fixturePath() }).processes.map(
      (item) => item.command.stage,
    );
  }

  test('it groups the commands written after it', () => {
    expect(stages(['echo a', { parallel: true }, 'echo b', 'echo c'])).toEqual([
      0, 1, 1,
    ]);
  });

  test('two of them in a row are two groups', () => {
    expect(
      stages([
        { parallel: true },
        'echo a',
        'echo b',
        { parallel: true },
        'echo c',
        'echo d',
      ]),
    ).toEqual([0, 0, 1, 1]);
  });

  test('`serial` is the other spelling, and closes the group too', () => {
    expect(
      stages([
        { parallel: true },
        'echo a',
        'echo b',
        { serial: true },
        'echo c',
      ]),
    ).toEqual([0, 0, 1]);
  });

  test('one that says nothing about the mode is not a boundary', () => {
    expect(
      stages([{ parallel: true }, 'echo a', { cwd: '.' }, 'echo b']),
    ).toEqual([0, 0]);
  });

  test('a command still outranks what it was told', () => {
    expect(
      stages([{ parallel: true }, 'echo a', 'echo b::parallel=false']),
    ).toEqual([0, 1]);
  });

  test('it settles more than the mode for the commands after it', async () => {
    await using dir = await tempDir();
    const [first, second] = Run.fromConfigJs({
      commands: ['echo a', { onFailure: 'continue' }, 'echo b'],
      cwd: dir.path,
    }).processes;

    expect(first?.command.onFailure).toBe('stop');
    expect(second?.command.onFailure).toBe('continue');
  });

  test('its reach ends with the list it was written in', async () => {
    await using dir = await tempDir();
    const commands = Run.fromConfigJs({
      commandDictionary: { checks: [{ parallel: true }, 'echo a', 'echo b'] },
      commands: ['checks', 'echo c', 'echo d'],
      cwd: dir.path,
    }).processes.map((item) => item.command.stage);

    // `a` and `b` together, then `c` and `d` one after another as written.
    expect(commands).toEqual([0, 0, 1, 2]);
  });

  test('the CLI and the config file lay out the same run', async () => {
    await using dir = await tempDir();
    await dir.write(
      'runset.config.json',
      JSON.stringify({
        commands: [
          'echo a',
          { parallel: true },
          'echo b',
          'echo c',
          { serial: true },
          'echo d',
        ],
      }),
    );

    const fromConfig = await run('--dry-run', dir.path);

    await dir.write('runset.config.json', '{}');
    const fromCli = await run(
      ['--dry-run', 'echo a', '-p', 'echo b', 'echo c', '-s', 'echo d'],
      dir.path,
    );

    // The plan is the run's whole shape, so two spellings of one run render
    // to the same text down to the last option.
    expect(fromCli.stdout).toBe(fromConfig.stdout);
    expect(fromCli.stdout).toMatch(/stage 3:/);
  });
});
