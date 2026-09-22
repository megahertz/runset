import { describe, expect, test } from 'vitest';
import { run } from './helpers/cli.ts';
import { createRun } from './helpers/createRun.ts';
import { tempDir } from './helpers/tempDir.ts';

/** `test-task:flaky <n>` fails its first n runs, and marks every one of them. */
async function attempts(dir: {
  read: (path: string) => Promise<string>;
}): Promise<number> {
  const marks = await dir.read('attempts.txt');
  return marks.length;
}

describe('[restart] running a command again when it exits', () => {
  test('a failing command is retried until it works', async () => {
    await using dir = await tempDir();
    await run('test-task:flaky 2::on-failure=restart', dir.path);

    expect(await attempts(dir)).toBe(3);
  });

  test.each(['failure', 'success'] as const)(
    'restarts on %s until explicitly stopped',
    async (when) => {
      await using dir = await tempDir();
      const { runner, stderr } = createRun({
        commands: [`test-task:flaky ${when === 'failure' ? 'Infinity' : '0'}`],
        cwd: dir.path,
        onFailure: when === 'failure' ? 'restart' : 'stop',
        onSuccess: when === 'success' ? 'restart' : 'continue',
        stdout: './attempts.log',
      });
      const running = runner.start().catch((error: unknown) => error);
      try {
        await expect
          .poll(async () =>
            (await dir.exists('attempts.txt')) ? attempts(dir) : 0,
          )
          .toBeGreaterThanOrEqual(3);
      } finally {
        runner.terminate();
      }

      expect(await running).toMatchObject({
        message: 'the run was terminated',
      });
      // Every restart is announced, on runset's own stream.
      expect(stderr.text).toMatch(/restarting "test-task:flaky/);
      const count = await attempts(dir);
      expect(await dir.read('attempts.log')).toContain('attempt 1');
      expect(count).toBeGreaterThanOrEqual(3);
    },
  );

  test('the run-wide flags say the same thing', async () => {
    await using dir = await tempDir();
    await run(['--on-failure', 'restart', 'test-task:flaky 2'], dir.path);

    expect(await attempts(dir)).toBe(3);
  });

  test('reports the final successful attempt', async () => {
    await using dir = await tempDir();
    const { runner } = createRun({
      commands: ['test-task:flaky 2::on-failure=restart'],
      cwd: dir.path,
    });
    await runner.start();

    expect(runner.processes[0]?.exitCode).toBe(0);
    expect(runner.isFailed()).toBe(false);
  });

  test('a command that stops the run ends a restarting neighbour', async () => {
    await using dir = await tempDir();
    // The flaky command never succeeds, so nothing but the run ending stops
    // it: that this returns at all is the whole of the test.
    const { stdout } = await run(
      [
        '-p',
        'test-task:flaky 9::on-failure=restart',
        'echo done::on-success=stop',
      ],
      dir.path,
    );

    expect(stdout).toContain('done');
  });
});
