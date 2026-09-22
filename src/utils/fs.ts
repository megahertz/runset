import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ancestors } from '../config/loadConfig.ts';

const require = createRequire(import.meta.url);

/** The sync counterpart of `import()`: CJS, JSON, and ESM/TS via `require(esm)`. */
export function importSync<T>(modulePath: string): T {
  // oxlint-disable-next-line import/no-dynamic-require
  return require(modulePath) as T;
}

/** The nearest `package.json` at or above `cwd`. */
export function readPackageJson(cwd: string): PackageInfo {
  for (const dir of ancestors(cwd)) {
    const filePath = path.join(dir, 'package.json');
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const raw = JSON.parse(
      fs.readFileSync(filePath, 'utf8'),
    ) as Partial<PackageInfo>;
    return {
      filePath,
      name: raw.name ?? '',
      scripts: raw.scripts ?? {},
      version: raw.version ?? '',
    };
  }

  return { filePath: '', name: '', scripts: {}, version: '' };
}

export interface PackageInfo {
  filePath: string;
  name: string;
  scripts: Record<string, string>;
  version: string;
}
