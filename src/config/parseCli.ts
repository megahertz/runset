import type { CommandDefinition } from '../types.ts';
import { CliError } from '../utils/errors.ts';
import { toCamelCase } from '../utils/string.ts';
import { regroupQuoted } from './winArgv.ts';

const FLAGS: FlagSpec[] = [
  { name: 'parallel', short: 'p', takesValue: false },
  { name: 'serial', short: 's', takesValue: false },
  { name: 'jobs', short: 'j', takesValue: true },
  { name: 'killTimeout', takesValue: true },
  { name: 'onSuccess', takesValue: true },
  { name: 'onFailure', takesValue: true },
  { name: 'config', short: 'c', takesValue: true },
  { name: 'cwd', takesValue: true },
  { name: 'env', short: 'e', takesValue: true },
  { name: 'color', takesValue: false },
  { name: 'logLevel', takesValue: true },
  { name: 'dryRun', takesValue: false },
  { name: 'stdout', takesValue: true },
  { name: 'stderr', takesValue: true },
  { name: 'output', short: 'o', takesValue: true },
  { name: 'labels', takesValue: true },
  { name: 'help', short: 'h', takesValue: false },
  { name: 'version', short: 'v', takesValue: false },
];

/**
 * Splits argv into options, commands, and the literal arguments after `--`.
 * Each `-p`/`-s` becomes a settings entry where it was typed, the same object
 * a config file would write.
 */
export function parseCli(rawArgv: string[]): ParsedCli {
  const argv = regroupQuoted(rawArgv);
  const options: CliOptions = {};
  const commands: CommandDefinition[] = [];
  const positional: string[] = [];
  let help = false;
  let version = false;
  let afterDoubleDash = false;
  let cursor = 0;

  function setOption(spec: FlagSpec, raw: boolean | string): void {
    switch (spec.name) {
      case 'env': {
        const text = String(raw);
        const eq = text.indexOf('=');
        if (eq < 1) {
          throw new CliError(`Option "--env" takes NAME=value, not "${text}".`);
        }
        (options.env ??= {})[text.slice(0, eq)] = text.slice(eq + 1);
        break;
      }
      case 'help': {
        help = true;
        break;
      }
      case 'jobs':
      case 'killTimeout': {
        options[spec.name] = Number(raw);
        break;
      }
      case 'parallel':
      case 'serial': {
        commands.push({ parallel: spec.name === 'parallel' });
        break;
      }
      case 'version': {
        version = true;
        break;
      }
      default: {
        if (typeof raw === 'boolean') {
          (options[spec.name] as boolean) = raw;
        } else {
          (options[spec.name] as string) = raw;
        }
      }
    }
  }

  function takeValue(label: string): string {
    const value = argv[cursor + 1];
    if (value === undefined) {
      throw new CliError(`Option "${label}" needs a value.`);
    }
    cursor += 1;
    return value;
  }

  function readLong(body: string): void {
    const eq = body.indexOf('=');
    const name = eq === -1 ? body : body.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);

    const flag = findLongFlag(name);

    if (flag === undefined && /^no-?[A-Za-z]/.test(name)) {
      const negated = findLongFlag(name.replace(/^no-?/, ''));
      if (negated && !negated.takesValue) {
        setOption(negated, false);
        return;
      }
    }

    if (flag === undefined) {
      throw new CliError(`Unknown option "--${name}".`);
    }

    if (flag.takesValue) {
      setOption(flag, inlineValue ?? takeValue(`--${name}`));
    } else {
      setOption(flag, true);
    }
  }

  function readShortCluster(body: string): void {
    for (let position = 0; position < body.length; position += 1) {
      const letter = body[position] as string;
      const flag = findShortFlag(letter);

      if (flag === undefined) {
        throw new CliError(`Unknown option "-${letter}".`);
      }
      if (!flag.takesValue) {
        setOption(flag, true);
        continue;
      }

      const rest = body.slice(position + 1);
      const value = rest === '' ? takeValue(`-${letter}`) : rest;

      setOption(flag, value);
      return;
    }
  }

  for (; cursor < argv.length; cursor += 1) {
    const token = argv[cursor] as string;

    if (afterDoubleDash) {
      positional.push(token);
    } else if (token === '--') {
      afterDoubleDash = true;
    } else if (token.startsWith('--') && token.length > 2) {
      readLong(token.slice(2));
    } else if (token.startsWith('-') && token.length > 1) {
      readShortCluster(token.slice(1));
    } else {
      commands.push(token);
    }
  }

  return {
    argv,
    commands,
    help,
    options,
    positional,
    version,
  };
}

function findLongFlag(name: string): FlagSpec | undefined {
  const camel = toCamelCase(name);
  return FLAGS.find((flag) => flag.name === camel);
}

function findShortFlag(letter: string): FlagSpec | undefined {
  return FLAGS.find((flag) => flag.short === letter);
}

/** Run-wide options a CLI flag can set. */
export interface CliOptions {
  color?: boolean;
  config?: string;
  cwd?: string;
  dryRun?: boolean;
  env?: Record<string, string>;
  jobs?: number;
  killTimeout?: number;
  labels?: string;
  logLevel?: string;
  onFailure?: string;
  onSuccess?: string;
  output?: string;
  stderr?: string;
  stdout?: string;
}

export interface ParsedCli {
  /** The argv this is the parse of. */
  argv: string[];
  /** The tasks as written, with a settings entry where a `-p`/`-s` stood. */
  commands: CommandDefinition[];
  help: boolean;
  options: CliOptions;
  positional: string[];
  version: boolean;
}

interface FlagSpec {
  name: 'help' | 'parallel' | 'serial' | 'version' | keyof CliOptions;
  short?: string;
  takesValue: boolean;
}
