import os from 'node:os';
import { describe, expect, test } from 'vitest';
import { runset } from '../src/index.ts';
import { run, runCli, runWithError } from './helpers/cli.ts';
import { type Dir, tempDir } from './helpers/tempDir.ts';

describe('[fail] runset reports failures', () => {
  describe('the summary', () => {
    test('counts the run and names each failure by its label', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        [
          '-p',
          'exit 2::label=api',
          'sleep 5::label=longer',
          '-s',
          'echo never',
        ],
        dir.path,
      );

      expect(stderr).toBe(
        'runset: 1 of 3 commands failed, 1 stopped, 1 not started\n' +
          '  ✖ [api] exit 2 exited with code 2\n',
      );
    });
  });

  describe('invalid options', () => {
    test('an unknown long flag is an error', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['--invalid', 'test-task:append a'],
        dir.path,
      );

      expect(stderr).toMatch(/unknown option/i);
    });

    test('an unknown short flag is an error', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['-Z', 'test-task:append a'],
        dir.path,
      );

      expect(stderr).toMatch(/unknown option/i);
    });

    test('a flag missing its value is an error', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['test-task:append a', '--jobs'],
        dir.path,
      );

      expect(stderr).toMatch(/needs a value/i);
    });

    test('a non-numeric --jobs is an error', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['-j', 'many', 'test-task:append a'],
        dir.path,
      );

      expect(stderr).toMatch(/jobs/i);
    });

    test('an invalid --log-level is an error', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['--log-level', 'chatty', 'test-task:append a'],
        dir.path,
      );

      expect(stderr).toMatch(/logLevel/);
    });

    test('a missing --config file is an error', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['-c', 'nope.config.js', 'test-task:append a'],
        dir.path,
      );

      expect(stderr).toMatch(/not found/i);
    });

    test('running with no commands at all is an error', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError('--parallel', dir.path);

      expect(stderr).toMatch(/no commands/i);
    });
  });

  describe('values a config file could write by hand', () => {
    /** Writes a config whose commands are fine and whose settings are not. */
    async function configWith(dir: Dir, settings: object): Promise<void> {
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['test-task:append a'], ...settings }),
      );
    }

    test('a jobs that is not a number is refused, not ignored', async () => {
      await using dir = await tempDir();
      // Taken at its word this would leave the run with no workers at all,
      // which looks exactly like a run with nothing to do.
      await configWith(dir, { jobs: 'many' });

      const { stderr } = await runWithError([], dir.path);

      expect(stderr).toMatch(/jobs must be a number of 1 or more, got "many"/i);
      expect(await dir.result()).toBeUndefined();
    });

    test('a jobs below 1 is refused', async () => {
      await using dir = await tempDir();
      await configWith(dir, { jobs: 0 });
      const { stderr } = await runWithError([], dir.path);

      expect(stderr).toMatch(/jobs must be a number of 1 or more/i);
    });

    test('a non-boolean parallel is refused', async () => {
      await using dir = await tempDir();
      await configWith(dir, { parallel: 'yes' });
      const { stderr } = await runWithError([], dir.path);

      expect(stderr).toMatch(/parallel must be true or false/i);
    });

    test('a bad stream timing is refused', async () => {
      await using dir = await tempDir();
      await configWith(dir, {
        stdout: { destination: 'stdout', timing: 'later' },
      });
      const { stderr } = await runWithError([], dir.path);

      expect(stderr).toMatch(/timing "later"/i);
    });

    test('an object command is held to the same rules as ::', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: [{ command: 'echo hi', onFailure: 'invalid' }],
        }),
      );

      const { stderr } = await runWithError([], dir.path);

      expect(stderr).toMatch(/continue, restart, stop/);
      expect(stderr).toMatch(/echo hi/);
    });

    test('an explicit Infinity is still allowed', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        'module.exports = { commands: ["test-task:append a"], ' +
          'jobs: Infinity };\n',
      );

      await run([], dir.path);
      expect(await dir.result()).toBe('aa');
    });
  });

  describe('settings entries', () => {
    /** Every one of these is a config file written by hand, so all are hard. */
    async function commandsOf(dir: Dir, commands: unknown): Promise<string> {
      await dir.write('runset.config.json', JSON.stringify({ commands }));
      const { stderr } = await runWithError([], dir.path);
      return stderr;
    }

    test('a misspelled option is refused rather than ignored', async () => {
      await using dir = await tempDir();
      const stderr = await commandsOf(dir, [
        'echo a',
        { paralel: true },
        'echo b',
      ]);

      expect(stderr).toMatch(/unknown option "paralel"/i);
    });

    test('so is one that settles nothing', async () => {
      await using dir = await tempDir();
      const stderr = await commandsOf(dir, ['echo a', {}]);

      expect(stderr).toMatch(/at least one option/i);
    });

    test('"parallel" and "serial" at once say nothing trustworthy', async () => {
      await using dir = await tempDir();
      const stderr = await commandsOf(dir, [
        { parallel: true, serial: true },
        'echo a',
      ]);

      expect(stderr).toMatch(/"parallel" or "serial", not both/i);
    });

    test('"serial" is true or false', async () => {
      await using dir = await tempDir();
      const stderr = await commandsOf(dir, [{ serial: 'yes' }, 'echo a']);

      expect(stderr).toMatch(/serial.*true or false/i);
    });

    test('a list is not something a command list holds', async () => {
      await using dir = await tempDir();
      const stderr = await commandsOf(dir, ['echo a', ['echo b', 'echo c']]);

      expect(stderr).toMatch(/scripts/);
    });
  });

  describe('arguments past --', () => {
    test('a forwarded long flag is not read as runset s own', async () => {
      await using dir = await tempDir();
      // `--jobs` here belongs to the command, and fills the placeholder.
      await run(
        ['test-task:dump --jobs {jobs}', '--', '--jobs', '2'],
        dir.path,
      );

      expect(JSON.parse((await dir.result()) ?? 'null')).toEqual([
        '--jobs',
        '2',
      ]);
    });

    test('a forwarded --help does not hijack the run', async () => {
      await using dir = await tempDir();
      // Past `--` it is a named argument like any other, so it fills `{help}`
      // rather than printing runset's usage and exiting.
      const { stdout } = await run(
        ['test-task:dump {help}', '--', '--help'],
        dir.path,
      );

      expect(stdout).not.toMatch(/Usage:/);
      expect(JSON.parse((await dir.result()) ?? 'null')).toEqual(['true']);
    });

    test('a forwarded --dry-run still runs the commands', async () => {
      await using dir = await tempDir();
      await run(['test-task:append {1}', '--', 'a', '--dry-run'], dir.path);

      expect(await dir.result()).toBe('aa');
    });
  });

  describe('failing commands', () => {
    test('a non-zero exit code is reported as-is', async () => {
      await using dir = await tempDir();
      await expect(
        runset('test-task:error', { cwd: dir.path, stderr: 'none' }),
      ).rejects.toMatchObject({ exitCode: 1 });
    });

    test('CLI exits with the command s own code', async () => {
      await using dir = await tempDir();
      const { code } = await runCli('test-task:error', dir.path);
      expect(code).toBe(1);
    });

    test('a command killed by a signal is reported as 128 + the signal', async () => {
      if (process.platform === 'win32') {
        // Windows has no signals: an abort ends the process with an exit code
        // of its own, not SIGABRT.
        return;
      }

      await using dir = await tempDir();
      // The abort prints a stack trace of its own, and it is the exit code
      // that is being asked about — so the run throws that output away.
      await expect(
        runset('test-task:abort', { cwd: dir.path, stderr: 'none' }),
      ).rejects.toMatchObject({
        exitCode: 128 + os.constants.signals.SIGABRT,
      });
    });

    test('an unknown command name falls through to the shell and fails there', async () => {
      await using dir = await tempDir();
      // runset has no list of "valid" names: anything that isn't a script is a
      // shell command, so an unknown name fails the way the shell fails it.
      const { stderr } = await runWithError('unknown-command-xyz', dir.path);

      // `cmd.exe` says it its own way.
      expect(stderr).toMatch(/not found|not recognized/i);
    });

    test('one unknown command fails the whole run', async () => {
      await using dir = await tempDir();
      await runWithError(
        ['test-task:append:a', 'unknown-command-xyz'],
        dir.path,
      );
    });
  });

  describe('missing package.json', () => {
    test('a directory with no package.json still runs shell commands', async () => {
      await using noPackageJson = await tempDir('no-package-json');
      await run('echo hello', noPackageJson.path);
    });

    test('a name that is not a script is not resolved as one', async () => {
      await using noScripts = await tempDir('no-scripts');
      const { stderr } = await runWithError(
        'test-task:append:a',
        noScripts.path,
      );

      // `cmd.exe` reads the `:` as a drive or stream name, and says so.
      expect(stderr).toMatch(/not found|syntax is incorrect/i);
    });
  });
});
