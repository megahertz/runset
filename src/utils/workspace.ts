import fs from 'node:fs';
import path from 'node:path';
import {
  ancestors,
  type PackageInfo,
  readJson,
  readPackageJson,
} from './fs.ts';

/**
 * The packages of the workspace at or above `cwd`, from `pnpm-workspace.yaml`
 * or `package.json` `workspaces`, sorted by path; the root is not one of them.
 */
export function readWorkspacePackages(cwd: string): PackageInfo[] {
  for (const dir of ancestors(cwd)) {
    const patterns = readWorkspacePatterns(dir);
    if (patterns === undefined) {
      continue;
    }

    const include = patterns.filter((pattern) => !pattern.startsWith('!'));
    const exclude = patterns
      .filter((pattern) => pattern.startsWith('!'))
      .map((pattern) => pattern.slice(1));

    return fs
      .globSync(include, { cwd: dir, exclude: [...exclude, '**/node_modules'] })
      .map((match) => path.join(dir, match, 'package.json'))
      .filter((filePath) => fs.existsSync(filePath))
      .toSorted()
      .map((filePath) => readPackageJson(path.dirname(filePath)));
  }

  return [];
}

function readWorkspacePatterns(dir: string): string[] | undefined {
  const yamlPath = path.join(dir, 'pnpm-workspace.yaml');
  if (fs.existsSync(yamlPath)) {
    return parsePnpmPackages(fs.readFileSync(yamlPath, 'utf8'));
  }

  const { workspaces } = (readJson(path.join(dir, 'package.json')) ?? {}) as {
    workspaces?: { packages?: string[] } | string[];
  };

  return Array.isArray(workspaces) ? workspaces : workspaces?.packages;
}

/** The `packages:` list of a `pnpm-workspace.yaml`, read without a YAML parser. */
export function parsePnpmPackages(text: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s#.*$/, '').trimEnd();

    if (/^\S/.test(line)) {
      inPackages = /^packages\s*:/.test(line);
    } else if (inPackages && /^\s+-/.test(line)) {
      patterns.push(
        line.replace(/^\s+-\s*/, '').replaceAll(/^['"]|['"]$/g, ''),
      );
    }
  }

  return patterns;
}
