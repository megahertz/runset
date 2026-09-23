import path from 'node:path';
import { ancestors } from '../config/loadConfig.ts';
import type { PackageInfo } from '../utils/fs.ts';

/**
 * The environment a command runs in: every `node_modules/.bin` up from `cwd`
 * on `PATH`, plus the `npm_*` variables scripts most often read.
 */
export function createEnv({
  base,
  cwd,
  packageInfo,
  scriptName,
}: {
  base: NodeJS.ProcessEnv;
  cwd: string;
  packageInfo: PackageInfo;
  scriptName?: string;
}): NodeJS.ProcessEnv {
  const PATH_KEY = process.platform === 'win32' ? 'Path' : 'PATH';
  const pathKey =
    Object.keys(base).find((key) => key.toUpperCase() === 'PATH') ?? PATH_KEY;
  const binDirs = ancestors(cwd).map((dir) =>
    path.join(dir, 'node_modules', '.bin'),
  );
  const own: Record<string, string> = {};
  if (packageInfo.name !== '') {
    own.npm_package_name = packageInfo.name;
  }
  if (packageInfo.version !== '') {
    own.npm_package_version = packageInfo.version;
  }
  if (scriptName !== undefined) {
    own.npm_lifecycle_event = scriptName;
    own.npm_lifecycle_script = packageInfo.scripts[scriptName] ?? '';
  }

  return {
    ...withoutSpellingsOf(base, Object.keys(own)),
    ...own,
    [pathKey]: [...binDirs, base[pathKey]].filter(Boolean).join(path.delimiter),
  };
}

/**
 * Windows names are case-insensitive, and of two spellings a child is given
 * the one that sorts first — an outer npm's `NPM_…` over ours — so on Windows
 * every other spelling of a name about to be set is dropped.
 */
function withoutSpellingsOf(
  env: NodeJS.ProcessEnv,
  names: string[],
): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') {
    return env;
  }

  const replaced = new Set(names.map((name) => name.toUpperCase()));
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !replaced.has(key.toUpperCase())),
  );
}
