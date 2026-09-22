import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

export interface CliResult {
  code: number;
  stderr: string;
  stdout: string;
}

export interface CliOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Text to pipe into the child's stdin. */
  stdin?: string;
}

/** A single command, or the whole argv. `'lint'` is `['lint']`. */
export type CliArgs = string | string[];

/** Full options, or just the `cwd` — the only one most tests set. */
export type CliTarget = CliOptions | string;

function toArgv(args: CliArgs): string[] {
  return typeof args === 'string' ? [args] : args;
}

function toOptions(target: CliTarget): CliOptions {
  return typeof target === 'string' ? { cwd: target } : target;
}

/**
 * Runs `src/index.ts` in a child process and waits for it to exit.
 *
 * That is the CLI: the same file is the library entry, and runs `main` only
 * when it is the module node was given.
 *
 * Resolves with the exit code and the captured streams whatever the outcome —
 * use {@link run} or {@link runWithError} to assert the outcome instead.
 */
export function runCli(args: CliArgs, target: CliTarget): Promise<CliResult> {
  return runNode([CLI, ...toArgv(args)], target);
}

/**
 * Runs node itself on the arguments given, for the few tests that are about a
 * copy of the CLI somewhere else rather than the one in `src`.
 */
export function runNode(args: string[], target: CliTarget): Promise<CliResult> {
  const options = toOptions(target);

  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.stdin.end(options.stdin ?? '');

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), stderr, stdout });
    });
  });
}

/** Like {@link runCli}, but rejects when the CLI exits with a non-zero code. */
export async function run(
  args: CliArgs,
  target: CliTarget,
): Promise<CliResult> {
  const result = await runCli(args, target);
  if (result.code !== 0) {
    throw new Error(
      `runset exited with ${result.code}\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

/**
 * The counterpart of {@link run}: rejects when the CLI *succeeds*.
 *
 * Use it wherever a test is about a failure, so a run that unexpectedly works
 * reports what it printed instead of a bare `expected 0 not to be 0`.
 */
export async function runWithError(
  args: CliArgs,
  target: CliTarget,
): Promise<CliResult> {
  const result = await runCli(args, target);
  if (result.code === 0) {
    throw new Error(
      `runset was expected to fail but exited 0\n${result.stdout || result.stderr}`,
    );
  }
  return result;
}

/**
 * Starts the CLI, waits for `delay` ms, then kills it with the given signal —
 * or, given `after`, kills it as soon as its stdout shows that text, for a
 * test that must know the command is up before the signal lands.
 *
 * Used to check that runset takes its children down with it, and says so.
 */
export function runCliAndKill(
  args: CliArgs,
  target:
    | ({ after?: string; delay?: number; signal?: NodeJS.Signals } & CliOptions)
    | string,
): Promise<CliResult> {
  const options = toOptions(target) as {
    after?: string;
    delay?: number;
    signal?: NodeJS.Signals;
  } & CliOptions;

  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [CLI, ...toArgv(args)], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), stderr, stdout });
    });

    const kill = (): boolean => child.kill(options.signal ?? 'SIGINT');
    const { after } = options;
    if (after === undefined) {
      setTimeout(kill, options.delay ?? 300);
    } else {
      const onData = (): void => {
        if (stdout.includes(after)) {
          child.stdout.off('data', onData);
          kill();
        }
      };
      child.stdout.on('data', onData);
    }
  });
}

/**
 * Like {@link runCliAndKill}, but signals twice.
 *
 * The second one is the impatient Ctrl+C: it says runset should stop waiting
 * for a command that is not answering the first.
 */
export function runCliAndKillTwice(
  args: CliArgs,
  target: ({ delay?: number; signal?: NodeJS.Signals } & CliOptions) | string,
): Promise<CliResult> {
  const options = toOptions(target) as {
    delay?: number;
    signal?: NodeJS.Signals;
  } & CliOptions;
  const delayMs = options.delay ?? 300;

  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [CLI, ...toArgv(args)], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), stderr, stdout });
    });

    const send = (): boolean => child.kill(options.signal ?? 'SIGINT');
    setTimeout(send, delayMs);
    setTimeout(send, delayMs * 2);
  });
}

/** Waits for the given number of milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
