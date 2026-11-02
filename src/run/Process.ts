import cp from 'node:child_process';
import { Writable } from 'node:stream';
import { inspect } from 'node:util';
import type { Config } from '../config/Config.ts';
import type {
  Command,
  StopFunction,
  TaskFunction,
  TerminateOptions,
} from '../types.ts';
import { paint } from '../utils/colors.ts';
import type { PackageInfo } from '../utils/fs.ts';
import { signalExitCode } from '../utils/os.ts';
import { formatDuration } from '../utils/string.ts';
import { type CaptureTarget, runCaptured } from './capture.ts';
import { createEnv } from './env.ts';
import type { FileRegistry } from './FileRegistry.ts';
import type { Logger } from './Logger.ts';
import { OutputSink } from './OutputSink.ts';
import { makePrefix, prefixWidth } from './prefix.ts';

const USE_PROCESS_GROUPS = process.platform !== 'win32';

/** What every process in a run shares. */
export interface RunContext {
  /** A function resolved with a stop function: a service is up. */
  addService: (process: Process) => void;
  config: Config;
  files: FileRegistry;
  logger: Logger;
  packageInfo: PackageInfo;
  /** Stops the whole run. */
  requestStop: () => void;
}

/**
 * One command, running in one shell or as a function, restarted as its exit
 * policy says.
 */
export class Process {
  /** `undefined` when killed by a signal. */
  exitCode: number | undefined;
  /** What a function rejected with. */
  error: unknown;
  signal: NodeJS.Signals | undefined;
  started = false;
  /** True when runset stopped this command rather than letting it finish. */
  terminated = false;
  finished = false;

  readonly command: Command;

  private child: cp.ChildProcess | undefined;
  /** A running function's abort switch. */
  private controller: AbortController | undefined;
  /** Settles on a forced stop: runset waits for nothing of this one. */
  private hurried = Promise.withResolvers<typeof GIVEN_UP>();
  /** A ready service's, until the run ends and calls it. */
  private stopService: StopFunction | undefined;
  /** When the current attempt was spawned, from `performance.now()`. */
  private attemptStart = 0;
  private readonly context: RunContext;
  private readonly stdout: OutputSink;
  private readonly stderr: OutputSink;

  constructor(command: Command, context: RunContext) {
    this.command = command;
    this.context = context;

    const { color, formatLabel } = context.config;
    const colored = color !== 'none';
    const sink = (stream: 'stderr' | 'stdout') =>
      new OutputSink(
        command[stream],
        makePrefix(command, colored, formatLabel, stream),
        context,
      );
    this.stdout = sink('stdout');
    this.stderr = sink('stderr');
  }

  /** Ran and did not end cleanly; a command runset killed doesn't count. */
  isFailed(): boolean {
    return (
      this.started &&
      !this.terminated &&
      (this.exitCode !== 0 || this.signal !== undefined)
    );
  }

  /** What runset reports for this command: a signal as 128 + its number. */
  getReportedExitCode(): number {
    return this.signal === undefined
      ? (this.exitCode ?? 0)
      : signalExitCode(this.signal);
  }

  /** Runs the command, again and again while its exit policy says `restart`. */
  async start(): Promise<void> {
    if (this.terminated) {
      return;
    }

    let stopTheRun = false;

    for (;;) {
      this.started = true;

      const { color, showCommand, showExitCode } = this.context.config;
      if (showCommand) {
        const run = paint('run', ['blue'], color !== 'none');
        this.stdout.writeLine(`${run} ${this.command.command}`);
      }

      const { fn } = this.command;
      // oxlint-disable-next-line no-await-in-loop
      await (fn === undefined ? this.spawn() : this.call(fn));

      // Before the flush, so a grouped stream holds it with the output.
      if (showExitCode) {
        this.stdout.writeLine(this.exitLine());
      }
      this.stdout.flush();
      this.stderr.flush();

      this.context.logger.debug(
        `< ${this.command.line} ${this.describeExit()}`,
      );

      // A ready service has not exited: no policy applies until it does.
      if (this.terminated || this.stopService !== undefined) {
        break;
      }

      const action = this.isFailed()
        ? this.command.onFailure
        : this.command.onSuccess;

      if (action !== 'restart') {
        stopTheRun = action === 'stop';
        break;
      }

      this.context.logger.info(`runset: restarting "${this.command.command}"`);
    }

    this.finished = true;

    // Only once finished, so this command isn't counted among those stopped.
    if (stopTheRun) {
      this.context.requestStop();
    }
  }

