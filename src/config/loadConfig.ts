import fs from 'node:fs';
import path from 'node:path';
import type { ConfigJs, ConfigJsExport } from '../types.ts';
import { ConfigError } from '../utils/errors.ts';
import { importSync } from '../utils/fs.ts';

/**
 * Loads `runset.config.*` — the `explicitPath`, or the first one found walking
 * up from `cwd`, where a `package.json` `runset` section counts as one too —
 * and unwraps a default export or a factory function.
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
  const context = { argv, cwd, env };
  if (explicitPath === undefined) {
    return unwrapConfigJs(findConfigJs(cwd) ?? {}, context);
  }

  const filePath = path.resolve(cwd, explicitPath);
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(`Config file not found: ${explicitPath}`);
  }
  return unwrapConfigJs(importSync<ConfigJsExport>(filePath), context);
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

/**
 * The nearest config walking up from `cwd`. Within one directory a
 * `runset.config.*` file wins over the `package.json` `runset` section.
 */
function findConfigJs(cwd: string): ConfigJsExport | undefined {
  for (const dir of ancestors(cwd)) {
    for (const extension of ['ts', 'js', 'mjs', 'cjs', 'json']) {
      const candidate = path.join(dir, `runset.config.${extension}`);
      if (fs.existsSync(candidate)) {
        return importSync<ConfigJsExport>(candidate);
      }
    }

    const section = readPackageJsonSection(path.join(dir, 'package.json'));
    if (section !== undefined) {
      return section;
    }
  }
  return undefined;
}

function readPackageJsonSection(filePath: string): ConfigJs | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const { runset } = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    runset?: unknown;
  };
  if (runset === undefined) {
    return undefined;
  }
  if (runset === null || typeof runset !== 'object' || Array.isArray(runset)) {
    throw new ConfigError(`${filePath}: "runset" must be an object`);
  }
  return runset as ConfigJs;
}
