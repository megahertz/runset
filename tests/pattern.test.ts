import { describe, expect, test } from 'vitest';
import { runset } from '../src/index.ts';
import { run, runWithError } from './helpers/cli.ts';
import { tempDir } from './helpers/tempDir.ts';

describe('[pattern] glob tokens expand against package.json script names', () => {
  describe('"*" matches one segment', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      await runset('test-task:append:*', { cwd: dir.path });
      expect(await dir.result()).toBe('aabb');
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      await run('test-task:append:*', dir.path);
      expect(await dir.result()).toBe('aabb');
    });

    test('CLI in parallel', async () => {
      await using dir = await tempDir();
      await run(['-p', 'test-task:append:*'], dir.path);
      expect(await dir.result()).toBeOneOf(['abab', 'abba', 'baab', 'baba']);
    });
  });

  describe('"**" also matches deeper segments', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      await runset('test-task:append:**', { cwd: dir.path });
      expect(await dir.result()).toBe('aaacacadadbb');
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      await run('test-task:append:**', dir.path);
      expect(await dir.result()).toBe('aaacacadadbb');
    });

    test('a trailing "*" after "**" adds nothing', async () => {
      await using dir = await tempDir();
      await run('test-task:append:**:*', dir.path);
      expect(await dir.result()).toBe('aaacacadadbb');
    });
  });

  test('a wildcard in the middle of the name matches', async () => {
    await using dir = await tempDir();
    await run('test-task:*:a', dir.path);
    expect(await dir.result()).toBe('aa');
  });

  test('matches keep the order they were declared in package.json', async () => {
    await using dir = await tempDir();
    await run(['test-task:append:b', 'test-task:append:a'], dir.path);
    expect(await dir.result()).toBe('bbaa');
  });

  test('a name and a glob that both match run the command twice', async () => {
    await using dir = await tempDir();
    // Nothing deduplicates: asking for a command twice runs it twice.
    await run(['test-task:append:b', 'test-task:append:*'], dir.path);
    expect(await dir.result()).toBe('bbaabb');
  });

  describe('a glob that matches nothing succeeds silently', () => {
    test('library API', async () => {
      await using dir = await tempDir();
      const group = await runset('nonexistent:*', { cwd: dir.path });
      expect(group.processes).toEqual([]);
    });

    test('CLI', async () => {
      await using dir = await tempDir();
      const { stderr } = await run('nonexistent:*', dir.path);
      expect(stderr).toBe('');
    });
  });

  test('a bare name is matched exactly, not as a suffix', async () => {
    await using dir = await tempDir();
    // 'a' must not match 'test-task:append:a'. With no such script, runset falls
    // back to running it as a shell command, which fails.
    await runWithError('a', dir.path);
    expect(await dir.result()).toBeUndefined();
  });

  test('script names that look like glob syntax are matched literally', async () => {
    await using dir = await tempDir();
    await run(['!test', '?test'], dir.path);
    const result = await dir.result();
    expect(result?.trim()).toBe('XQ');
  });
});
