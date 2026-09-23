import path from 'node:path';
import type {
  CommandDefinition,
  ConfigJs,
  ConfigJsExport,
  Destinations,
  ExitAction,
  LabelFormatter,
  LabelMode,
  LogLevel,
  Std,
} from '../types.ts';
import { isCommandSettings } from '../types.ts';
import { ConfigError } from '../utils/errors.ts';
import { loadConfigJs, unwrapConfigJs } from './loadConfig.ts';
import { parseCli, type ParsedCli } from './parseCli.ts';
import { defaultStd, mergeStd } from './std.ts';
import {
  actionError,
  booleanError,
  check,
  envError,
  numberError,
  oneOfError,
  stdError,
} from './validate.ts';

const DEFAULT_KILL_TIMEOUT = 5000;
const LOG_LEVELS = new Set<LogLevel>(['error', 'warn', 'info', 'debug']);
const LABEL_MODES = new Set<LabelMode>(['none', 'auto', 'custom', 'all']);

const KNOWN_KEYS = new Set<keyof ConfigJs>([
  'color',
  'commandDictionary',
  'commands',
  'cwd',
  'dryRun',
  'env',
  'formatLabel',
  'jobs',
  'killTimeout',
  'labels',
  'logLevel',
  'onFailure',
  'onSuccess',
  'parallel',
  'stderr',
  'stdout',
]);

/** Parses, loads and validates; anything left out comes from the process. */
export function createConfig({
  cli = parseCli(process.argv.slice(2)),
  configJs,
  cwd = process.cwd(),
  destinations = process,
  env = process.env,
}: ConfigOptions = {}): Config {
  const config = new Config({ cli, configJs, cwd, destinations, env });
  config.validate();

  return config;
}

/** The resolved run-wide configuration: CLI flag → config file → default. */
export class Config {
  readonly commands: CommandDefinition[];
  readonly commandDictionary: Record<
    string,
    CommandDefinition | CommandDefinition[]
  >;
  /** Everything after `--`, for placeholders. */
  readonly args: string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;

  readonly jobs: number;
  readonly killTimeout: number;
  readonly onSuccess: ExitAction;
  readonly onFailure: ExitAction;
  readonly color: boolean;
  readonly parallel: boolean;
  readonly labels: LabelMode;
  readonly logLevel: LogLevel;
  readonly dryRun: boolean;
  readonly formatLabel: LabelFormatter | undefined;
  readonly stdout: Std;
  readonly stderr: Std;
  readonly destinations: Destinations;

  /** Printed by the run once it is built. */
  readonly warnings: string[] = [];

  constructor({
    cli,
    configJs,
    cwd,
    destinations,
    env,
  }: ResolvedConfigOptions) {
    const { options } = cli;

    this.cwd = path.resolve(cwd, options.cwd ?? '.');
    this.destinations = destinations;

    const context = { argv: cli.argv, cwd: this.cwd, env };
    const file =
      configJs === undefined
        ? loadConfigJs({ ...context, explicitPath: options.config })
        : unwrapConfigJs(configJs, context);

    for (const key of Object.keys(file)) {
      if (!KNOWN_KEYS.has(key as keyof ConfigJs)) {
        this.warnings.push(`Unknown config key "${key}" was ignored.`);
      }
    }

    if (file.cwd !== undefined && options.cwd === undefined) {
      this.cwd = path.resolve(cwd, file.cwd);
    }

    // Checked before the merge, which would flatten an array into an object.
    // Merged per variable: a flag outranks the file only for what it names.
    check(envError('env', file.env ?? {}), ConfigError);
    this.env = { ...env, ...file.env, ...options.env };

    this.commands = [...(file.commands ?? []), ...cli.commands].filter(Boolean);
    this.commandDictionary = file.commandDictionary ?? {};
    this.args = cli.positional;

    this.jobs = options.jobs ?? file.jobs ?? Number.POSITIVE_INFINITY;
    this.killTimeout =
      options.killTimeout ?? file.killTimeout ?? DEFAULT_KILL_TIMEOUT;
    this.parallel = file.parallel ?? false;
    this.labels = (options.labels as LabelMode) ?? file.labels ?? 'auto';
    this.onSuccess = (options.onSuccess ??
      file.onSuccess ??
      'continue') as ExitAction;
    this.onFailure = (options.onFailure ??
      file.onFailure ??
      'stop') as ExitAction;
    this.dryRun = options.dryRun ?? file.dryRun ?? false;
    this.logLevel = (options.logLevel as LogLevel) ?? file.logLevel ?? 'info';
    this.color = resolveColor(options.color ?? file.color, env, destinations);
    this.formatLabel = file.formatLabel;

    // A setting may name one axis and leave the other to what it layers onto.
    const std = (stream: 'stderr' | 'stdout'): Std =>
      mergeStd(
        mergeStd(defaultStd(stream), file[stream] ?? options.output),
        options[stream] ?? options.output,
      );
    this.stdout = std('stdout');
    this.stderr = std('stderr');
  }

  /** Throws on the first invalid value; types too, as config files are arbitrary JS. */
  validate(): void {
    const errors = [
      oneOfError('logLevel', this.logLevel, LOG_LEVELS),
      numberError('jobs', this.jobs, 1),
      numberError('killTimeout', this.killTimeout, 0),
      booleanError('color', this.color),
      booleanError('parallel', this.parallel),
      booleanError('dryRun', this.dryRun),
      oneOfError('labels', this.labels, LABEL_MODES),
      stdError('stdout', this.stdout),
      stdError('stderr', this.stderr),
      this.formatLabel !== undefined && typeof this.formatLabel !== 'function'
        ? 'formatLabel must be a function.'
        : undefined,
      typeof this.commandDictionary !== 'object' ||
      this.commandDictionary === null ||
      Array.isArray(this.commandDictionary)
        ? 'commandDictionary must be an object.'
        : undefined,
      actionError('onSuccess', this.onSuccess),
      actionError('onFailure', this.onFailure),
    ];

    check(
      errors.find((error) => error !== undefined),
      ConfigError,
    );
  }

  /** True when `commands` holds something to run, not just settings entries. */
  hasCommands(): boolean {
    return this.commands.some((command) =>
      typeof command === 'object' && command !== null
        ? !isCommandSettings(command)
        : Boolean(command),
    );
  }
}

export function isTerminal(stream: NodeJS.WritableStream): boolean {
  return (stream as NodeJS.WriteStream).isTTY === true;
}

/** Flag, then `NO_COLOR`/`FORCE_COLOR`, then whether both streams are TTYs. */
function resolveColor(
  flag: boolean | undefined,
  env: NodeJS.ProcessEnv,
  destinations: Destinations,
): boolean {
  if (flag !== undefined) {
    return flag;
  }
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false;
  }
  if (
    env.FORCE_COLOR !== undefined &&
    env.FORCE_COLOR !== '' &&
    env.FORCE_COLOR !== '0'
  ) {
    return true;
  }

  return isTerminal(destinations.stdout) && isTerminal(destinations.stderr);
}

interface ResolvedConfigOptions {
  /** Defaults to the process's own argv; a library caller passes `parseCli([])`. */
  cli: ParsedCli;
  /** Skips the config-file lookup; absent means "look for a file". */
  configJs?: ConfigJsExport;
  cwd: string;
  /** Where the run writes; read for color autodetection. */
  destinations: Destinations;
  env: NodeJS.ProcessEnv;
}

/** What a caller may pass; anything left out comes from the process. */
export type ConfigOptions = Partial<ResolvedConfigOptions>;
