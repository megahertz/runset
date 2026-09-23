import path from 'node:path';
import type { Config } from '../config/Config.ts';
import { mergeStd, toPartialStd } from '../config/std.ts';
import {
  actionError,
  booleanError,
  check,
  envError,
  stdError,
  stringError,
} from '../config/validate.ts';
import type {
  Command,
  CommandDefinition,
  CommandEntry,
  CommandOptions,
  CommandSettings,
} from '../types.ts';
import { isCommandSettings } from '../types.ts';
import { NormalizeError } from '../utils/errors.ts';
import type { PackageInfo } from '../utils/fs.ts';
import { isGlob, matchGlob } from '../utils/glob.ts';
import { toKebabCase } from '../utils/string.ts';
import { readWorkspacePackages } from '../utils/workspace.ts';
import { substitutePlaceholders } from './placeholders.ts';
import { BOUNDARY, EMPTY_SEGMENT, link, type Segment } from './stages.ts';
import { INLINE_OPTIONS, parseInlineOptions, splitToken } from './token.ts';
import type { Token } from './token.ts';

/** Keys a settings entry may set. */
const SETTINGS_OPTIONS = new Set([...INLINE_OPTIONS, 'env', 'serial']);

/**
 * Turns `config.commands` into the run's commands: flat, validated, numbered
 * by stage and sorted by it.
 */
