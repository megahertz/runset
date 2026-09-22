import { describe, expect, test, vi } from 'vitest';
import { Run, runset } from '../src/index.ts';
import { delay, run, runCliAndKill, runWithError } from './helpers/cli.ts';
import { type Dir, tempDir } from './helpers/tempDir.ts';

/** Every interleaving two 'a' and two 'b' writes can produce. */
const INTERLEAVED_AB = ['abab', 'abba', 'baab', 'baba'];

// The tasks' writes only interleave if the second task starts before the first
// one's delay is over, and with the whole suite running at once a start can
// lag well past the default 150ms.
vi.stubEnv('RUNSET_TEST_DELAY', '500');

describe('[parallel] runset runs a -p group all at once', () => {
  describe('should run commands in parallel', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      const group = await runset(['test-task:append a', 'test-task:append b'], {
        cwd: dir.path,
        parallel: true,
      });

      expect(group.processes).toHaveLength(2);
      expect(group.processes[0]?.command.command).toBe('test-task:append a');
      expect(group.processes[0]?.exitCode).toBe(0);
      expect(group.processes[1]?.command.command).toBe('test-task:append b');
      expect(group.processes[1]?.exitCode).toBe(0);
      expect(await dir.result()).toBeOneOf(INTERLEAVED_AB);
    });

    test('CLI (--parallel)', async () => {
      await using dir = await tempDir();
      await run(
        ['--parallel', 'test-task:append a', 'test-task:append b'],
        dir.path,
      );
      expect(await dir.result()).toBeOneOf(INTERLEAVED_AB);
    });

    test('CLI (-p)', async () => {
      await using dir = await tempDir();
      await run(['-p', 'test-task:append a', 'test-task:append b'], dir.path);
      expect(await dir.result()).toBeOneOf(INTERLEAVED_AB);
    });

    test('per-command ::parallel clumps neighbours into one group', async () => {
      await using dir = await tempDir();
      await run(
        ['test-task:append a::parallel', 'test-task:append b::parallel'],
        dir.path,
      );
      expect(await dir.result()).toBeOneOf(INTERLEAVED_AB);
    });
  });

  describe('should kill the whole group when one command fails', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      const group = Run.fromConfigJs({
        commands: ['test-task:append2 a', 'test-task:error'],
        cwd: dir.path,
        parallel: true,
      });

      await expect(group.start()).rejects.toMatchObject({ exitCode: 1 });

      const { processes } = group;
      expect(processes).toHaveLength(2);
      expect(processes[0]?.command.command).toBe('test-task:append2 a');
      // Killed by runset, so it has no exit code of its own.
      expect(processes[0]?.exitCode).toBeUndefined();
      expect(processes[1]?.command.command).toBe('test-task:error');
      expect(processes[1]?.exitCode).toBe(1);
      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      await runWithError(
        ['-p', 'test-task:append2 a', 'test-task:error'],
        dir.path,
      );

      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });
  });

  describe('should keep the group running past a failure with --on-failure continue', () => {
    test('CLI', async () => {
      await using dir = await tempDir();
      await runWithError(
        [
          '--on-failure',
          'continue',
          '-p',
          'test-task:append a',
          'test-task:error',
          'test-task:append b',
        ],
        dir.path,
      );

      expect(await dir.result()).toBeOneOf(INTERLEAVED_AB);
    });
  });

  describe('should stop the rest at the first exit with --on-success stop', () => {
    // Long enough that the second write only lands if nothing killed the task.
    const env = { RUNSET_TEST_DELAY: '1500' };

    test('library API', async () => {
      await using dir = await tempDir();
      const group = await runset(['test-task:append2 a', 'echo done'], {
        cwd: dir.path,
        onSuccess: 'stop',
        parallel: true,
        stdout: 'none',
      });

      expect(group.processes[0]?.command.command).toBe('test-task:append2 a');
      // Stopped by runset, so it has no exit code and does not count as failed.
      expect(group.processes[0]?.exitCode).toBeUndefined();
      expect(group.isFailed()).toBe(false);
      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      await run(
        ['--on-success', 'stop', '-p', 'test-task:append2 a', 'echo done'],
        { cwd: dir.path, env },
      );

      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });

    test('a failing first exit still fails the run', async () => {
      await using dir = await tempDir();
      await runWithError(
        [
          '--on-success',
          'stop',
          '-p',
          'test-task:append2 a',
          'test-task:error',
        ],
        { cwd: dir.path, env },
      );

      expect(await dir.result()).toBeOneOf([undefined, 'a']);
    });

    test('without it the group waits for every command', async () => {
      await using dir = await tempDir();
      await run(['-p', 'test-task:append2 a', 'echo done'], dir.path);

      expect(await dir.result()).toBe('aa');
    });
  });

  describe('should cap concurrency with --jobs', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      const group = await runset(
        ['test-task:append a', 'test-task:append b', 'test-task:append c'],
        { cwd: dir.path, jobs: 2, parallel: true },
      );

      expect(group.processes).toHaveLength(3);
      expect(group.processes.map((item) => item.exitCode)).toEqual([0, 0, 0]);
      // 'c' is in the next batch, so both of its writes land after a's and b's.
      expect(await dir.result()).toBeOneOf(
        INTERLEAVED_AB.map((prefix) => `${prefix}cc`),
      );
    });

    test('CLI (-j 2)', async () => {
      await using dir = await tempDir();
      await run(
        [
          '-p',
          'test-task:append a',
          'test-task:append b',
          'test-task:append c',
          '-j',
          '2',
        ],
        dir.path,
      );

      expect(await dir.result()).toBeOneOf(
        INTERLEAVED_AB.map((prefix) => `${prefix}cc`),
      );
    });
  });

  describe('--jobs bounds the whole run, not one group', () => {
    /** The most commands `test-task:overlap` ever had running at once. */
    async function peak(dir: Dir): Promise<number> {
      const marks = (await dir.result()) ?? '';
      let running = 0;
      let highest = 0;

      for (const character of marks) {
        if (character === '>') {
          running += 1;
        }
        if (character === '<') {
          running -= 1;
        }
        highest = Math.max(highest, running);
      }

      return highest;
    }

    test('two nested parallel pairs still peak at the budget', async () => {
      await using dir = await tempDir();
      // Four commands in two named pairs: a budget handed to each pair
      // separately would let all four run, and peak at 4.
      await runset({
        commandDictionary: {
          first: ['test-task:overlap a', 'test-task:overlap b'],
          second: ['test-task:overlap c', 'test-task:overlap d'],
        },
        commands: ['first::parallel', 'second::parallel'],
        cwd: dir.path,
        jobs: 2,
        parallel: true,
      });

      expect(await peak(dir)).toBe(2);
    });

    test('a named list takes up none of the budget itself', async () => {
      await using dir = await tempDir();
      // With a budget of 1 the two commands inside the named pair still run,
      // one after the other — a list is not a thing that runs, so it counts
      // for nothing.
      await runset({
        commandDictionary: {
          pair: ['test-task:overlap a', 'test-task:overlap b'],
        },
        commands: ['pair::parallel', 'test-task:overlap c'],
        cwd: dir.path,
        jobs: 1,
        parallel: true,
      });

      expect(await peak(dir)).toBe(1);
      expect(await dir.result()).toMatch(/^>[abc]<[abc]/);
    });

    test('a queued command that the run stops never starts', async () => {
      await using dir = await tempDir();
      const running = runset(
        ['test-task:error', 'test-task:append a', 'test-task:append b'],
        { cwd: dir.path, jobs: 1, parallel: true },
      );

      await expect(running).rejects.toThrow(/failed/);
      // The failure ends the run while the other two are still queued; neither
      // is left waiting for a slot it will never be given.
      expect(await dir.result()).toBeUndefined();
    });
  });

  test('a command s own children go down with it', async () => {
    await using dir = await tempDir();
    // `shell: true` means every command is a shell that may have started more
    // processes of its own; leaving those behind is how a watcher keeps a port
    // long after the run that started it is over.
    await runCliAndKill('test-task:spawner', {
      cwd: dir.path,
      delay: 400,
      signal: 'SIGINT',
    });

    const result = (await dir.result()) ?? '';
    expect(result).toMatch(/^spawned:\d+ $/);
    // The grandchild would write SURVIVED at 2s; seeing it gone well before
    // that is the same answer without waiting for it.
    const pid = Number(result.slice('spawned:'.length));
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 1500 });
  });

  test('should kill running children when runset itself is killed', async () => {
    await using dir = await tempDir();
    await runCliAndKill(
      ['-p', 'test-task:append2 a', 'test-task:append2 b'],
      // Still running at the kill, done by the time we look had it survived.
      { cwd: dir.path, env: { RUNSET_TEST_DELAY: '600' } },
    );
    await delay(800);

    expect(await dir.result()).toBeOneOf([undefined, 'a', 'b', 'ab', 'ba']);
  });
});

/** Whether a process with this pid is still running. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
