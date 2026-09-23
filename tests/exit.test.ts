import { describe, expect, test } from 'vitest';
import { runset } from '../src/index.ts';
import {
  OUTLIVES_A_STOP,
  run,
  runCli,
  runCliAndKill,
  runCliAndKillTwice,
  runWithError,
} from './helpers/cli.ts';
import { tempDir } from './helpers/tempDir.ts';

describe('[exit] what a command s exit does to the run', () => {
  describe('the defaults', () => {
    test('a clean exit leaves the others alone', async () => {
      await using dir = await tempDir();
      await run(['-p', 'echo done', 'test-task:append2 a'], dir.path);

      // `echo` finishes first and says nothing about it, so the slow one runs
      // to the end.
      expect(await dir.result()).toBe('aa');
    });

    test('a failure stops the run', async () => {
      await using dir = await tempDir();
      await runWithError(['-p', 'test-task:error', 'test-task:append2 a'], {
        cwd: dir.path,
        env: OUTLIVES_A_STOP,
      });

      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });
  });

  describe('--on-failure', () => {
    test('continue keeps the rest of the run going', async () => {
      await using dir = await tempDir();
      await runWithError(
        ['--on-failure', 'continue', 'test-task:error', 'test-task:append a'],
        dir.path,
      );

      expect(await dir.result()).toBe('aa');
    });
  });

  describe('--on-success', () => {
    test('stop ends the run at the first command to finish', async () => {
      await using dir = await tempDir();
      await run(
        ['--on-success', 'stop', '-p', 'echo done', 'test-task:append2 a'],
        { cwd: dir.path, env: OUTLIVES_A_STOP },
      );

      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });

    test('the run still succeeds: nobody failed', async () => {
      await using dir = await tempDir();
      const group = await runset(['echo done', 'test-task:append2 a'], {
        cwd: dir.path,
        onSuccess: 'stop',
        parallel: true,
        // What `echo` prints is not what this is about; the verdict is.
        stdout: 'none',
      });

      expect(group.isFailed()).toBe(false);
      expect(group.getExitCode()).toBe(0);
    });
  });

  describe('per command', () => {
    test('one command may end the run where another would not', async () => {
      await using dir = await tempDir();
      // The first to finish is `echo`, and it has nothing to say about it;
      // the run ends when the command that matters is done.
      await run(
        [
          '-p',
          'echo quiet::on-success=continue',
          'test-task:echo loud::on-success=stop',
          'test-task:append2 a',
        ],
        { cwd: dir.path, env: OUTLIVES_A_STOP },
      );

      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });

    test('a command may shrug off its own failure', async () => {
      await using dir = await tempDir();
      // The run carries on, and still reports the failure at the end of it.
      await runWithError(
        ['test-task:error::on-failure=continue', 'test-task:append a'],
        dir.path,
      );

      expect(await dir.result()).toBe('aa');
    });

    test('a command outranks the run-wide setting', async () => {
      await using dir = await tempDir();
      await runWithError(
        [
          '--on-failure',
          'continue',
          'test-task:error::on-failure=stop',
          'test-task:append a',
        ],
        dir.path,
      );

      expect(await dir.result()).toBeUndefined();
    });
  });

  test('stop reaches the whole run, not just the group it came from', async () => {
    await using dir = await tempDir();
    await run(
      [
        '-p',
        'echo one::on-success=stop',
        'test-task:append2 a',
        '-s',
        'test-task:append b',
      ],
      { cwd: dir.path, env: OUTLIVES_A_STOP },
    );

    // Neither the command beside it nor the serial step after it gets a turn.
    expect(await dir.result()).toBeOneOf([undefined, 'a']);
  });

  describe('a signal aimed at runset', () => {
    test('SIGINT exits 130, the code a shell reports for it', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      const { code } = await runCliAndKill('test-task:signal', {
        after: 'ready',
        cwd: dir.path,
        signal: 'SIGINT',
      });

      // `runset build && deploy` must not deploy because the build was Ctrl+C'd.
      expect(code).toBe(130);
    });

    test('SIGTERM exits 143', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      const { code } = await runCliAndKill('test-task:signal', {
        after: 'ready',
        cwd: dir.path,
        signal: 'SIGTERM',
      });

      expect(code).toBe(143);
    });

    test('it still ends a run that was carrying a failure', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      // `--on-failure continue` means the failure did not stop the run, so the
      // signal is what did — and 130 is the answer to "why did this stop?".
      const { code } = await runCliAndKill(
        ['--on-failure', 'continue', 'test-task:error', 'test-task:signal'],
        { after: 'ready', cwd: dir.path, signal: 'SIGINT' },
      );

      expect(code).toBe(130);
    });

    test('but a run already stopped by a failure keeps that code', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      // The failure ends the run; the stubborn command ignores the SIGTERM it
      // is sent, so the Ctrl+C that follows is a second signal, not a first.
      // `--show-exit-code` says when the failure has landed.
      const { code } = await runCliAndKill(
        [
          '--kill-timeout',
          '30000',
          '--show-exit-code',
          '-p',
          'test-task:error',
          'test-task:stubborn',
        ],
        { after: 'code 1', cwd: dir.path, signal: 'SIGINT' },
      );

      expect(code).toBe(1);
    });

    test('a successful `on-success=stop` run still exits 0', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      const { code } = await runCli(
        ['--on-success', 'stop', '-p', 'echo done', 'test-task:append2 a'],
        dir.path,
      );

      expect(code).toBe(0);
    });
  });

  describe('--kill-timeout', () => {
    test('a command that ignores SIGTERM is killed anyway', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      const started = Date.now();
      const { code } = await runCliAndKill(
        ['--kill-timeout', '400', 'test-task:stubborn'],
        { after: 'stubborn', cwd: dir.path, signal: 'SIGINT' },
      );

      // Without the escalation this run would never end.
      expect(code).toBe(130);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    test('0 leaves no grace period at all', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      const started = Date.now();
      await runCliAndKill(['--kill-timeout', '0', 'test-task:stubborn'], {
        after: 'stubborn',
        cwd: dir.path,
        signal: 'SIGINT',
      });

      expect(Date.now() - started).toBeLessThan(1500);
    });

    test('a second Ctrl+C does not wait for the timeout', async () => {
      if (process.platform === 'win32') {
        // Windows cannot signal another process: a SIGINT or SIGTERM sent to
        // runset ends it outright, before it can pass anything on.
        return;
      }

      await using dir = await tempDir();
      const started = Date.now();
      const { code } = await runCliAndKillTwice(
        ['--kill-timeout', '30000', 'test-task:stubborn'],
        { after: 'stubborn', cwd: dir.path, delay: 300, signal: 'SIGINT' },
      );

      expect(code).toBe(130);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    test('a value that is not a number is refused', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['--kill-timeout', 'soon', 'echo hi'],
        dir.path,
      );

      expect(stderr).toMatch(/killTimeout/);
    });
  });

  describe('what runset refuses', () => {
    test('an option it does not know, named the way it was written', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        'echo hi::on-failuer=stop',
        dir.path,
      );

      expect(stderr).toMatch(/unknown command option "on-failuer"/i);
    });

    test('an action it does not know', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        'echo hi::on-failure=kil',
        dir.path,
      );

      expect(stderr).toMatch(/continue, restart, stop/);
    });

    test('an action it does not know in the config', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['echo hi'], onSuccess: 'halt' }),
      );

      const { stderr } = await runWithError([], dir.path);

      expect(stderr).toMatch(/onSuccess/);
    });
  });
});
