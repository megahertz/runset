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
  const env: NodeJS.ProcessEnv = {
    ...base,
    [pathKey]: [...binDirs, base[pathKey]].filter(Boolean).join(path.delimiter),
  };

  if (packageInfo.name !== '') {
    env.npm_package_name = packageInfo.name;
  }
  if (packageInfo.version !== '') {
    env.npm_package_version = packageInfo.version;
  }

  if (scriptName !== undefined) {
    env.npm_lifecycle_event = scriptName;
    env.npm_lifecycle_script = packageInfo.scripts[scriptName] ?? '';
  }

  return env;
}
