#!/usr/bin/env node

import { main } from './cli.ts';
import { Run } from './run/Run.ts';
import type { CommandDefinition, ConfigJs } from './types.ts';

export * from './run/Run.ts';
export * from './types.ts';
export * from './utils/errors.ts';

/** Runs commands, or a whole config object, and resolves once they are done. */
export async function runset(config: ConfigJs): Promise<Run>;
export async function runset(
  commands: CommandDefinition | CommandDefinition[],
  configJs?: ConfigJs,
): Promise<Run>;
export async function runset(
  first: CommandDefinition | CommandDefinition[] | ConfigJs,
  second?: ConfigJs,
): Promise<Run> {
  return Run.fromConfigJs(toConfigJs(first, second)).start();
}

export default runset;

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}

/** A lone object carrying `commands` is a config; anything else is commands. */
function toConfigJs(
  first: CommandDefinition | CommandDefinition[] | ConfigJs,
  second: ConfigJs | undefined,
): ConfigJs {
  if (second === undefined && isConfigObject(first)) {
    return first;
  }

  const commands = Array.isArray(first)
    ? (first as CommandDefinition[])
    : [first as CommandDefinition];

  return { ...second, commands };
}

function isConfigObject(
  value: CommandDefinition | CommandDefinition[] | ConfigJs,
): value is ConfigJs {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as ConfigJs).commands)
  );
}