  terminate({
    force = false,
    signal = 'SIGTERM',
  }: TerminateOptions = {}): void {
    // A function can only be asked; forced, runset stops waiting for it, and
    // for a ready service's stop function too.
    if (force) {
      this.hurried.resolve(GIVEN_UP);
    }

    // An ended command keeps its own verdict.
    if (this.finished) {
      return;
    }

    this.terminated = true;

    const sent = force ? 'SIGKILL' : signal;
    if (this.child?.pid !== undefined) {
      this.context.logger.debug(`! ${sent} ${this.command.line}`);
    }

    this.kill(sent);
    this.controller?.abort();
  }

  /**
   * Calls a ready service's stop function, waiting up to `timeout` — or not
   * at all once forced. A stop that fails only warns.
   */
  async stop(timeout: number): Promise<void> {
    const stop = this.stopService;
    if (stop === undefined) {
      return;
    }
    this.stopService = undefined;
    // A force from before the stop phase is no reason to skip this one.
    this.hurried = Promise.withResolvers();

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeout);
    });

    try {
      const stopped = runCaptured(this.captureTarget(), stop);
      const result = await Promise.race([
        stopped,
        timedOut,
        this.hurried.promise,
      ]);
      if (result === 'timeout') {
        this.warn(`did not stop within ${timeout}ms`);
      }
    } catch (error) {
      this.warn(`failed to stop: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
      this.stdout.flush();
      this.stderr.flush();
    }
  }

  /**
   * `✓ 2.1s` when clean; `– stopped · 2.1s  typecheck` in yellow when runset
   * stopped it; otherwise `✗ code 1 · 2.1s  typecheck` in red. The command is
   * in gray, so it can be found without its label.
   */
  private exitLine(): string {
    const colored = this.context.config.color !== 'none';
    const duration = formatDuration(performance.now() - this.attemptStart);

    if (this.exitCode === 0 && this.signal === undefined && !this.terminated) {
      const ready = this.stopService === undefined ? '' : ' ready ·';
      return `${paint('✓', ['green'], colored)}${ready} ${duration}`;
    }

    // Whatever it died of, runset asked for it: not a failure of its own.
    const [status, tint] = this.terminated
      ? ['– stopped', 'yellow']
      : [`✗ ${this.shortExit()}`, 'red'];
    const command = paint(this.command.command, ['gray'], colored);
    return `${paint(status, [tint], colored)} · ${duration}  ${command}`;
  }

  /** `code N`, the signal's name, or `stopped`. */
  private shortExit(): string {
    if (this.error !== undefined) {
      return 'failed';
    }
    if (this.signal !== undefined) {
      return this.signal;
    }
    // A command runset stopped may still exit on its own terms.
    return this.exitCode === undefined ? 'stopped' : `code ${this.exitCode}`;
  }

  /** `exited with code N`, `was killed by SIGTERM`, or `was stopped`. */
  describeExit(): string {
    if (this.error !== undefined) {
      return `failed: ${errorMessage(this.error)}`;
    }
    if (this.signal !== undefined) {
      return `was killed by ${this.signal}`;
    }
    // A command runset stopped may still exit on its own terms.
    return this.exitCode === undefined
      ? 'was stopped'
      : `exited with code ${this.exitCode}`;
  }

  /**
   * Under `wrap`, `COLUMNS` narrowed by the label: a child writing to a pipe
   * has no width of its own, and this is what is left of the parent's for it.
   */
  private columnsEnv(): NodeJS.ProcessEnv {
    const columns = this.stdout.columns();
    if (columns === undefined) {
      return {};
    }

    const width = prefixWidth(
      this.command,
      this.context.config.color !== 'none',
    );
    return { COLUMNS: String(Math.max(1, columns - width)) };
  }

  /** The environment a command runs in. */
  private env(): NodeJS.ProcessEnv {
    const { command, context } = this;
    return createEnv({
      base: { ...context.config.env, ...command.env, ...this.columnsEnv() },
      cwd: command.cwd,
      packageInfo: context.packageInfo,
      scriptName: command.scriptName,
    });
  }

  private captureTarget(): CaptureTarget {
    return {
      stderr: (chunk) => this.stderr.write(chunk),
      stdout: (chunk) => this.stdout.write(chunk),
    };
  }

  /** `runset: db did not stop`, under the command's label or name. */
  private warn(message: string): void {
    const name = this.command.label.trim() || this.command.command;
    this.context.logger.warn(`runset: ${name} ${message}`);
  }

  /**
   * One attempt of a function: resolves when it settles, or once runset gives
   * up on it. Resolving with a function makes it a service that is ready.
   */
  private async call(fn: TaskFunction): Promise<void> {
    const { command, context } = this;
    this.exitCode = undefined;
    this.error = undefined;
    this.signal = undefined;
    this.attemptStart = performance.now();
    context.logger.debug(`> ${command.line}`);

    const controller = new AbortController();
    this.controller = controller;
    // Terminated between construction and the call.
    if (this.terminated) {
      controller.abort();
    }

    const target = this.captureTarget();
    const taskContext = {
      cwd: command.cwd,
      env: this.env(),
      signal: controller.signal,
      stderr: toWritable(target.stderr),
      stdout: toWritable(target.stdout),
    };

    const running = runCaptured(target, () => fn(taskContext));

    try {
      const result = await Promise.race([running, this.hurried.promise]);

      if (result === GIVEN_UP) {
        this.warn('did not stop');
        // Should it come up after all, it is stopped there and then.
        running
          .then(async (late) => {
            if (typeof late === 'function') {
              await late();
            }
          })
          .catch(() => {});
        return;
      }

      // Kept even when stopped meanwhile: it is up, and needs stopping.
      if (typeof result === 'function') {
        this.stopService = result;
        context.addService(this);
      }

      this.exitCode = this.terminated ? undefined : 0;
    } catch (error) {
      // Rejecting on the abort is how a function says it stopped.
      if (!this.terminated) {
        this.error = error;
        this.exitCode = 1;
        this.stderr.writeLine(inspect(error));
      }
    } finally {
      this.controller = undefined;
    }
  }

  /** One attempt: resolves when the child is gone. */
  private async spawn(): Promise<void> {
    const { command, context } = this;
    this.exitCode = undefined;
    this.signal = undefined;
    this.attemptStart = performance.now();
    context.logger.debug(`> ${command.line}`);

    await new Promise<void>((resolve) => {
      // `error` may be followed by `close`; the first one decides.
      let settled = false;

      const child = cp.spawn(command.line, {
        cwd: command.cwd,
        detached: USE_PROCESS_GROUPS,
        env: this.env(),
        shell: true,
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      this.child = child;
      child.stdout
        ?.setEncoding('utf8')
        .on('data', (chunk: string) => this.stdout.write(chunk));
      child.stderr
        ?.setEncoding('utf8')
        .on('data', (chunk: string) => this.stderr.write(chunk));

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.stderr.write(`${error.message}\n`);
        this.exitCode = 1;
        resolve();
      });

      child.on('close', (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        // A killed command's exit code is not its own verdict.
        this.exitCode =
          this.terminated || signal !== null ? undefined : (code ?? 0);
        this.signal = signal ?? undefined;
        resolve();
      });

      // Terminated between construction and spawn.
      if (this.terminated) {
        this.kill('SIGTERM');
      }
    });

    // Drop the handle so a later terminate can't signal a reused pid.
    this.child = undefined;
  }

  private kill(signal: NodeJS.Signals): void {
    const pid = this.child?.pid;
    if (pid === undefined) {
      return;
    }

    try {
      // The shell may have started processes of its own: kill the whole tree.
      if (USE_PROCESS_GROUPS) {
        process.kill(-pid, signal);
      } else {
        killTree(pid, signal);
      }
    } catch {
      // Already gone.
    }
  }
}

const GIVEN_UP = Symbol('given up');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A stream for `context.stdout`, writing into one of the command's sinks. */
function toWritable(write: (chunk: string) => void): Writable {
  return new Writable({
    decodeStrings: false,
    write(chunk: Buffer | string, _encoding, done) {
      write(String(chunk));
      done();
    },
  });
}

/**
 * Windows has no process groups, and `child.kill` would reach only `cmd.exe`;
 * `taskkill /T /F` ends the tree (always forcefully). Falls back to the shell.
 */
function killTree(pid: number, signal: NodeJS.Signals): void {
  const killed = cp.spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  if (killed.error !== undefined || killed.status !== 0) {
    process.kill(pid, signal);
  }
}
