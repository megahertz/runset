import { describe, expect, test } from 'vitest';
import { Run, runset } from '../src/index.ts';
import {
  delay,
  run,
  runCli,
  runCliAndKill,
  runWithError,
} from './helpers/cli.ts';
import { tempDir } from './helpers/tempDir.ts';

describe('[sequential] runset runs commands one after another by default', () => {
  // Keeps a task alive past the kill in the signal tests below.
  const env = { RUNSET_TEST_DELAY: '600' };

  describe('should run commands sequentially', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      const group = await runset(['test-task:append a', 'test-task:append b'], {
        cwd: dir.path,
      });

      expect(group.processes).toHaveLength(2);
      expect(group.processes[0]?.command.command).toBe('test-task:append a');
      expect(group.processes[0]?.exitCode).toBe(0);
      expect(group.processes[1]?.command.command).toBe('test-task:append b');
      expect(group.processes[1]?.exitCode).toBe(0);
      expect(await dir.result()).toBe('aabb');
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      await run(['test-task:append a', 'test-task:append b'], dir.path);
      expect(await dir.result()).toBe('aabb');
    });

    test('CLI with an explicit --serial group', async () => {
      await using dir = await tempDir();
      await run(
        ['--serial', 'test-task:append a', 'test-task:append b'],
        dir.path,
      );
      expect(await dir.result()).toBe('aabb');
    });
  });

  describe('should stop at the first failure', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      await expect(
        runset(
          ['test-task:append2 a', 'test-task:error', 'test-task:append2 b'],
          {
            cwd: dir.path,
          },
        ),
      ).rejects.toMatchObject({ exitCode: 1 });

      expect(await dir.result()).toBe('aa');
    });

    test('a failure leaves the rest of the run unstarted', async () => {
      await using dir = await tempDir();
      const group = Run.fromConfigJs({
        commands: [
          'test-task:append2 a',
          'test-task:error',
          'test-task:append2 b',
        ],
        cwd: dir.path,
      });

      await expect(group.start()).rejects.toMatchObject({
        message:
          '1 of 3 commands failed, 1 not started: test-task:error exited with code 1',
      });

      const { processes } = group;
      expect(processes).toHaveLength(3);
      expect(processes[0]?.command.command).toBe('test-task:append2 a');
      expect(processes[0]?.exitCode).toBe(0);
      expect(processes[1]?.command.command).toBe('test-task:error');
      expect(processes[1]?.exitCode).toBe(1);
      // Never started, so it never got an exit code.
      expect(processes[2]?.command.command).toBe('test-task:append2 b');
      expect(processes[2]?.exitCode).toBeUndefined();
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      const { code } = await runCli(
        ['test-task:append2 a', 'test-task:error', 'test-task:append2 b'],
        dir.path,
      );

      expect(code).toBe(1);
      expect(await dir.result()).toBe('aa');
    });
  });

  describe('should keep going past a failure with --on-failure continue', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      await expect(
        runset(
          ['test-task:append a', 'test-task:error', 'test-task:append b'],
          {
            cwd: dir.path,
            onFailure: 'continue',
          },
        ),
      ).rejects.toThrow();

      expect(await dir.result()).toBe('aabb');
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      await runWithError(
        [
          '--on-failure',
          'continue',
          'test-task:append a',
          'test-task:error',
          'test-task:append b',
        ],
        dir.path,
      );

      expect(await dir.result()).toBe('aabb');
    });
  });

  test('should kill running children when runset itself is killed', async () => {
    if (process.platform === 'win32') {
      // Windows cannot signal another process: a SIGINT or SIGTERM sent to
      // runset ends it outright, before it can pass anything on.
      return;
    }

    await using dir = await tempDir();
    // Long enough to still be running at the kill, short enough to have
    // written its second half by the time we look, had it survived.
    await runCliAndKill('test-task:append2 a', { cwd: dir.path, env });
    await delay(800);

    // 'a' means the child was killed before it wrote its second half; nothing
    // at all means it never got far enough to write.
    expect(await dir.result()).toBeOneOf([undefined, 'a']);
  });

  test('should pass the signal it was given on to the commands', async () => {
    if (process.platform === 'win32') {
      // Windows cannot signal another process: a SIGINT or SIGTERM sent to
      // runset ends it outright, before it can pass anything on.
      return;
    }

    await using dir = await tempDir();
    await runCliAndKill('test-task:signal', {
      after: 'ready',
      cwd: dir.path,
    });

    // Ctrl+C means SIGINT to the commands too: a command that handles only one
    // of the two is likeliest to be listening for the one the user sent.
    expect(await dir.result()).toBe('SIGINT');
  });

  test('should send SIGTERM when that is what it was given', async () => {
    if (process.platform === 'win32') {
      // Windows cannot signal another process: a SIGINT or SIGTERM sent to
      // runset ends it outright, before it can pass anything on.
      return;
    }

    await using dir = await tempDir();
    await runCliAndKill('test-task:signal', {
      after: 'ready',
      cwd: dir.path,
      signal: 'SIGTERM',
    });

    expect(await dir.result()).toBe('SIGTERM');
  });

  test('should say which signal ended the run', async () => {
    if (process.platform === 'win32') {
      // Windows cannot signal another process: a SIGINT or SIGTERM sent to
      // runset ends it outright, before it can pass anything on.
      return;
    }

    await using dir = await tempDir();
    const result = await runCliAndKill('test-task:signal', {
      after: 'ready',
      cwd: dir.path,
    });

    expect(result.stderr).toContain(
      'runset: SIGINT received, stopping the run',
    );
  });

  test('should say it once, not again as the run ends', async () => {
    if (process.platform === 'win32') {
      // Windows cannot signal another process: a SIGINT or SIGTERM sent to
      // runset ends it outright, before it can pass anything on.
      return;
    }

    await using dir = await tempDir();
    const result = await runCliAndKill('test-task:signal', {
      after: 'ready',
      cwd: dir.path,
      signal: 'SIGTERM',
    });

    expect(result.stderr).toBe('runset: SIGTERM received, stopping the run\n');
  });

  test('should name SIGTERM too', async () => {
    if (process.platform === 'win32') {
      // Windows cannot signal another process: a SIGINT or SIGTERM sent to
      // runset ends it outright, before it can pass anything on.
      return;
    }

    await using dir = await tempDir();
    const result = await runCliAndKill('test-task:signal', {
      after: 'ready',
      cwd: dir.path,
      signal: 'SIGTERM',
    });

    expect(result.stderr).toContain(
      'runset: SIGTERM received, stopping the run',
    );
  });
});
