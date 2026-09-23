import { describe, expect, test } from 'vitest';
import { run } from './helpers/cli.ts';
import { type Dir, tempDir } from './helpers/tempDir.ts';

describe('[placeholders] {1}, {@} and {*} pull from runset s own arguments', () => {
  /** What `test-task:dump` wrote, parsed back into the argv it received. */
  async function dumped(dir: Dir): Promise<unknown> {
    return JSON.parse((await dir.result()) ?? 'null');
  }

  describe('positional', () => {
    test('{1} is empty when nothing follows --', async () => {
      await using dir = await tempDir();
      await run('test-task:dump {1}', dir.path);
      expect(await dumped(dir)).toEqual([]);
    });

    test('{1} is still empty when -- is there but empty', async () => {
      await using dir = await tempDir();
      await run(['test-task:dump {1}', '--'], dir.path);
      expect(await dumped(dir)).toEqual([]);
    });

    test('{1} takes the first argument', async () => {
      await using dir = await tempDir();
      await run(['test-task:dump {1}', '--', '1st', '2nd'], dir.path);
      expect(await dumped(dir)).toEqual(['1st']);
    });

    test('{2} takes the second argument', async () => {
      await using dir = await tempDir();
      await run(['test-task:dump {2}', '--', '1st', '2nd'], dir.path);
      expect(await dumped(dir)).toEqual(['2nd']);
    });

    test('{@} spreads every argument', async () => {
      await using dir = await tempDir();
      await run(['test-task:dump {@}', '--', '1st', '2nd'], dir.path);
      expect(await dumped(dir)).toEqual(['1st', '2nd']);
    });

    test('{*} joins every argument into one', async () => {
      await using dir = await tempDir();
      await run(['test-task:dump {*}', '--', '1st', '2nd'], dir.path);
      expect(await dumped(dir)).toEqual(['1st 2nd']);
    });

    test('several placeholders in one command all resolve', async () => {
      await using dir = await tempDir();
      await run(
        ['test-task:dump {1} {2} {3} {@} {*}', '--', '1st', '2nd'],
        dir.path,
      );

      expect(await dumped(dir)).toEqual([
        '1st',
        '2nd',
        '1st',
        '2nd',
        '1st 2nd',
      ]);
    });

    test('values with spaces survive as a single argument', async () => {
      await using dir = await tempDir();
      await run(['test-task:dump {1}', '--', 'two words'], dir.path);
      expect(await dumped(dir)).toEqual(['two words']);
    });

    test('a value is never read back as shell source', async () => {
      await using dir = await tempDir();
      // The command line runset builds is handed to a shell, so an argument
      // that looks like shell source has to arrive as the text it is.
      const hostile = ['$(printf SUB)', '`printf SUB`', `${'$'}{HOME}`];

      await run(['test-task:dump {1} {2} {3}', '--', ...hostile], dir.path);

      expect(await dumped(dir)).toEqual(hostile);
    });

    test('quotes and backslashes come through as written', async () => {
      await using dir = await tempDir();
      await run(
        ['test-task:dump {1} {2}', '--', 'say "hi"', String.raw`back\slash`],
        dir.path,
      );

      expect(await dumped(dir)).toEqual(['say "hi"', String.raw`back\slash`]);
    });

    test('{@} quotes each argument on its own', async () => {
      await using dir = await tempDir();
      await run(['test-task:dump {@}', '--', '$(printf A)', 'b c'], dir.path);
      expect(await dumped(dir)).toEqual(['$(printf A)', 'b c']);
    });
  });

  test('forwards long flags, empty values and negative numbers literally', async () => {
    await using dir = await tempDir();
    const values = ['--port', '-1', '--help', '', 'a b', '--'];
    await run(['test-task:dump {@}', '--', ...values], dir.path);
    expect(await dumped(dir)).toEqual(values);
  });

  test('unknown braces stay literal', async () => {
    await using dir = await tempDir();
    const { stdout } = await run('echo {not-a-placeholder}', dir.path);
    expect(stdout).toMatch(/\{not-a-placeholder}/);
  });

  test('an inline option takes a placeholder, unquoted', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      ['--dry-run', 'echo hi::label={1}', '--', 'api'],
      dir.path,
    );
    expect(stdout).toMatch(/label\s+"api"/);
  });

  describe('{name}', () => {
    // Through a node script rather than the shell's `echo`, which on Windows
    // prints the quotes that protect the value along with it.
    test('--name value fills the placeholder', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['test-task:echo port={port}', '--', '--port', '8080'],
        dir.path,
      );
      expect(stdout).toMatch(/port=8080/);
    });

    test('--name=value does too', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['test-task:echo port={port}', '--', '--port=8080'],
        dir.path,
      );
      expect(stdout).toMatch(/port=8080/);
    });

    test('a bare --name answers true', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['test-task:echo v={flag}', '--', '--flag'],
        dir.path,
      );
      expect(stdout).toMatch(/v=true/);
    });

    test('either spelling of the name answers', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['test-task:echo v={noTest}', '--', '--no-test', 'yes'],
        dir.path,
      );
      expect(stdout).toMatch(/v=yes/);
    });

    test('an argument that never arrived disables a command', async () => {
      await using dir = await tempDir();
      const skipped = await run(
        ['echo lint', 'echo test::disabled={noTest}', '--', '--noTest'],
        dir.path,
      );
      expect(skipped.stdout).not.toMatch(/test/);

      const both = await run(
        ['echo lint', 'echo test::disabled={noTest}'],
        dir.path,
      );
      expect(both.stdout).toMatch(/test/);
    });

    test('a shell variable is not a placeholder', async () => {
      if (process.platform === 'win32') {
        // `${HOME:-fallback}` is POSIX shell; cmd.exe has no such expansion.
        return;
      }

      await using dir = await tempDir();
      // Written out so the source has no literal `${`, which lint rejects.
      const variable = `${'$'}{HOME:-fallback}`;
      const { stdout } = await run([`echo ${variable}`], dir.path);
      expect(stdout).not.toBe('');
      expect(stdout).not.toMatch(/\$\{HOME/);
    });
  });

  test('command names no longer substitute positional placeholders', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      ['--dry-run', '{1}', '--', 'test-task:append'],
      dir.path,
    );
    expect(stdout).toContain('{1} (shell)');
  });
});
