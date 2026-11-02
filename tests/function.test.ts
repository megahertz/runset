import { describe, expect, test } from 'vitest';
import { Run } from '../src/index.ts';
import type { TaskContext } from '../src/types.ts';
import { run } from './helpers/cli.ts';
import { createRun } from './helpers/createRun.ts';
import { fixturePath, tempDir } from './helpers/tempDir.ts';

describe('[function] a command written as a function', () => {
  test('resolving is success, and its writes land in its own output', async () => {
    const { runner, stdout } = createRun({
      commands: [
        {
          command: () => {
            process.stdout.write('from the process stream\n');
          },
        },
        {
          command: ({ stdout: out }: TaskContext) => {
            out.write('from the context stream\n');
          },
        },
      ],
      cwd: fixturePath(),
    });

    await runner.start();

    expect(runner.getExitCode()).toBe(0);
    expect(stdout.text).toBe(
      'from the process stream\nfrom the context stream\n',
    );
  });

  test('rejecting is a failure that stops the run', async () => {
    const { runner, stderr } = createRun({
      commands: [
        {
          async command() {
            throw new Error('boom');
          },
          label: 'migrate',
        },
        { command: () => {} },
      ],
      cwd: fixturePath(),
    });

    await expect(runner.start()).rejects.toMatchObject({
      exitCode: 1,
      message:
        '1 of 2 commands failed, 1 not started: function (migrate) failed: boom',
    });
    expect(stderr.text).toContain('Error: boom');
  });

  test('a rejection is restarted like any failure', async () => {
    let calls = 0;
    const { runner } = createRun({
      commands: [
        {
          command: () => {
            calls += 1;
            if (calls < 3) {
              throw new Error('not yet');
            }
          },
          onFailure: 'restart',
        },
      ],
      cwd: fixturePath(),
    });

    await runner.start();
    expect(calls).toBe(3);
  });

  test('the context has its cwd and env, the process keeps its own', async () => {
    let seen: TaskContext | undefined;
    const { runner } = createRun({
      commands: [
        {
          command: (context: TaskContext) => {
            seen = context;
          },
          cwd: 'packages',
          env: { RUNSET_FN_TEST: 'yes' },
        },
      ],
      cwd: fixturePath(),
    });

    await runner.start();

    expect(seen?.cwd).toBe(fixturePath('workspace/packages'));
    expect(seen?.env.RUNSET_FN_TEST).toBe('yes');
    expect(process.env.RUNSET_FN_TEST).toBeUndefined();
  });

  test('a stop aborts its signal', async () => {
    const { runner } = createRun({
      commands: [
        {
          command: ({ signal }: TaskContext) =>
            new Promise<void>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason));
            }),
          parallel: true,
        },
        { command: 'node -e "process.exit(3)"', parallel: true },
      ],
      cwd: fixturePath(),
    });

    await expect(runner.start()).rejects.toMatchObject({ exitCode: 3 });
    // Stopped by runset, not failed of its own accord.
    expect(runner.processes[0]?.isFailed()).toBe(false);
    expect(runner.processes[0]?.terminated).toBe(true);
  });

  test('one that ignores its signal is given up on after killTimeout', async () => {
    const { runner, stderr } = createRun({
      commands: [
        { command: () => new Promise<void>(() => {}), parallel: true },
        { command: 'node -e "process.exit(3)"', parallel: true },
      ],
      cwd: fixturePath(),
      killTimeout: 50,
    });

    await expect(runner.start()).rejects.toMatchObject({ exitCode: 3 });
    expect(stderr.text).toContain('function did not stop');
  });
});

