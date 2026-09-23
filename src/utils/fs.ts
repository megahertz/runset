import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** The sync counterpart of `import()`: CJS, JSON, and ESM/TS via `require(esm)`. */
export function importSync<T>(modulePath: string): T {
  // oxlint-disable-next-line import/no-dynamic-require
  return require(modulePath) as T;
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

/** A parsed JSON file, or `undefined` when there is none. */
export function readJson(
  filePath: string,
): Record<string, unknown> | undefined {
  return fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>)
    : undefined;
}

/** The nearest `package.json` at or above `cwd`. */
export function readPackageJson(cwd: string): PackageInfo {
  for (const dir of ancestors(cwd)) {
    const filePath = path.join(dir, 'package.json');
    const raw = readJson(filePath) as Partial<PackageInfo> | undefined;
    if (raw !== undefined) {
      return {
        filePath,
        name: raw.name ?? '',
        scripts: raw.scripts ?? {},
        version: raw.version ?? '',
      };
    }
  }

  return { filePath: '', name: '', scripts: {}, version: '' };
}

export interface PackageInfo {
  filePath: string;
  name: string;
  scripts: Record<string, string>;
  version: string;
}
