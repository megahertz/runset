import { describe, expect, test } from 'vitest';
import { runset } from '../src/index.ts';
import { run, runWithError } from './helpers/cli.ts';
import { tempDir } from './helpers/tempDir.ts';

/** `test-task:delayed <name> <ms>` writes `[name]` now and `__[name]` later. */
function line(name: string): string {
  return `[${name}]__[${name}]`;
}

/** Replaces the duration closing each `--show-exit-code` line with `<t>`. */
function withoutTimes(output: string): string {
  return output.replaceAll(/ (\d+ms|\d+\.\ds)(?= {2}|$)/gm, ' <t>');
}

const DELAYED = [
  'test-task:delayed first 900',
  'test-task:delayed second 100',
  'test-task:delayed third 500',
];

describe('[output] --stdout / --stderr / -o route command output', () => {
  describe('grouped', () => {
    test('holds each command s output back so it is never interleaved', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['-o', 'grouped', '--labels', 'none', '-p', ...DELAYED],
        dir.path,
      );

      // Each command's output arrives whole, ordered by when it finished.
      expect(stdout).toBe(
        `${line('second')}\n${line('third')}\n${line('first')}\n`,
      );
    });

    test('without grouping, parallel output interleaves', async () => {
      await using dir = await tempDir();
      // Unprefixed, so that nothing waits for a newline: these commands
      // announce themselves without one.
      const { stdout } = await run(
        ['--labels', 'none', '-p', ...DELAYED],
        dir.path,
      );

      // The slowest command's output does not arrive as one contiguous run: the
      // others write into its 900ms window. The fastest one's 100ms would race
      // process startup on a loaded machine.
      const between = stdout.slice(
        stdout.indexOf('[first]') + '[first]'.length,
        stdout.indexOf('__[first]'),
      );
      expect(between).toContain('[second]');
      expect(between).toContain('[third]');
    });

    test('a serial run is unaffected by grouping', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(['-o', 'grouped', ...DELAYED], dir.path);

      expect(stdout).toBe(
        `${line('first')}\n${line('second')}\n${line('third')}\n`,
      );
    });
  });

  describe('none', () => {
    test('discards the stream entirely', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--stdout', 'none', 'test-task:echo hi'],
        dir.path,
      );

      expect(stdout).toBe('');
    });

    test('only affects the stream it names', async () => {
      await using dir = await tempDir();
      const { stdout, stderr } = await run(
        ['--stdout', 'none', 'echo to-out', 'echo to-err 1>&2'],
        dir.path,
      );

      expect(stdout).toBe('');
      expect(stderr).toMatch(/to-err/);
    });

    test('discards a grouped stream too', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--stdout', 'grouped+none', 'echo held'],
        dir.path,
      );

      expect(stdout).toBe('');
    });
  });

  describe('redirection', () => {
    test('sends stdout to stderr', async () => {
      await using dir = await tempDir();
      const { stdout, stderr } = await run(
        ['--stdout', 'stderr', 'echo redirected'],
        dir.path,
      );

      expect(stdout).toBe('');
      expect(stderr).toMatch(/redirected/);
    });

    test('sends a stream to a file', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--stdout', './build.log', 'echo to-a-file'],
        dir.path,
      );

      expect(stdout).toBe('');
      expect(await dir.read('build.log')).toMatch(/to-a-file/);
    });

    test('combines a timing and a destination with +', async () => {
      await using dir = await tempDir();
      const { stdout, stderr } = await run(
        ['--stdout', 'stderr+grouped', '--labels', 'none', '-p', ...DELAYED],
        dir.path,
      );

      expect(stdout).toBe('');
      expect(stderr).toBe(
        `${line('second')}\n${line('third')}\n${line('first')}\n`,
      );
    });

    test('two commands sharing a file combine into it', async () => {
      await using dir = await tempDir();
      await run(
        [
          '--stdout',
          './build.log',
          '--labels',
          'none',
          'echo first',
          'echo second',
        ],
        dir.path,
      );

      const log = await dir.read('build.log');
      expect(log).toMatch(/first/);
      expect(log).toMatch(/second/);
    });

    test('a new run starts the file over', async () => {
      await using dir = await tempDir();
      await dir.write('build.log', 'from an earlier run\n');
      await run(['--stdout', './build.log', 'echo fresh'], dir.path);

      const log = await dir.read('build.log');
      expect(log).toMatch(/fresh/);
      expect(log).not.toMatch(/earlier/);
    });

    test('a relative path is the run s, not the command s', async () => {
      await using dir = await tempDir();
      // The command runs one directory down; the log still lands where the
      // path was written, next to the run's own cwd.
      await run(
        ['--stdout', './build.log', 'echo down-there::cwd=tasks'],
        dir.path,
      );

      expect(await dir.read('build.log')).toMatch(/down-there/);
      expect(await dir.exists('tasks/build.log')).toBe(false);
    });

    test('a per-command ::stdout overrides the run-wide setting', async () => {
      await using dir = await tempDir();
      const { stdout, stderr } = await run(
        ['--stdout', 'none', 'echo loud::stdout=stdout', 'echo quiet'],
        dir.path,
      );

      expect(stdout).toMatch(/loud/);
      expect(stdout).not.toMatch(/quiet/);
      expect(stderr).toBe('');
    });

    test('a per-command file replaces the run-wide file', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--stdout', './all.log', 'echo own::stdout=./own.log', 'echo shared'],
        dir.path,
      );
      expect(stdout).toBe('');
      expect(await dir.read('own.log')).toMatch(/own/);
      expect(await dir.read('all.log')).toMatch(/shared/);
      expect(await dir.read('all.log')).not.toMatch(/own/);
    });

    test('parallel commands and both streams share one file', async () => {
      await using dir = await tempDir();
      await dir.write('build.log', 'old contents');
      await run(
        [
          '-p',
          '-o',
          './build.log',
          '--labels',
          'none',
          'echo first',
          'echo second 1>&2',
        ],
        dir.path,
      );
      const log = await dir.read('build.log');
      expect(log).toMatch(/first/);
      expect(log).toMatch(/second/);
      expect(log).not.toMatch(/old contents/);
    });

    test('restarts keep all previous output in the file', async () => {
      await using dir = await tempDir();
      await run(
        ['--stdout', './build.log', 'test-task:flaky 2::on-failure=restart'],
        dir.path,
      );
      expect(await dir.read('build.log')).toBe(
        'attempt 1\nattempt 2\nattempt 3\n',
      );
    });

    test('dry-run neither creates nor truncates log files', async () => {
      await using dir = await tempDir();
      await dir.write('old.log', 'keep');
      await run(
        [
          '--dry-run',
          '--stdout',
          './old.log',
          '--stderr',
          './new.log',
          'echo x',
        ],
        dir.path,
      );
      expect(await dir.read('old.log')).toBe('keep');
      expect(await dir.exists('new.log')).toBe(false);
    });
  });

  describe('output, written in a config', () => {
    test('groups both streams run-wide, as -o does', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ labels: 'none', output: 'grouped', parallel: true }),
      );

      const { stdout } = await run(DELAYED, dir.path);

      expect(stdout).toBe(
        `${line('second')}\n${line('third')}\n${line('first')}\n`,
      );
    });

    test('a stream s own setting outranks it', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ output: 'none', stdout: 'stdout' }),
      );

      const { stdout, stderr } = await run(
        ['echo to-out', 'echo to-err 1>&2'],
        dir.path,
      );

      expect(stdout).toMatch(/to-out/);
      expect(stderr).not.toMatch(/to-err/);
    });

    test('a CLI flag outranks it', async () => {
      await using dir = await tempDir();
      await dir.write('runset.config.json', JSON.stringify({ output: 'none' }));

      const { stdout } = await run(
        ['--stdout', 'stdout', 'echo shown'],
        dir.path,
      );

      expect(stdout).toMatch(/shown/);
    });

    test('a command may set it for itself', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: [
            { command: 'echo quiet-object; echo x 1>&2', output: 'none' },
            'echo quiet-inline::output=none',
            'echo loud',
          ],
        }),
      );

      const { stdout, stderr } = await run([], dir.path);

      expect(stdout).toBe('loud\n');
      expect(stderr).toBe('');
    });

    test('a settings entry passes it to the commands after it', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: ['echo before', { output: 'none' }, 'echo after'],
        }),
      );

      const { stdout } = await run([], dir.path);

      expect(stdout).toBe('before\n');
    });
  });

  describe('a file that cannot be written', () => {
    test('ends the run and says so, rather than crashing the host', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['--stdout', './missing/out.log', 'echo hi'],
        dir.path,
      );

      expect(stderr).toMatch(/missing\/out\.log/);
      expect(stderr).not.toMatch(/unhandled/i);
    });

    test('it stops the run even under --on-failure continue', async () => {
      await using dir = await tempDir();
      // `--on-failure` is about a command that fails; a log going nowhere is
      // the run's own problem, and every command after it would share it.
      await runWithError(
        [
          '--on-failure',
          'continue',
          '--stdout',
          './missing/out.log',
          'echo hi',
          'test-task:append a',
        ],
        dir.path,
      );

      expect(await dir.result()).toBeUndefined();
    });

    test('the library call rejects rather than resolving', async () => {
      await using dir = await tempDir();
      const running = runset('echo hi', {
        cwd: dir.path,
        stdout: './missing/out.log',
      });

      await expect(running).rejects.toThrow(/cannot write to/i);
    });
  });

  test('start() settles only once the output is on disk', async () => {
    await using dir = await tempDir();
    // Enough of it that `end()` cannot have drained by the time the run
    // resolves — a settled-on-the-asking run hands back a half-written log.
    await runset('test-task:noise 20000', {
      cwd: dir.path,
      stdout: 'grouped+./build.log',
    });

    const log = await dir.read('build.log');
    expect(log.split('\n')).toHaveLength(20_001);
  });
});

