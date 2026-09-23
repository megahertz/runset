import cp from 'node:child_process';
import type { Config } from '../config/Config.ts';
import type { Command, TerminateOptions } from '../types.ts';
import { paint } from '../utils/colors.ts';
import type { PackageInfo } from '../utils/fs.ts';
import { signalExitCode } from '../utils/os.ts';
import { createEnv } from './env.ts';
import type { FileRegistry } from './FileRegistry.ts';
import type { Logger } from './Logger.ts';
import { OutputSink } from './OutputSink.ts';
import { makePrefix } from './prefix.ts';

const USE_PROCESS_GROUPS = process.platform !== 'win32';

/** What every process in a run shares. */
export interface RunContext {
  config: Config;
  files: FileRegistry;
  logger: Logger;
  packageInfo: PackageInfo;
  /** Stops the whole run. */
  requestStop: () => void;
}

/** One command, running in one shell, restarted as its exit policy says. */
export class Process {
  /** `undefined` when killed by a signal. */
  exitCode: number | undefined;
  signal: NodeJS.Signals | undefined;
  started = false;
  /** True when runset stopped this command rather than letting it finish. */
  terminated = false;
  finished = false;

  readonly command: Command;

  private child: cp.ChildProcess | undefined;
  private readonly context: RunContext;
  private readonly stdout: OutputSink;
  private readonly stderr: OutputSink;

  constructor(command: Command, context: RunContext) {
    this.command = command;
    this.context = context;

    const { color, destinations, formatLabel } = context.config;
    const sink = (stream: 'stderr' | 'stdout') =>
      new OutputSink(
        command[stream],
        makePrefix(command, color, formatLabel, stream),
        destinations,
        context.files,
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

      if (this.context.config.showCommand) {
        const run = this.context.config.color ? paint('run', ['blue']) : 'run';
        this.stdout.writeLine(`${run} ${this.command.command}`);
      }

      // oxlint-disable-next-line no-await-in-loop
      await this.spawn();

      // Before the flush, so a grouped stream holds it with the output.
      if (this.context.config.showExitCode) {
        this.stdout.writeLine(this.exitLine());
      }
      this.stdout.flush();
      this.stderr.flush();

      this.context.logger.debug(
        `< ${this.command.line} ${this.describeExit()}`,
      );

      if (this.terminated) {
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
  }

  /** `<command> exited with code N`: green when clean, red otherwise. */
  private exitLine(): string {
    const text = `${this.command.command} ${this.describeExit()}`;
    if (!this.context.config.color) {
      return text;
    }

    const clean = this.exitCode === 0 && this.signal === undefined;
    return paint(text, [clean ? 'green' : 'red']);
  }

  /** `exited with code N`, `was killed by SIGTERM`, or `was stopped`. */
  describeExit(): string {
    if (this.signal !== undefined) {
      return `was killed by ${this.signal}`;
    }
    // A command runset stopped may still exit on its own terms.
    return this.exitCode === undefined
      ? 'was stopped'
      : `exited with code ${this.exitCode}`;
  }

  /** One attempt: resolves when the child is gone. */
  private async spawn(): Promise<void> {
    const { command, context } = this;
    this.exitCode = undefined;
    this.signal = undefined;
    context.logger.debug(`> ${command.line}`);

    await new Promise<void>((resolve) => {
      // `error` may be followed by `close`; the first one decides.
      let settled = false;

      const child = cp.spawn(command.line, {
        cwd: command.cwd,
        detached: USE_PROCESS_GROUPS,
        env: createEnv({
          base: { ...context.config.env, ...command.env },
          cwd: command.cwd,
          packageInfo: context.packageInfo,
          scriptName: command.scriptName,
        }),
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
