#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from './cli.ts';
import { Run } from './run/Run.ts';
import type { CommandDefinition, ConfigJs } from './types.ts';
import { isPlainObject } from './utils/object.ts';

export * from './run/Run.ts';
export * from './types.ts';
export * from './utils/errors.ts';

/** Runs commands, or a whole config object, and resolves once they are done. */
export async function runset(config: ConfigJs): Promise<Run>;
export async function runset(
  commands: CommandDefinition | CommandDefinition[],
  configJs?: ConfigJs | string,
): Promise<Run>;
export async function runset(
  first: CommandDefinition | CommandDefinition[] | ConfigJs,
  second?: ConfigJs | string,
): Promise<Run> {
  return Run.fromConfigJs(toConfigJs(first, second)).start();
}

export default runset;

if (import.meta.main || isEntryPoint()) {
  // No top-level await: it would block require() of this module
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      setTimeout(() => {
        console.error('runset: forced exit, a handle kept the process alive');
        process.exit();
      }, 500).unref();
    });
}

/**
 * A lone object carrying `commands` is a config; anything else is commands.
 * A string second argument is shorthand for `{ cwd }`.
 */
function toConfigJs(
  first: CommandDefinition | CommandDefinition[] | ConfigJs,
  second: ConfigJs | string | undefined,
): ConfigJs {
  if (second === undefined && isConfigObject(first)) {
    return first;
  }

  const commands = Array.isArray(first)
    ? (first as CommandDefinition[])
    : [first as CommandDefinition];

  const configJs = typeof second === 'string' ? { cwd: second } : second;
  return { ...configJs, commands };
}

function isConfigObject(
  value: CommandDefinition | CommandDefinition[] | ConfigJs,
): value is ConfigJs {
  return isPlainObject(value) && Array.isArray(value.commands);
}

/**
 * Node 24.2 reports `import.meta.main` as false for a `.ts` entry point, which
 * is how the tests run this file; 24.3 fixed it. The module URL is a real
 * path, so the argument is resolved to one too — macOS's temp dir is a link.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  try {
    return (
      entry !== undefined &&
      fs.realpathSync(entry) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
}