describe('[output] --show-command / --show-exit-code report each command', () => {
  test('--show-command says what starts, before its output', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      ['--show-command', 'echo one', 'echo two'],
      dir.path,
    );

    expect(stdout).toBe('run echo one\none\nrun echo two\ntwo\n');
  });

  test('--show-exit-code marks how each command exited, and how long it took', async () => {
    await using dir = await tempDir();
    const { stdout } = await runWithError(
      ['--show-exit-code', '--on-failure', 'continue', 'echo one', 'exit 3'],
      dir.path,
    );

    expect(withoutTimes(stdout)).toBe('one\n✓ <t>\n✗ code 3 · <t>  exit 3\n');
  });

  test('--show-command paints "run" blue', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      ['--color', 'basic', '--show-command', 'true'],
      dir.path,
    );

    expect(stdout).toBe('\u001B[34mrun\u001B[39m true\n');
  });

  test('--show-exit-code names the signal that killed a command', async () => {
    await using dir = await tempDir();
    const { stdout } = await runWithError(
      ['--show-exit-code', 'kill -TERM $$'],
      dir.path,
    );

    expect(withoutTimes(stdout)).toBe('✗ SIGTERM · <t>  kill -TERM $$\n');
  });

  test('--show-exit-code tells a command runset stopped from a failure', async () => {
    await using dir = await tempDir();
    const { stdout } = await runWithError(
      ['--show-exit-code', '--labels', 'none', '-p', 'exit 2', 'sleep 5'],
      dir.path,
    );

    expect(withoutTimes(stdout).split('\n').toSorted()).toEqual([
      '',
      '– stopped · <t>  sleep 5',
      '✗ code 2 · <t>  exit 2',
    ]);
  });

  test('--show-exit-code paints a stopped command yellow', async () => {
    await using dir = await tempDir();
    const { stdout } = await runWithError(
      [
        '--color',
        'basic',
        '--show-exit-code',
        '--labels',
        'none',
        '-p',
        'exit 2',
        'sleep 5',
      ],
      dir.path,
    );

    expect(withoutTimes(stdout)).toContain(
      '\u001B[33m– stopped\u001B[39m · <t>  \u001B[90msleep 5\u001B[39m\n',
    );
  });

  test('--show-exit-code is green for a clean exit, red with the command in gray otherwise', async () => {
    await using dir = await tempDir();
    const { stdout } = await runWithError(
      [
        '--color',
        'basic',
        '--show-exit-code',
        '--on-failure',
        'continue',
        'true',
        'exit 3',
      ],
      dir.path,
    );

    expect(stdout).toContain('\u001B[32m✓\u001B[39m ');
    expect(withoutTimes(stdout)).toContain(
      '\u001B[31m✗ code 3\u001B[39m · <t>  \u001B[90mexit 3\u001B[39m\n',
    );
  });

  test('both carry the command s label', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      [
        '--show-command',
        '--show-exit-code',
        '--labels',
        'all',
        'echo one::label=a',
      ],
      dir.path,
    );

    expect(withoutTimes(stdout)).toBe('[a] run echo one\n[a] one\n[a] ✓ <t>\n');
  });

  test('both are grouped with the output of a grouped command', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      [
        '-o',
        'grouped',
        '--labels',
        'none',
        '--show-command',
        '--show-exit-code',
        '-p',
        'test-task:delayed first 500',
        'test-task:delayed second 100',
      ],
      dir.path,
    );

    const block = (name: string, ms: number): string =>
      `run test-task:delayed ${name} ${ms}\n${line(name)}\n✓ <t>\n`;
    expect(withoutTimes(stdout)).toBe(
      block('second', 100) + block('first', 500),
    );
  });

  test('an unfinished line is ended before the exit code', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(['--show-exit-code', 'printf one'], dir.path);

    expect(withoutTimes(stdout)).toBe('one\n✓ <t>\n');
  });

  test('both are off by default', async () => {
    await using dir = await tempDir();
    const { stdout, stderr } = await run(['echo one'], dir.path);

    expect(stdout).toBe('one\n');
    expect(stderr).toBe('');
  });
});