export function normalize(config: Config, packageInfo: PackageInfo): Command[] {
  const scriptNames = Object.keys(packageInfo.scripts);
  let workspacePackages: PackageInfo[] | undefined;

  const defaults: Command = {
    bgColor: '',
    color: '',
    command: '',
    cwd: config.cwd,
    disabled: false,
    env: {},
    label: '',
    line: '',
    onFailure: config.onFailure,
    onSuccess: config.onSuccess,
    parallel: config.parallel,
    recursive: config.recursive,
    stage: 0,
    stderr: config.stderr,
    stdout: config.stdout,
    type: 'shell',
  };

  function makeLeaf(
    token: Token,
    rawOptions: CommandOptions,
    script: string | undefined,
    pkg = packageInfo,
  ): Command {
    const options = {
      ...rawOptions,
      stderr: mergeStd(defaults.stderr, rawOptions.stderr),
      stdout: mergeStd(defaults.stdout, rawOptions.stdout),
    };
    const args = substitutePlaceholders(token.args, config.args);
    const command = [token.name, args].filter((part) => part !== '').join(' ');

    // An npm command runs the script's body with the arguments appended.
    const line =
      script === undefined
        ? command
        : [pkg.scripts[script], args].filter((part) => part !== '').join(' ');

    const leaf: Command = {
      ...defaults,
      ...options,
      command,
      line,
      stage: 0,
      type: script === undefined ? 'shell' : 'npm',
      ...(script === undefined ? {} : { scriptName: script }),
      ...(pkg === packageInfo ? {} : { packageName: packageNameOf(pkg) }),
    };

    // Like `npm run`, a script runs from the package root unless given a cwd.
    if (script !== undefined && options.cwd === undefined) {
      leaf.cwd = pkg.filePath === '' ? config.cwd : path.dirname(pkg.filePath);
    }

    // Before `disabled` is read: `disabled: 'no'` is refused, not truthy.
    validateCommand(leaf);

    return leaf;
  }

  /** Links one token's commands (e.g. glob matches) by their own `parallel`. */
  function toSegment(leaves: Command[], settled: CommandOptions): Segment {
    return {
      commands: link(
        leaves
          .filter((leaf) => !leaf.disabled)
          .map((leaf) => ({ commands: [leaf], parallel: leaf.parallel })),
      ),
      parallel: settled.parallel ?? defaults.parallel,
    };
  }

  function resolveToken(
    raw: string,
    inherited: CommandOptions,
    overrides: CommandOptions,
    seen: Set<string>,
  ): Segment {
    const token = splitToken(raw);
    const inline = resolveCwd(
      parseInlineOptions(token.options, config.args),
      inherited.cwd ?? config.cwd,
    );

    if (Object.hasOwn(config.commandDictionary, token.name)) {
      if (seen.has(token.name)) {
        throw new NormalizeError(`Command "${token.name}" refers to itself.`);
      }

      // The token's `::options` outrank the entry's own.
      const resolved = resolveEntry(
        config.commandDictionary[token.name],
        inherited,
        layer(inline, overrides),
        new Set([...seen, token.name]),
      );

      return token.args === '' ? resolved : appendArgs(resolved, token);
    }

    const settled = layer(inherited, inline, overrides);

    if (settled.recursive ?? defaults.recursive) {
      // Every workspace package that has the script; none is not an error,
      // the token then resolves as it would without `recursive`.
      workspacePackages ??= readWorkspacePackages(config.cwd);
      const leaves = workspacePackages.flatMap((pkg) =>
        matchScripts(token.name, pkg).map((name) =>
          makeLeaf({ ...token, name }, settled, name, pkg),
        ),
      );

      if (leaves.length > 0) {
        return toSegment(leaves, settled);
      }
    }

    if (isGlob(token.name)) {
      return toSegment(
        matchGlob(token.name, scriptNames).map((name) =>
          makeLeaf({ ...token, name }, settled, name),
        ),
        settled,
      );
    }

    const script = Object.hasOwn(packageInfo.scripts, token.name)
      ? token.name
      : undefined;

    return toSegment([makeLeaf(token, settled, script)], settled);
  }

  function appendArgs(segment: Segment, token: Token): Segment {
    const [leaf] = segment.commands;

    if (segment.commands.length !== 1 || leaf === undefined) {
      throw new NormalizeError(
        `Cannot pass arguments to "${token.name}": it expands to more than one command.`,
      );
    }

    const args = substitutePlaceholders(token.args, config.args);
    const extended: Command = {
      ...leaf,
      command: `${leaf.command} ${args}`,
      line: `${leaf.line} ${args}`,
    };

    return { ...segment, commands: [extended] };
  }

  /** One list entry other than a settings entry. */
  function resolve(
    definition: CommandDefinition,
    inherited: CommandOptions,
    overrides: CommandOptions,
    seen: Set<string>,
  ): Segment {
    if (!definition) {
      return EMPTY_SEGMENT;
    }

    if (typeof definition === 'string') {
      return resolveToken(definition, inherited, overrides, seen);
    }

    if (Array.isArray(definition)) {
      throw new NormalizeError(
        'A list of commands belongs in "commands" or in a "commandDictionary" entry, not inside one.',
      );
    }

    if (isCommandSettings(definition)) {
      throw new NormalizeError('A command definition needs a "command" field.');
    }

    const entry = definition as CommandEntry;

    if (typeof entry.command !== 'string') {
      throw new NormalizeError('A command\'s "command" must be a string.');
    }

    const { command, ...raw } = entry;
    const options = resolveCwd(raw, inherited.cwd ?? config.cwd);

    return resolveToken(command, layer(inherited, options), overrides, seen);
  }

  /**
   * `commands`, or a dictionary entry that is a list. The list's own
   * `parallel` places the list as a whole and is not passed to its members.
   */
  function resolveList(
    definitions: CommandDefinition[],
    inherited: CommandOptions,
    overrides: CommandOptions,
    seen: Set<string>,
  ): Segment {
    const { parallel: inheritedParallel, ...passedDown } = inherited;
    const { parallel: overriddenParallel, ...passedOver } = overrides;
    const parallel =
      overriddenParallel ?? inheritedParallel ?? defaults.parallel;

    check(
      booleanError('"parallel" on a list of commands', parallel),
      NormalizeError,
    );

    const segments: Segment[] = [];
    // What settings entries so far have settled for the commands after them.
    let settled = passedDown;

    for (const definition of definitions) {
      if (isSettingsEntry(definition)) {
        const written = readSettings(definition, settled.cwd ?? config.cwd);
        settled = layer(settled, written);
        if (written.parallel !== undefined) {
          segments.push(BOUNDARY);
        }
        continue;
      }

      segments.push(resolve(definition, settled, passedOver, seen));
    }

    return { commands: link(segments), parallel };
  }

  function resolveEntry(
    entry: CommandDefinition | CommandDefinition[],
    inherited: CommandOptions,
    overrides: CommandOptions,
    seen: Set<string>,
  ): Segment {
    return Array.isArray(entry)
      ? resolveList(entry, inherited, overrides, seen)
      : resolve(entry, inherited, overrides, seen);
  }

  const { commands } = resolveList(config.commands, {}, {}, new Set<string>());

  // Parallel lists interleave stages (`a1 a2 b1 b2` → `1 2 1 2`); the sort is
  // stable, so a stage keeps its written order.
  commands.sort((first, second) => first.stage - second.stage);

  return commands;
}

