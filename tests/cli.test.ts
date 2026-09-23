import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { runset } from '../src/index.ts';
import { run, runNode, runWithError } from './helpers/cli.ts';
import { makeTempDir, tempDir } from './helpers/tempDir.ts';

describe('[cli] the command-line surface', () => {
  describe('help and version', () => {
    test('prints help when run with no arguments', async () => {
      await using dir = await tempDir();
      const { stdout } = await run([], dir.path);

      expect(stdout).toMatch(/Usage:/);
    });

    test.each(['-h', '--help'])('prints help for %s', async (flag) => {
      await using dir = await tempDir();
      const { stdout } = await run(flag, dir.path);

      expect(stdout).toMatch(/Usage:/);
    });

    test.each(['-v', '--version'])(
      'prints the version for %s',
      async (flag) => {
        await using dir = await tempDir();
        const { stdout } = await run(flag, dir.path);

        expect(stdout).toMatch(/^v\d+\.\d+\.\d+/);
      },
    );

    test('prints it from a directory whose name has a space in it', async () => {
      await using dir = await tempDir();
      // The version is read out of runset's own package.json, found relative to
      // the CLI module. A path taken straight off a file URL keeps its
      // percent-encoding, so "runset review" would be looked for under
      // "runset%20review" — and never found.
      const root = await makeTempDir('version test-');
      try {
        const cli = path.join(root, 'src', 'index.ts');
        await fsp.cp(
          fileURLToPath(new URL('../src', import.meta.url)),
          path.join(root, 'src'),
          { recursive: true },
        );
        await fsp.writeFile(
          path.join(root, 'package.json'),
          JSON.stringify({ name: 'runset', version: '9.8.7' }),
        );

        const { stdout } = await runNode([cli, '--version'], dir.path);
        expect(stdout.trim()).toBe('v9.8.7');
      } finally {
        await fsp.rm(root, { recursive: true });
      }
    });
  });

  describe('command execution', () => {
    test('a command may read stdin', async () => {
      await using dir = await tempDir();
      await run('test-task:stdin', dir.path);
      const result = await dir.result();
      expect(result?.trim()).toBe('STDIN');
    });

    test('a script may redirect its own stdout', async () => {
      await using dir = await tempDir();
      await run('test-task:stdout', dir.path);
      expect(await dir.result()).toBe('STDOUT');
    });

    test('a script may redirect its own stderr', async () => {
      await using dir = await tempDir();
      await run('test-task:stderr', dir.path);
      expect(await dir.result()).toBe('STDERR');
    });

    test('a raw shell command runs even without a matching script', async () => {
      await using dir = await tempDir();
      const { stdout } = await run('echo hello-from-the-shell', dir.path);
      expect(stdout).toMatch(/hello-from-the-shell/);
    });

    test('npm scripts get npm_lifecycle_event and npm_package_name', async () => {
      await using dir = await tempDir();
      await run('test-task:env', {
        cwd: dir.path,
        env: { RUNSET_TEST_CUSTOM: 'yes' },
      });

      expect(JSON.parse((await dir.result()) ?? '{}')).toEqual({
        custom: 'yes',
        lifecycleEvent: 'test-task:env',
        packageName: 'runset-test-workspace',
      });
    });

    test('a command may add to the environment it runs in', async () => {
      await using dir = await tempDir();
      const group = await runset(
        {
          command: 'test-task:env',
          env: { RUNSET_TEST_CUSTOM: 'from-the-command' },
        },
        { cwd: dir.path },
      );

      expect(group.isFailed()).toBe(false);
      expect(JSON.parse((await dir.result()) ?? '{}')).toMatchObject({
        custom: 'from-the-command',
      });
    });

    test('what a command adds wins over what the run was given', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        'module.exports = { commands: [{ command: "test-task:env", ' +
          'env: { RUNSET_TEST_CUSTOM: "the command" } }] };',
      );

      await run([], { cwd: dir.path, env: { RUNSET_TEST_CUSTOM: 'the run' } });

      expect(JSON.parse((await dir.result()) ?? '{}')).toMatchObject({
        custom: 'the command',
      });
    });

    test('-e adds to the environment of every command', async () => {
      await using dir = await tempDir();
      await run(['-e', 'RUNSET_TEST_CUSTOM=from-the-flag', 'test-task:env'], {
        cwd: dir.path,
        env: { RUNSET_TEST_CUSTOM: 'the run' },
      });

      expect(JSON.parse((await dir.result()) ?? '{}')).toMatchObject({
        custom: 'from-the-flag',
      });
    });

    test('a config file env reaches every command', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        'module.exports = { env: { RUNSET_TEST_CUSTOM: "the file" } };',
      );

      await run('test-task:env', dir.path);

      expect(JSON.parse((await dir.result()) ?? '{}')).toMatchObject({
        custom: 'the file',
      });
    });

    test('runs ten commands without warning about listeners', async () => {
      await using dir = await tempDir();
      const { stderr } = await run(
        ['-p', ...Array.from({ length: 10 }, () => 'test-task:append:a')],
        dir.path,
      );

      expect(stderr).not.toMatch(/MaxListenersExceededWarning/);
    });
  });

  describe('--cwd', () => {
    test('runs the commands somewhere else', async () => {
      await using dir = await tempDir();
      await using elsewhere = await tempDir();
      await run(['--cwd', elsewhere.path, 'test-task:append a'], dir.path);

      expect(await elsewhere.result()).toBe('aa');
      expect(await dir.result()).toBeUndefined();
    });
  });

  describe('--dry-run', () => {
    test('prints the resolved tree and runs nothing', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        [
          '--dry-run',
          'test-task:append a',
          '-p',
          'test-task:append b',
          'test-task:append c',
        ],
        dir.path,
      );

      expect(await dir.result()).toBeUndefined();
      expect(stdout).toMatch(/test-task:append a \(npm\)/);
      // The plan is drawn the way the run will go: the `-p` tasks share the
      // stage after the one holding the task written before them.
      expect(stdout).toMatch(/stage 1:\s*\n\s+- test-task:append a/);
      expect(stdout).toMatch(/stage 2:/);
    });

    test('the plan goes to stdout, so it can be redirected', async () => {
      await using dir = await tempDir();
      // A dry run's output *is* its deliverable; routing it through the logger
      // would let `--log-level error` throw it away.
      const { stdout, stderr } = await run(
        ['--dry-run', '--log-level', 'error', 'test-task:append a'],
        { cwd: dir.path, env: { NO_COLOR: '1' } },
      );

      expect(stdout).toMatch(/test-task:append a/);
      expect(stderr).toBe('');
    });

    test('it reports the run-wide options too', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--dry-run', '--jobs', '3', '--kill-timeout', '250', 'echo hi'],
        dir.path,
      );

      expect(stdout).toMatch(/Options:/);
      expect(stdout).toMatch(/jobs\s+3/);
      expect(stdout).toMatch(/kill-timeout\s+250ms/);
      expect(stdout).toMatch(/on-failure\s+stop/);
      expect(stdout).toMatch(/cwd\s+\S/);
    });

    test('and every setting each command ended up with', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--dry-run', 'test-task:append a::label=one,on-success=stop'],
        dir.path,
      );

      expect(stdout).toMatch(/line\s+node tasks\/append2\.mjs a/);
      expect(stdout).toMatch(/label\s+"one"/);
      expect(stdout).toMatch(/on-success\s+stop/);
      expect(stdout).toMatch(/on-failure\s+stop/);
    });

    test('a list whose every command is off leaves nothing behind', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: { off: [{ command: 'echo a', disabled: true }] },
          commands: ['off', 'echo b'],
        }),
      );

      const { stdout } = await run('--dry-run', dir.path);

      expect(stdout).toMatch(/echo b/);
      expect(stdout).not.toMatch(/echo a/);
      // And no empty stage left standing where the list used to be.
      expect(stdout).not.toMatch(/stage 2:/);
    });

    test('env shows what was configured and nothing else', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: { checks: ['echo hi'] },
          commands: [
            { command: 'checks', env: { FROM_LIST: 'g' } },
            { command: 'echo bye', env: { FROM_COMMAND: 'c' } },
          ],
          dryRun: true,
        }),
      );

      const { stdout } = await run([], {
        cwd: dir.path,
        env: { RUNSET_TEST_CUSTOM: 'from-the-host' },
      });

      expect(stdout).toMatch(/env FROM_LIST\s+g/);
      expect(stdout).toMatch(/env FROM_COMMAND\s+c/);
      // The environment runset itself was started with is not part of the plan.
      expect(stdout).not.toMatch(/from-the-host/);
    });
  });

  describe('task syntax', () => {
    test('the last :: is the separator, not the first', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--dry-run', 'echo a::b c::label=x'],
        dir.path,
      );

      expect(stdout).toMatch(/echo a::b c \(shell\)/);
    });

    test('a trailing :: escapes a command carrying one of its own', async () => {
      await using dir = await tempDir();
      // An empty option list is still an option list, so it takes the role of
      // the separator and leaves the `::` in the command alone.
      const { stdout } = await run(
        ['--dry-run', 'perl -MData::Dumper::'],
        dir.path,
      );

      expect(stdout).toMatch(/perl -MData::Dumper \(shell\)/);
    });

    test('without the escape, a command s own :: is read as options', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError('perl -MData::Dumper', dir.path);

      expect(stderr).toMatch(/unknown command option/i);
    });
  });

  describe('--log-level', () => {
    test('error hides runset s own chatter but keeps command output', async () => {
      await using dir = await tempDir();
      const { stdout, stderr } = await run(
        ['--log-level', 'error', 'echo visible'],
        dir.path,
      );

      expect(stdout).toMatch(/visible/);
      expect(stderr).toBe('');
    });

    test('debug shows the shell line each command runs', async () => {
      await using dir = await tempDir();
      const { stderr } = await run(
        ['--log-level', 'debug', 'test-task:append a'],
        dir.path,
      );

      expect(stderr).toMatch(/node tasks\/append2\.mjs a/);
    });
  });
});
