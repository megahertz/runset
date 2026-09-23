/* oxlint-disable max-classes-per-file -- the error hierarchy reads best in one place */

/** Any failure runset reports itself; `exitCode` is what the CLI exits with. */
export class RunsetError extends Error {
  readonly exitCode: number;
  /** What the CLI prints in place of `message`, when it has more to show. */
  readonly report: string | undefined;

  constructor(message: string, exitCode = 1, report?: string) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
    this.report = report;
  }
}

/** A command line runset cannot read. */
export class CliError extends RunsetError {}

/** A run-wide option or config file runset cannot use. */
export class ConfigError extends RunsetError {}

/** A command that cannot be resolved. */
export class NormalizeError extends RunsetError {}
