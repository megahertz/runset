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
  /** Run an npm script in every workspace package that has it. */
  recursive?: boolean;
  stderr?: Partial<Std> | string;
  stdout?: Partial<Std> | string;
}

/** One command written as an object; `command` is what makes it one. */
export type CommandEntry = { command: string } & CommandOptions;

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
  /** Wrap labelled lines to the terminal, labelling each piece. Default: `false`. */
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
