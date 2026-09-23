import { type Config, createConfig } from '../config/Config.ts';
import { parseCli } from '../config/parseCli.ts';
import { describeRun } from '../plan/describe.ts';
import { createPlan, type Plan } from '../plan/plan.ts';
import type { ConfigJs, TerminateOptions } from '../types.ts';
import { paint } from '../utils/colors.ts';
import { RunsetError } from '../utils/errors.ts';
import { signalExitCode } from '../utils/os.ts';
import { isTerminal } from '../utils/terminal.ts';
import { FileRegistry } from './FileRegistry.ts';
import { Logger } from './Logger.ts';
import { defaultLabel } from './prefix.ts';
import { Process } from './Process.ts';
import { schedule } from './schedule.ts';

/** One run: the processes built from a plan, and what stops them. */
export class Run {
  /** @internal */
  readonly config: Config;
  /** @internal */
  readonly processes: Process[];

  private readonly logger: Logger;
  private readonly files: FileRegistry;
  private stopping: StopState | undefined;

  constructor({ commands, config, packageInfo }: Plan) {
    this.config = config;
    // A log that cannot be written stops the run, whatever `onFailure` says.
    this.files = new FileRegistry(config.cwd, () =>
      this.stopEverything({ reason: 'policy' }),
    );
    this.logger = new Logger(
      config.logLevel,
      config.destinations.stderr,
      config.color !== 'none',
    );

    const context = {
      config,
      files: this.files,
      logger: this.logger,
      packageInfo,
      requestStop: () => this.stopEverything({ reason: 'policy' }),
    };
    this.processes = commands.map((command) => new Process(command, context));
  }

  /** A library caller's config object, through the same pipeline as the CLI. */
  static fromConfigJs(configJs: ConfigJs): Run {
    const config = createConfig({ cli: parseCli([]), configJs });
    return new Run(createPlan({ config }));
  }

  isFailed(): boolean {
    return this.failed().length > 0;
  }

  getExitCode(): number {
    return this.failed()[0]?.getReportedExitCode() ?? 0;
  }

  /** The resolved run, and every option in force, as `--dry-run` prints it. */
  describe(): string {
    return describeRun(
      this.config,
      this.processes.map((process) => process.command),
    );
  }

  /** Rejects with a {@link RunsetError} when the run did not succeed. */
  async start(): Promise<Run> {
    for (const warning of this.config.warnings) {
      this.logger.warn(`runset: ${warning}`);
    }

    if (this.config.dryRun) {
      // To stdout, not the logger: the plan is the output, whatever the log level.
      this.config.destinations.stdout.write(`${this.describe()}\n`);
      return this;
    }

    const onSigint = this.onSignal('SIGINT');
    const onSigterm = this.onSignal('SIGTERM');
    // `on`, not `once`: a second signal skips the kill timeout.
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    try {
      await schedule(
        this.processes,
        () => this.stopping !== undefined,
        this.config.jobs,
      );
    } finally {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      this.clearKillTimer();
      await this.files.closeAll();
    }

    const failed = this.failed();
    const exitCode = this.getExitCode();
    const { stopping } = this;

    if (this.files.error) {
      throw new RunsetError(this.files.error.message, exitCode || 1);
    }

    if (stopping?.signal) {
      // An empty report: the CLI said so when the signal arrived.
      throw new RunsetError(
        `the run was stopped by ${stopping.signal}`,
        signalExitCode(stopping.signal),
        '',
      );
    }

    if (stopping?.reason === 'terminate') {
      throw new RunsetError(
        'the run was terminated',
        signalExitCode('SIGTERM'),
      );
    }

    if (failed.length > 0) {
      const tally = this.tally(failed);
      throw new RunsetError(
        `${tally}: ${failed.map((process) => describeFailure(process)).join(', ')}`,
        exitCode,
        this.failureReport(tally, failed),
      );
    }

    return this;
  }

  terminate(options: TerminateOptions = {}): void {
    this.stopEverything({ reason: 'terminate' }, options);
  }

  /** `1 of 5 commands failed, 2 stopped, 1 not started`. */
  private tally(failed: Process[]): string {
    const { processes } = this;
    const total = processes.length;
    const stopped = processes.filter(
      (process) => process.started && process.terminated,
    ).length;
    const notStarted = processes.filter((process) => !process.started).length;

    return [
      `${failed.length} of ${total} command${total === 1 ? '' : 's'} failed`,
      stopped > 0 && `${stopped} stopped`,
      notStarted > 0 && `${notStarted} not started`,
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** The tally, then a row per failure, labelled as its output was. */
  private failureReport(tally: string, failed: Process[]): string {
    const colored = this.config.color !== 'none';
    const red = (text: string): string => paint(text, ['red'], colored);

    const rows = failed.map((process) => {
      const { command } = process;
      // Not padded: there is no column to line up with here.
      const label = command.label.trim();
      const prefix =
        label === '' ? '' : defaultLabel({ ...command, label }, colored);
      return `  ${red('✖')} ${prefix}${command.command} ${red(process.describeExit())}`;
    });

    return [tally, ...rows].join('\n');
  }

  private failed(): Process[] {
    return this.processes.filter((process) => process.isFailed());
  }

  /** Says a signal arrived before any command's parting words, then stops. */
  private onSignal(signal: 'SIGINT' | 'SIGTERM'): () => void {
    return () => {
      const { stderr } = this.config.destinations;

      if (this.stopping !== undefined) {
        this.logger.warn(`runset: ${signal} again, killing what is left`);
        this.forceKill();
        return;
      }

      if (signal === 'SIGINT' && isTerminal(stderr)) {
        // Follow on from the `^C` the terminal has just echoed.
        stderr.write(' ');
      }

      this.logger.warn(`runset: ${signal} received, stopping the run`);

      // Passed on as itself: a command may handle only one of the two.
      this.stopEverything({ reason: 'signal', signal }, { signal });
    };
  }

  private stopEverything(
    state: StopState,
    options: TerminateOptions = {},
  ): void {
    // The first reason stands; a later one only hurries it along.
    this.stopping ??= state;
    for (const process of this.processes) {
      process.terminate(options);
    }

    if (this.stopping.killTimer !== undefined) {
      return;
    }

    const { killTimeout } = this.config;
    if (killTimeout <= 0) {
      this.forceKill();
      return;
    }

    const killTimer = setTimeout(() => this.forceKill(), killTimeout);
    // The children hold the run open; the timer need not.
    killTimer.unref();
    this.stopping.killTimer = killTimer;
  }

  private forceKill(): void {
    this.clearKillTimer();
    for (const process of this.processes) {
      process.terminate({ force: true });
    }
  }

  private clearKillTimer(): void {
    if (this.stopping === undefined) {
      return;
    }

    clearTimeout(this.stopping.killTimer);
    this.stopping.killTimer = undefined;
  }
}

/** `typecheck (api) exited with code 2`; the label only where it adds something. */
function describeFailure(process: Process): string {
  const { command } = process;
  const label = command.label.trim();
  const name =
    label === '' || label === command.command
      ? command.command
      : `${command.command} (${label})`;

  return `${name} ${process.describeExit()}`;
}

interface StopState {
  killTimer?: NodeJS.Timeout;
  /**
   * `policy` (an exit policy or an unwritable log) leaves the verdict to the
   * commands; `signal` and `terminate` override it.
   */
  reason: 'policy' | 'signal' | 'terminate';
  signal?: NodeJS.Signals;
}
