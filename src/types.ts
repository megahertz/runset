export type StdTiming = 'grouped' | 'realtime';

/** How a command stream is handled. */
export interface Std {
  /** `stdout`, `stderr`, `none`, or a file path. */
  destination: string;
  timing: StdTiming;
}

export type ExitAction = 'continue' | 'restart' | 'stop';

export const EXIT_ACTIONS = new Set<ExitAction>([
  'continue',
  'restart',
  'stop',
]);

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

/** Which commands get a label in front of their output: see `--labels`. */
export type LabelMode = 'all' | 'auto' | 'custom' | 'none';

/** A resolved command, one per process a run spawns. */
export interface Command {
  bgColor: string;
  color: string;
  command: string;
  cwd: string;
  disabled: boolean;
  env: NodeJS.ProcessEnv;
  label: string;
  /** What is handed to the shell: for an npm command, the script's body. */
  line: string;
  onFailure: ExitAction;
  onSuccess: ExitAction;
  parallel: boolean;
  /** The `package.json` script name, when `type` is `'npm'`. */
  scriptName?: string;
  /** Commands sharing a stage run together; stages run in order. */
  stage: number;
  stderr: Std;
  stdout: Std;
  type: 'npm' | 'shell';
}

export type LabelFormatter = (context: {
  /** Whether runset is emitting ANSI color at all. */
  color: boolean;
  /** Its `label` is already padded. */
  command: Command;
  /** runset's own prefix, to decorate rather than replace. */
  defaultPrefix: string;
  stream: 'stderr' | 'stdout';
}) => string;

/** The parts of a {@link Command} a user may set by hand. */
export type CommandOptions = {
  stderr?: Partial<Std> | string;
  stdout?: Partial<Std> | string;
} & Partial<
  Omit<Command, 'line' | 'scriptName' | 'stage' | 'stderr' | 'stdout' | 'type'>
>;

/** One command written as an object; `command` is what makes it one. */
export type CommandEntry = { command: string } & CommandOptions;

/**
 * Defaults for the entries after it — the config spelling of `-p`/`-s`:
 * `commands: ['clean', { parallel: true }, 'lint', 'test']`.
 */
export type CommandSettings = { serial?: boolean } & Omit<
  CommandOptions,
  'command'
>;

/** A command before normalization; falsy entries are skipped. */
export type CommandDefinition =
  | CommandEntry
  | CommandSettings
  | false
  | null
  | string
  | undefined;

/** What a user writes in `runset.config.*`, or hands to `runset({ … })`. */
export interface ConfigJs {
  color?: boolean;
  /** Named commands, resolved before `package.json` scripts. An entry may be a list. */
  commandDictionary?: Record<string, CommandDefinition | CommandDefinition[]>;
  commands?: CommandDefinition[];
  cwd?: string;
  dryRun?: boolean;
  env?: Record<string, string>;
  /**
   * Renders the prefix of each labelled output line.
   *
   * ```js
   * formatLabel: ({ defaultPrefix }) => `${new Date().toISOString()} ${defaultPrefix}`,
   * ```
   */
  formatLabel?: LabelFormatter;
  /** Max commands running at once. Default: unlimited. */
  jobs?: number;
  /** Milliseconds from SIGTERM/SIGINT to SIGKILL; `0` for none. Default: 5000. */
  killTimeout?: number;
  /** Default: `'auto'`. */
  labels?: LabelMode;
  logLevel?: LogLevel;
  /** What a non-zero exit does to the run. Default: `'stop'`. */
  onFailure?: ExitAction;
  /** What a clean exit does to the run. Default: `'continue'`. */
  onSuccess?: ExitAction;
  /** The default `parallel` for every command. Default: `false`. */
  parallel?: boolean;
  stderr?: Partial<Std> | string;
  stdout?: Partial<Std> | string;
}

/** A config module may export the object itself or a sync factory for it. */
export type ConfigJsExport =
  | ((context: {
      argv: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
    }) => ConfigJs)
  | ConfigJs;

export interface TerminateOptions {
  /** Send SIGKILL. */
  force?: boolean;
  /** Default: SIGTERM. Ignored under `force`. */
  signal?: NodeJS.Signals;
}

/** Where a run writes. */
export interface Destinations {
  stderr: NodeJS.WritableStream;
  stdout: NodeJS.WritableStream;
}

/** True for an object written without a `command` — a settings entry. */
export function isCommandSettings(
  definition: CommandEntry | CommandSettings,
): definition is CommandSettings {
  return !('command' in definition);
}

export function isStreamDestination(
  destination: string,
): destination is 'stderr' | 'stdout' {
  return destination === 'stdout' || destination === 'stderr';
}
