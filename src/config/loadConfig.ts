import fs from 'node:fs';
import path from 'node:path';
import type { ConfigJs, ConfigJsExport } from '../types.ts';
import { ConfigError } from '../utils/errors.ts';
import { importSync } from '../utils/fs.ts';

/**
 * Loads `runset.config.*` — the `explicitPath`, or the first one found walking
 * up from `cwd` — and unwraps a default export or a factory function.
 */
export function loadConfigJs({
  argv,
  cwd,
  env,
  explicitPath,
}: {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  explicitPath: string | undefined;
}): ConfigJs {
  const filePath =
    explicitPath === undefined
      ? findConfigFile(cwd)
      : path.resolve(cwd, explicitPath);

  if (filePath === undefined) {
    return {};
  }
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(`Config file not found: ${explicitPath}`);
  }

  return unwrapConfigJs(importSync<ConfigJsExport>(filePath), {
    argv,
    cwd,
    env,
  });
}

export function unwrapConfigJs(
  source: ConfigJsExport,
  context: { argv: string[]; cwd: string; env: NodeJS.ProcessEnv },
): ConfigJs {
  const unwrapped = (source as { default?: ConfigJsExport }).default ?? source;
  return typeof unwrapped === 'function' ? unwrapped(context) : unwrapped;
}

/** `dir` and every directory above it, up to the root. */
export function ancestors(dir: string): string[] {
  const dirs = [path.resolve(dir)];
  for (;;) {
    const current = dirs.at(-1) as string;
    const parent = path.dirname(current);
    if (parent === current) {
      return dirs;
    }
    dirs.push(parent);
  }
}

function findConfigFile(cwd: string): string | undefined {
  for (const dir of ancestors(cwd)) {
    for (const extension of ['ts', 'js', 'mjs', 'cjs', 'json']) {
      const candidate = path.join(dir, `runset.config.${extension}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}