/** The scripts of `pkg` a token name matches, glob or not. */
function matchScripts(name: string, pkg: PackageInfo): string[] {
  const scriptNames = Object.keys(pkg.scripts);
  if (isGlob(name)) {
    return matchGlob(name, scriptNames);
  }
  return Object.hasOwn(pkg.scripts, name) ? [name] : [];
}

function packageNameOf(pkg: PackageInfo): string {
  return pkg.name || path.basename(path.dirname(pkg.filePath));
}

function isSettingsEntry(
  definition: CommandDefinition,
): definition is CommandSettings {
  return (
    typeof definition === 'object' &&
    definition !== null &&
    !Array.isArray(definition) &&
    isCommandSettings(definition)
  );
}

/** Resolves a relative `cwd` against the inherited one, so directories nest. */
function resolveCwd(options: CommandOptions, base: string): CommandOptions {
  return options.cwd === undefined
    ? options
    : { ...options, cwd: path.resolve(base, options.cwd) };
}

/**
 * Reads a settings entry into the options the rest of its list inherits.
 * Keys are checked strictly: `{ paralel: true }` would otherwise do nothing.
 */
function readSettings(entry: CommandSettings, base: string): CommandOptions {
  const keys = Object.keys(entry);

  if (keys.length === 0) {
    throw new NormalizeError('A settings entry must set at least one option.');
  }

  for (const key of keys) {
    if (!SETTINGS_OPTIONS.has(key)) {
      throw new NormalizeError(
        `Unknown option "${toKebabCase(key)}" in a settings entry.`,
      );
    }
  }

  const { serial, ...options } = entry;

  if (serial !== undefined) {
    check(booleanError('"serial"', serial), NormalizeError);

    if (options.parallel !== undefined) {
      throw new NormalizeError(
        'A settings entry takes "parallel" or "serial", not both.',
      );
    }

    options.parallel = !serial;
  }

  return resolveCwd(options, base);
}

/** Layers option bags, later over earlier; stream settings merge per axis. */
function layer(...bags: CommandOptions[]): CommandOptions {
  const result: CommandOptions = {};

  for (const { output, stderr, stdout, ...rest } of bags) {
    Object.assign(result, rest);
    // `output` names both streams; a stream's own setting in the same bag
    // outranks it.
    for (const [key, own] of [
      ['stderr', stderr],
      ['stdout', stdout],
    ] as const) {
      for (const value of [output, own]) {
        if (value !== undefined) {
          result[key] = mergeStd(toPartialStd(result[key] ?? {}), value);
        }
      }
    }
  }

  return result;
}

/** Checks what a config file could have written by hand. */
function validateCommand(command: Command): void {
  const where = (key: string) =>
    `"${toKebabCase(key)}" on "${command.command}"`;
  const errors = [
    ...(['onFailure', 'onSuccess'] as const).map((key) =>
      actionError(where(key), command[key]),
    ),
    ...(['disabled', 'parallel', 'recursive'] as const).map((key) =>
      booleanError(where(key), command[key]),
    ),
    ...(['bgColor', 'color', 'cwd', 'label'] as const).map((key) =>
      stringError(where(key), command[key]),
    ),
    ...(['stderr', 'stdout'] as const).map((key) =>
      stdError(where(key), command[key]),
    ),
    envError(where('env'), command.env),
  ];

  check(
    errors.find((error) => error !== undefined),
    NormalizeError,
  );
}
