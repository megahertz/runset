import { describe, expect, test } from 'vitest';
import { Run, runset } from '../src/index.ts';
import { run, runWithError } from './helpers/cli.ts';
import { type Dir, tempDir } from './helpers/tempDir.ts';

describe('[config] runset.config.* and config scripts', () => {
  describe('loading', () => {
    test('picks up runset.config.json next to package.json', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['test-task:append a'] }),
      );

      await run([], dir.path);
      expect(await dir.result()).toBe('aa');
    });

    test('picks up runset.config.js exporting an object', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        'module.exports = { commands: ["test-task:append a"] };\n',
      );

      await run([], dir.path);
      expect(await dir.result()).toBe('aa');
    });

    test('picks up runset.config.ts', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.ts',
        'const config: { commands: string[] } = { commands: ["test-task:append a"] };\n' +
          'export default config;\n',
      );

      await run([], dir.path);
      expect(await dir.result()).toBe('aa');
    });

    test('calls a config that exports a function', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.cjs',
        'module.exports = ({ env }) =>\n' +
          '  ({ commands: ["test-task:append " + env.PICK] });\n',
      );

      await run([], { cwd: dir.path, env: { PICK: 'b' } });
      expect(await dir.result()).toBe('bb');
    });

    test('walks up parent directories to find one', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['echo found-by-walking-up'] }),
      );

      // `--cwd` points at a subdirectory that has no config of its own.
      const { stdout } = await run(['--cwd', dir.join('tasks')], dir.path);

      expect(stdout).toMatch(/found-by-walking-up/);
    });

    test('--config skips the lookup and loads the named file', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['test-task:append a'] }),
      );
      await dir.write(
        'other.config.json',
        JSON.stringify({ commands: ['test-task:append b'] }),
      );

      await run(['-c', 'other.config.json'], dir.path);
      expect(await dir.result()).toBe('bb');
    });

    describe('and finds it however the flag was spelled', () => {
      /** The default config and the one `--config` should reach instead. */
      async function twoConfigs(dir: Dir): Promise<void> {
        await dir.write(
          'runset.config.json',
          JSON.stringify({ commands: ['test-task:append a'] }),
        );
        await dir.write(
          'other.config.json',
          JSON.stringify({ commands: ['test-task:append b'] }),
        );
      }

      test('-c<path>, with the value attached', async () => {
        await using dir = await tempDir();
        await twoConfigs(dir);

        await run('-cother.config.json', dir.path);
        expect(await dir.result()).toBe('bb');
      });

      test('--config=<path>', async () => {
        await using dir = await tempDir();
        await twoConfigs(dir);

        await run('--config=other.config.json', dir.path);
        expect(await dir.result()).toBe('bb');
      });

      test('clustered behind another short flag', async () => {
        await using dir = await tempDir();
        await twoConfigs(dir);

        // `-pc <path>`: a switch and then the flag that takes the value.
        await run(['-pc', 'other.config.json'], dir.path);
        expect(await dir.result()).toBe('bb');
      });

      test('a value that looks like a flag is still the value', async () => {
        await using dir = await tempDir();
        await twoConfigs(dir);
        await dir.write(
          '--odd.json',
          JSON.stringify({ commands: ['test-task:append c'] }),
        );

        await run('-c--odd.json', dir.path);
        expect(await dir.result()).toBe('cc');
      });

      test('a missing file named this way is still an error', async () => {
        await using dir = await tempDir();
        const { stderr } = await runWithError('-cnope.json', dir.path);
        expect(stderr).toMatch(/config file not found: nope\.json/i);
      });
    });

    test('--cwd is read the same way, attached or not', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['test-task:append a'] }),
      );

      // `--jobs` takes a value, so the `--cwd` inside it is that value and not
      // a flag of runset's own.
      await run(['--jobs=2', '--cwd', dir.path], dir.originalPath);
      expect(await dir.result()).toBe('aa');
    });

    test('-j2 bounds the run with its value attached', async () => {
      await using dir = await tempDir();
      await run(
        ['-j2', '-p', 'test-task:append a', 'test-task:append b'],
        dir.path,
      );

      expect(await dir.result()).not.toBeUndefined();
    });

    test('CLI commands run after the config s own pipeline', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['test-task:append a'] }),
      );

      await run('test-task:append b', dir.path);
      expect(await dir.result()).toBe('aabb');
    });

    test('an unknown config key warns and is ignored', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['test-task:append a'], parallelism: 4 }),
      );

      const { stderr } = await run([], dir.path);

      expect(stderr).toMatch(/unknown config key "parallelism"/i);
      expect(await dir.result()).toBe('aa');
    });

    test('a lone `parallel` passes without comment', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: [
            'test-task:append a',
            'test-task:append b::parallel',
            'test-task:append c',
          ],
        }),
      );

      const { stderr } = await run([], dir.path);

      // A group of one is a group; a glob or a disabled neighbour can leave
      // one behind, so it is not the mistake it looks like.
      expect(stderr).toBe('');
      expect(await dir.result()).toBe('aabbcc');
    });

    test('a config that throws surfaces the underlying message', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.cjs',
        'throw new Error("config blew up");\n',
      );

      const { stderr } = await runWithError('echo hi', dir.path);

      expect(stderr).toMatch(/config blew up/);
    });

    describe('package.json `runset` section', () => {
      test('is read like runset.config.json', async () => {
        await using dir = await tempDir();
        const pkg = JSON.parse(await dir.read('package.json'));
        await dir.write(
          'package.json',
          JSON.stringify({
            ...pkg,
            runset: { commands: ['test-task:append a'] },
          }),
        );

        await run([], dir.path);
        expect(await dir.result()).toBe('aa');
      });

      test('loses to a runset.config.* in the same directory', async () => {
        await using dir = await tempDir();
        const pkg = JSON.parse(await dir.read('package.json'));
        await dir.write(
          'package.json',
          JSON.stringify({
            ...pkg,
            runset: { commands: ['test-task:append a'] },
          }),
        );
        await dir.write(
          'runset.config.json',
          JSON.stringify({ commands: ['test-task:append b'] }),
        );

        await run([], dir.path);
        expect(await dir.result()).toBe('bb');
      });

      test('must be an object', async () => {
        await using dir = await tempDir();
        const pkg = JSON.parse(await dir.read('package.json'));
        await dir.write('package.json', JSON.stringify({ ...pkg, runset: [] }));

        const { stderr } = await runWithError('echo hi', dir.path);

        expect(stderr).toMatch(/"runset" must be an object/);
      });
    });
  });

  describe('run-wide options', () => {
    test('the config sets defaults', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: ['test-task:error', 'test-task:append a'],
          onFailure: 'continue',
        }),
      );

      await runWithError([], dir.path);

      expect(await dir.result()).toBe('aa');
    });

    test('a CLI flag beats the config on the same option', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: ['test-task:error', 'test-task:append a'],
          onFailure: 'continue',
        }),
      );

      await runWithError(['--on-failure', 'stop'], {
        cwd: dir.path,
        env: { NO_COLOR: '1' },
      });

      // The config would have carried on past the failure; the flag says no.
      expect(await dir.result()).toBeUndefined();
    });

    test('and leaves the options it says nothing about alone', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: ['test-task:error', 'test-task:append a'],
          onFailure: 'continue',
        }),
      );

      await runWithError(['--log-level', 'error'], {
        cwd: dir.path,
        env: { NO_COLOR: '1' },
      });

      expect(await dir.result()).toBe('aa');
    });
  });

  describe('scripts', () => {
    test('resolves a bare name to its entry', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: { greet: 'echo hello-from-config-scripts' },
          commands: ['greet'],
        }),
      );

      const { stdout } = await run([], dir.path);
      expect(stdout).toMatch(/hello-from-config-scripts/);
    });

    test('an entry overrides a package.json script of the same name', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: { 'test-task:append': 'node tasks/append1.mjs z' },
          commands: ['test-task:append'],
        }),
      );

      await run([], dir.path);
      expect(await dir.result()).toBe('z');
    });

    test('an entry may carry its own options', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: {
            quiet: { command: 'echo hidden', stdout: 'none' },
          },
          commands: ['quiet'],
        }),
      );

      const { stdout } = await run([], dir.path);
      expect(stdout).toBe('');
    });

    test('an inline option beats the entry s own', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: {
            quiet: { command: 'echo shown', stdout: 'none' },
          },
          commands: ['quiet::stdout=stdout'],
        }),
      );

      const { stdout } = await run([], dir.path);
      expect(stdout).toMatch(/shown/);
    });

    test('an entry may expand to a whole list', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: {
            checks: [
              'test-task:append a::parallel',
              'test-task:append b::parallel',
            ],
          },
          commands: ['checks'],
        }),
      );

      await run([], dir.path);
      expect(await dir.result()).toBeOneOf(['abab', 'abba', 'baab', 'baba']);
    });

    test('arguments after the name are passed through', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: { dump: 'node tasks/dump.mjs' },
          commands: ['dump one two'],
        }),
      );

      await run([], dir.path);
      expect(JSON.parse((await dir.result()) ?? 'null')).toEqual([
        'one',
        'two',
      ]);
    });

    test('an inline stream option changes only the axis it names', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: {
            alias: { command: 'echo x', stdout: './alias.log' },
          },
        }),
      );

      // `grouped` is a timing; the entry's file is the destination, and
      // saying nothing about it is not the same as putting it back.
      await run('alias::stdout=grouped', dir.path);

      expect(await dir.read('alias.log')).toMatch(/x/);
    });

    test('and the other way round, too', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: {
            alias: { command: 'echo x', stdout: 'grouped' },
          },
        }),
      );

      const { stdout } = await run('alias::stdout=./alias.log', dir.path);

      expect(stdout).toBe('');
      expect(await dir.read('alias.log')).toMatch(/x/);
    });

    test('an inline file replaces the file set in scripts', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: {
            alias: { command: 'echo x', stdout: './alias.log' },
          },
        }),
      );

      await run('alias::stdout=./override.log', dir.path);

      expect(await dir.read('override.log')).toMatch(/x/);
      expect(await dir.exists('alias.log')).toBe(false);
    });

    test('an entry that refers to itself is an error', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          scripts: { loop: 'loop' },
          commands: ['loop'],
        }),
      );

      const { stderr } = await runWithError([], dir.path);

      expect(stderr).toMatch(/refers to itself/i);
    });
  });

  describe('parallel as a run-wide default', () => {
    test('the config setting reaches every command', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: ['test-task:append a', 'test-task:append b'],
          parallel: true,
        }),
      );

      await run([], dir.path);
      expect(await dir.result()).toBeOneOf(['abab', 'abba', 'baab', 'baba']);
    });

    test('a command may still say otherwise', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({
          commands: [
            'test-task:append a',
            { command: 'test-task:append b', parallel: false },
          ],
          parallel: true,
        }),
      );

      // `b` is a barrier, so it waits for `a` rather than joining it.
      await run([], dir.path);
      expect(await dir.result()).toBe('aabb');
    });

    test('it reaches commands inside a named list', async () => {
      await using dir = await tempDir();
      const runner = Run.fromConfigJs({
        scripts: { pair: ['echo a', 'echo b'] },
        commands: ['pair'],
        cwd: dir.path,
        parallel: true,
      });

      expect(runner.processes.map((item) => item.command.parallel)).toEqual([
        true,
        true,
      ]);
    });
  });

  describe('library API', () => {
    test('one object carrying commands is the whole config', async () => {
      await using dir = await tempDir();
      const group = await runset({
        commands: ['test-task:append a'],
        cwd: dir.path,
      });

      expect(group.isFailed()).toBe(false);
      expect(await dir.result()).toBe('aa');
    });

    test('and resolves the same as the two-argument form', async () => {
      await using dir = await tempDir();
      // Both forms discard the output: what they resolved to is the test.
      const options = {
        cwd: dir.path,
        jobs: 3,
        parallel: true,
        stdout: 'none',
      };
      const commands = ['echo a::label=x', 'echo b'];

      const asOne = await runset({ ...options, commands });
      const asTwo = await runset(commands, options);

      expect(asOne.processes.map((item) => item.command)).toEqual(
        asTwo.processes.map((item) => item.command),
      );
    });

    test('a settings entry may lead the command list', async () => {
      await using dir = await tempDir();
      await runset([{ parallel: true }, 'test-task:append a'], {
        cwd: dir.path,
      });

      expect(await dir.result()).toBe('aa');
    });

    test('Run.fromConfigJs only builds; runset builds and starts', async () => {
      await using dir = await tempDir();
      const runner = Run.fromConfigJs({
        commands: ['test-task:append a'],
        cwd: dir.path,
      });

      expect(await dir.result()).toBeUndefined();

      await runner.start();
      expect(await dir.result()).toBe('aa');
    });

    test('passing commands skips the config-file lookup', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.json',
        JSON.stringify({ commands: ['test-task:append a'] }),
      );

      await runset(['test-task:append b'], { cwd: dir.path });

      // Only the caller's command ran: the file on disk was never read.
      expect(await dir.result()).toBe('bb');
    });

    test('scripts may be supplied inline', async () => {
      await using dir = await tempDir();
      await runset(['greet'], {
        scripts: { greet: 'node tasks/append1.mjs g' },
        cwd: dir.path,
      });

      expect(await dir.result()).toBe('g');
    });
  });
});