describe('[function] a function resolving with a function is a service', () => {
  test('the next stage starts once it is ready; it is stopped last, newest first', async () => {
    const events: string[] = [];
    const service = (name: string) => () => {
      events.push(`start ${name}`);
      return () => {
        events.push(`stop ${name}`);
      };
    };
    const { runner } = createRun({
      commands: [
        { command: service('db') },
        { command: service('cache') },
        {
          command: () => {
            events.push('test');
          },
        },
      ],
      cwd: fixturePath(),
    });

    await runner.start();

    expect(events).toEqual([
      'start db',
      'start cache',
      'test',
      'stop cache',
      'stop db',
    ]);
  });

  test('it is stopped when a failure ends the run', async () => {
    const events: string[] = [];
    const { runner } = createRun({
      commands: [
        {
          command: () => () => {
            events.push('stop db');
          },
        },
        { command: 'node -e "process.exit(2)"' },
      ],
      cwd: fixturePath(),
    });

    await expect(runner.start()).rejects.toMatchObject({ exitCode: 2 });
    expect(events).toEqual(['stop db']);
  });

  test('a forced kill earlier in the run does not skip its stop', async () => {
    const events: string[] = [];
    const { runner } = createRun({
      commands: [
        {
          command: () => async () => {
            await new Promise((resolve) => {
              setTimeout(resolve, 20);
            });
            events.push('stop db');
          },
        },
        {
          command: () => {
            runner.terminate({ force: true });
          },
        },
      ],
      cwd: fixturePath(),
    });

    await expect(runner.start()).rejects.toMatchObject({
      message: 'the run was terminated',
    });
    expect(events).toEqual(['stop db']);
  });

  test('being ready is not an exit: onSuccess does not fire', async () => {
    let tested = false;
    const { runner } = createRun({
      commands: [
        { command: () => () => {}, onSuccess: 'stop' },
        {
          command: () => {
            tested = true;
          },
        },
      ],
      cwd: fixturePath(),
    });

    await runner.start();
    expect(tested).toBe(true);
  });

  test('a stop that fails only warns, and the others still run', async () => {
    const events: string[] = [];
    const { runner, stderr } = createRun({
      commands: [
        {
          command: () => () => {
            events.push('stop first');
          },
        },
        {
          command: () => () => {
            throw new Error('port busy');
          },
          label: 'second',
        },
        { command: () => () => new Promise<void>(() => {}), label: 'third' },
      ],
      cwd: fixturePath(),
      killTimeout: 50,
    });

    await runner.start();

    expect(runner.getExitCode()).toBe(0);
    expect(events).toEqual(['stop first']);
    expect(stderr.text).toContain('third did not stop within 50ms');
    expect(stderr.text).toContain('second failed to stop: port busy');
  });

  test('its output after ready is still its own', async () => {
    const { runner, stdout } = createRun({
      commands: [
        {
          command: () => {
            const timer = setInterval(() => process.stdout.write('tick\n'), 5);
            return () => clearInterval(timer);
          },
          label: 'db',
        },
        { command: 'node -e "setTimeout(() => {}, 100)"' },
      ],
      color: 'none',
      cwd: fixturePath(),
    });

    await runner.start();

    expect(stdout.text).toMatch(/^\[db\] tick\n/);
  });
});

describe('[function] how a function is named and resolved', () => {
  test('labelled by its name, or `function` when it has none', () => {
    const runner = Run.fromConfigJs({
      commands: [
        { command: function startDb() {} },
        { command: () => {} },
        { command: () => {} },
      ],
      cwd: fixturePath(),
      labels: 'all',
    });

    expect(runner.processes.map(({ command }) => command.label.trim())).toEqual(
      ['startDb', 'function#1', 'function#2'],
    );
    expect(runner.describe()).toContain('- startDb (function)');
  });

  test('a scripts entry may hold one, and arguments to it are refused', () => {
    const fn = () => {};
    const scripts = { db: { command: fn } };
    const runner = Run.fromConfigJs({
      commands: ['db::label=database'],
      cwd: fixturePath(),
      scripts,
    });
    expect(runner.processes[0]?.command).toMatchObject({
      command: 'db',
      fn,
      label: 'database',
      type: 'function',
    });

    expect(() =>
      Run.fromConfigJs({ commands: ['db x'], cwd: fixturePath(), scripts }),
    ).toThrow('Cannot pass arguments to "db": it is a function.');
  });

  test('its own `recursive` runs it once per package, from that package', () => {
    const runner = Run.fromConfigJs({
      commands: [{ command: () => {}, recursive: true }],
      cwd: fixturePath('monorepo'),
    });

    expect(
      runner.processes.map(({ command }) => [command.packageName, command.cwd]),
    ).toEqual([
      ['pkg-a', fixturePath('monorepo/packages/a')],
      ['pkg-b', fixturePath('monorepo/packages/b')],
    ]);
  });

  test('an inherited `recursive` leaves it alone', () => {
    const runner = Run.fromConfigJs({
      commands: [{ command: () => {} }, 'build'],
      cwd: fixturePath('monorepo'),
      recursive: true,
    });

    expect(
      runner.processes.map(({ command }) => command.packageName ?? 'root'),
    ).toEqual(['root', 'pkg-a', 'pkg-b']);
  });

  test('console output is captured from a config file', async () => {
    await using dir = await tempDir();
    await dir.write(
      'runset.config.mjs',
      `export default {
        commands: [
          { command: async () => { console.log('hello'); }, label: 'fn', parallel: true },
          { command: 'node -e "console.log(1)"', label: 'sh', parallel: true },
        ],
        color: 'none',
      };`,
    );

    const { stdout } = await run([], dir.path);
    expect(stdout).toContain('[fn] hello\n');
  });
});
