import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { Run, runset } from '../src/index.ts';
import { run } from './helpers/cli.ts';
import { createRun } from './helpers/createRun.ts';
import { tempDir } from './helpers/tempDir.ts';

describe('[run] Run.fromConfigJs builds a run without starting it', () => {
  test('nothing has been spawned until start', async () => {
    await using dir = await tempDir();
    const runner = Run.fromConfigJs({
      commands: ['test-task:append a'],
      cwd: dir.path,
    });

    expect(await dir.result()).toBeUndefined();
    expect(runner.processes.every((item) => !item.started)).toBe(true);

    await runner.start();

    expect(await dir.result()).toBe('aa');
  });

  test('the commands are resolved and there to look at', async () => {
    await using dir = await tempDir();
    const runner = Run.fromConfigJs({
      commands: ['echo a::label=one', 'echo b::label=two'],
      cwd: dir.path,
      parallel: true,
    });

    expect(runner.processes.map((item) => item.command.label)).toEqual([
      'one',
      'two',
    ]);
    // The colors are settled at build time, not on the way past.
    expect(runner.processes[0]?.command.bgColor).not.toBe('');
  });

  test('a run terminated before it starts does nothing', async () => {
    await using dir = await tempDir();
    const runner = Run.fromConfigJs({
      commands: ['test-task:append a'],
      cwd: dir.path,
    });

    runner.terminate();

    // Calling a run off is not the same as running it and finding nothing
    // wrong, so `start` says so rather than resolving.
    await expect(runner.start()).rejects.toThrow(/terminated/i);

    expect(await dir.result()).toBeUndefined();
    expect(runner.isFailed()).toBe(false);
  });

  test('and reports the exit code a terminated run would', async () => {
    await using dir = await tempDir();
    const runner = Run.fromConfigJs({
      commands: ['test-task:append a'],
      cwd: dir.path,
    });

    runner.terminate();

    await expect(runner.start()).rejects.toMatchObject({
      exitCode: 128 + os.constants.signals.SIGTERM,
    });
  });

  test('it throws on a config it cannot use, before anything runs', async () => {
    await using dir = await tempDir();
    expect(() => Run.fromConfigJs({ commands: [], cwd: dir.path })).toThrow(
      /no commands/i,
    );
    expect(() =>
      Run.fromConfigJs({ commands: ['echo hi::nonsense=1'], cwd: dir.path }),
    ).toThrow(/nonsense/);
  });

  test('describe renders the run the way --dry-run does', async () => {
    await using dir = await tempDir();
    const runner = Run.fromConfigJs({
      commands: ['echo a', 'echo b'],
      cwd: dir.path,
    });

    expect(runner.describe()).toMatch(/echo a \(shell\)/);
    expect(runner.describe()).toMatch(/stage 1:/);
    expect(runner.describe()).toMatch(/stage 2:/);
  });

  test('a file destination is not opened until something is written', async () => {
    await using dir = await tempDir();
    const runner = Run.fromConfigJs({
      commands: ['test-task:append a'],
      cwd: dir.path,
      stdout: './build.log',
    });

    expect(await dir.exists('build.log')).toBe(false);

    // The command writes nothing to stdout, so the log has no reason to exist.
    await runner.start();

    expect(await dir.exists('build.log')).toBe(false);
  });

  test('and is opened as soon as there is', async () => {
    await using dir = await tempDir();
    await runset('echo hello', {
      cwd: dir.path,
      stdout: './build.log',
    });

    expect(await dir.read('build.log')).toMatch(/hello/);
  });

  describe('cwd', () => {
    test('a relative run cwd is resolved once, not twice', async () => {
      await using dir = await tempDir();
      const relative = path.relative(process.cwd(), dir.path);
      const runner = Run.fromConfigJs({ commands: ['echo x'], cwd: relative });

      expect(runner.config.cwd).toBe(dir.path);
    });

    test('a command s own cwd is relative to the run s', async () => {
      await using dir = await tempDir();
      const runner = Run.fromConfigJs({
        commands: ['echo x::cwd=tasks'],
        cwd: dir.path,
      });

      expect(runner.processes[0]?.command.cwd).toBe(dir.join('tasks'));
    });

    test('and a named list passes its cwd down in turn', async () => {
      await using dir = await tempDir();
      const runner = Run.fromConfigJs({
        commandDictionary: {
          services: [{ command: 'echo x', cwd: 'api' }],
        },
        commands: [{ command: 'services', cwd: 'services' }],
        cwd: dir.path,
      });

      expect(runner.processes[0]?.command.cwd).toBe(
        path.join(dir.path, 'services', 'api'),
      );
    });

    test('a command actually runs where it was told to', async () => {
      await using dir = await tempDir();
      await fsp.mkdir(dir.join('services'), { recursive: true });

      await runset(
        { command: 'node ../tasks/echo.mjs down-here', cwd: 'services' },
        { cwd: dir.path, stdout: './out.log' },
      );

      expect(await dir.read('out.log')).toMatch(/down-here/);
    });

    test('an npm script runs from the package root, not from --cwd', async () => {
      await using dir = await tempDir();
      // `tasks/` has no package.json of its own, so the manifest is found one
      // level up — and the script's body (`node tasks/append2.mjs`) is
      // written against that directory, not against `tasks/`.
      await run(['--cwd', dir.join('tasks'), 'test-task:append a'], dir.path);

      expect(await dir.result()).toBe('aa');
      expect(await dir.exists('tasks/test.txt')).toBe(false);
    });

    test('while a shell command still runs in --cwd itself', async () => {
      await using dir = await tempDir();
      // `echo.mjs` only resolves from inside `tasks/`, so finding it is the
      // assertion: a shell command is not moved to the package root.
      const { stdout } = await run(
        ['--cwd', dir.join('tasks'), 'node echo.mjs from-tasks'],
        { cwd: dir.path, env: { NO_COLOR: '1' } },
      );

      expect(stdout).toMatch(/from-tasks/);
    });

    test('an explicit cwd still outranks the package root', async () => {
      await using dir = await tempDir();
      const runner = Run.fromConfigJs({
        commands: ['test-task:append a::cwd=tasks'],
        cwd: dir.path,
      });

      expect(runner.processes[0]?.command.cwd).toBe(dir.join('tasks'));
    });
  });

  test('the same run reports what its commands did', async () => {
    await using dir = await tempDir();
    const { runner, stdout } = createRun({
      commands: ['echo a', 'test-task:error'],
      cwd: dir.path,
      parallel: true,
    });

    await expect(runner.start()).rejects.toThrow(/failed/);

    expect(stdout.text).toContain('a');
    expect(runner.isFailed()).toBe(true);
    expect(runner.getExitCode()).toBe(1);
    expect(runner.processes).toHaveLength(2);
  });
});
