import fs from 'node:fs';
import path from 'node:path';
import type { ConfigJs, ConfigJsExport } from '../types.ts';
import { ConfigError } from '../utils/errors.ts';
import { ancestors, importSync, readJson } from '../utils/fs.ts';
import { isPlainObject } from '../utils/object.ts';

/**
 * Loads `runset.config.*` — the `explicitPath`, or the first one found walking
 * up from `cwd`, where a `package.json` `runset` section counts as one too —
 * and unwraps a default export or a factory function.
 */
export function loadConfigJs(
  context: ConfigContext,
  explicitPath: string | undefined,
): ConfigJs {
  if (explicitPath === undefined) {
    return unwrapConfigJs(findConfigJs(context.cwd) ?? {}, context);
  }

  const filePath = path.resolve(context.cwd, explicitPath);
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(`Config file not found: ${explicitPath}`);
  }
  return unwrapConfigJs(importSync<ConfigJsExport>(filePath), context);
}

export function unwrapConfigJs(
  source: ConfigJsExport,
  context: ConfigContext,
): ConfigJs {
  const unwrapped = (source as { default?: ConfigJsExport }).default ?? source;
  return typeof unwrapped === 'function' ? unwrapped(context) : unwrapped;
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
  const runset = readJson(filePath)?.runset;
  if (runset === undefined) {
    return undefined;
  }
  if (!isPlainObject(runset)) {
    throw new ConfigError(`${filePath}: "runset" must be an object`);
  }
  return runset as ConfigJs;
}

/** What a config factory is called with. */
type ConfigContext = { argv: string[]; cwd: string; env: NodeJS.ProcessEnv };
