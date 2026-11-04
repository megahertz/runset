export type StdTiming = 'grouped' | 'realtime';

/** How a command stream is handled. */
export interface Std {
  /** `stdout`, `stderr`, `none`, or a file path. */
  destination: string;
  timing: StdTiming;
}

export type ExitAction = 'continue' | 'restart' | 'stop';

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

/**
 * How much color runset uses: `basic` is the terminal's 16 theme colors,
 * `soft` the light 256-color shades, and `all` those plus the deep ones.
 * `auto` is `basic` or `soft`, whichever the terminal shows, or `none`.
 */
export type ColorMode = 'all' | 'auto' | 'basic' | 'none' | 'soft';

/** Which commands get a label in front of their output: see `--labels`. */
export type LabelMode = 'all' | 'auto' | 'custom' | 'none';

/** A resolved command, one per process a run spawns. */
export interface Command {
  bgColor: string;
  color: string;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** What a `function` command calls. */
  fn?: TaskFunction;
  label: string;
  /** What is handed to the shell: for an npm command, the script's body. */
  line: string;
  onFailure: ExitAction;
  onSuccess: ExitAction;
  /** The workspace package a `recursive` command was expanded into. */
  packageName?: string;
  /** The `package.json` script name, when `type` is `'npm'`. */
  scriptName?: string;
  /** Commands sharing a stage run together; stages run in order. */
  stage: number;
  stderr: Std;
  stdout: Std;
  type: 'function' | 'npm' | 'shell';
}

/** What a command written as a function is handed. */
export interface TaskContext {
  /** The command's resolved directory; the process's own is left alone. */
  cwd: string;
  /** The command's environment; `process.env` is left alone. */
  env: NodeJS.ProcessEnv;
  /** Aborted when runset stops the command. */
  signal: AbortSignal;
  /** Prefixed and routed like a child's; `console.error` lands here too. */
  stderr: NodeJS.WritableStream;
  /** Prefixed and routed like a child's; `console.log` lands here too. */
  stdout: NodeJS.WritableStream;
}

/** Ends a service once the run is over. */
export type StopFunction = () => Promise<void> | void;

/**
 * A command written as a function. Resolving with nothing is a task that has
 * finished; resolving with a function is a service that is ready — the next
 * stage starts — and the function is how runset stops it when the run ends.
 */
export type TaskFunction = (
  context: TaskContext,
  // oxlint-disable-next-line no-invalid-void-type -- what `async () => {}` returns
) => Promise<StopFunction | void> | StopFunction | void;

/** Renames an automatic label; `undefined` keeps it. */
export type LabelTransformer = (context: {
  command: Command;
  /** runset's automatic name: package, script or program. */
  label: string;
}) => string | undefined;

/** Decorates a line prefix; rename with `transformLabel` instead. */
export type PrefixDecorator = (context: {
  /** Whether runset is emitting ANSI color at all. */
  color: boolean;
  /** Its `label` is already padded. */
  command: Command;
  /** runset's own prefix: colored label + space, or `[label] ` without color. */
  defaultPrefix: string;
  /** The padded label + space, no color or brackets. */
  plainPrefix: string;
  stream: 'stderr' | 'stdout';
}) => string;

/** What a user may set about a command, by hand. */
export interface CommandOptions {
  bgColor?: string;
  color?: string;
  cwd?: string;
  /** Leave the command out of the run. */
  disabled?: boolean;
  env?: NodeJS.ProcessEnv;
  label?: string;
  onFailure?: ExitAction;
  onSuccess?: ExitAction;
  /** Both streams at once; `stdout` / `stderr` in the same place outrank it. */
  output?: Partial<Std> | string;
  /** Join the group of commands beside it rather than open a stage of its own. */
  parallel?: boolean;
  /**
   * Run an npm script in every workspace package that has it; a function runs
   * once per package, but only when its own entry says so.
   */
  recursive?: boolean;
  stderr?: Partial<Std> | string;
  stdout?: Partial<Std> | string;
}

/** One command written as an object; `command` is what makes it one. */
export type CommandEntry = { command: string | TaskFunction } & CommandOptions;

/**
 * Defaults for the entries after it — the config spelling of `-p`/`-s`:
 * `commands: ['clean', { parallel: true }, 'lint', 'test']`.
 */
export type CommandSettings = { serial?: boolean } & CommandOptions;

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
  /** Default: `'auto'`. */
  color?: ColorMode;
  commands?: CommandDefinition[];
  cwd?: string;
  /** Decorates each labelled line's prefix; asked once per line. */
  decoratePrefix?: PrefixDecorator;
  dryRun?: boolean;
  env?: Record<string, string>;
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
  /** Both streams at once; `stdout` / `stderr` outrank it. */
  output?: Partial<Std> | string;
  /** The default `parallel` for every command. Default: `false`. */
  parallel?: boolean;
  /** The default `recursive` for every command. Default: `false`. */
  recursive?: boolean;
  /** Named commands, resolved before `package.json` scripts. An entry may be a list. */
  scripts?: Record<string, CommandDefinition | CommandDefinition[]>;
  /** Print each command before it starts. Default: `false`. */
  showCommand?: boolean;
  /** Print how each command exited, green or red. Default: `false`. */
  showExitCode?: boolean;
  stderr?: Partial<Std> | string;
  stdout?: Partial<Std> | string;
  /** Renames automatic labels; an explicit `label` wins. */
  transformLabel?: LabelTransformer;
  /** Wrap labelled lines to the terminal, labelling each piece. Default: `true`. */
  wrap?: boolean;
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
