import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createEnv } from '../env.ts';

describe('[env] createEnv', () => {
  const packageInfo = {
    filePath: path.resolve('/project/package.json'),
    name: 'project',
    scripts: { build: 'tsc' },
    version: '1.2.3',
  };

  /** The PATH a command would be started with, split into its entries. */
  function pathEntries(cwd: string, base: NodeJS.ProcessEnv): string[] {
    const env = createEnv({ base, cwd, packageInfo });
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
    return (env[key as string] ?? '').split(path.delimiter);
  }

  test('every node_modules/.bin from cwd up goes on PATH', () => {
    // This is what lets `runset oxlint` find a locally installed binary without
    // going through `npm run`.
    const entries = pathEntries(path.resolve('/project/packages/api'), {
      PATH: '/usr/bin',
    });

    expect(entries[0]).toBe(
      path.resolve('/project/packages/api/node_modules/.bin'),
    );
    expect(entries).toContain(path.resolve('/project/node_modules/.bin'));
    expect(entries.at(-1)).toBe('/usr/bin');
  });

  test('the closest one comes first', () => {
    const entries = pathEntries(path.resolve('/project/packages/api'), {
      PATH: '/usr/bin',
    });
    const inner = entries.indexOf(
      path.resolve('/project/packages/api/node_modules/.bin'),
    );
    const outer = entries.indexOf(path.resolve('/project/node_modules/.bin'));

    expect(inner).toBeLessThan(outer);
  });

  test('it writes back to the PATH key the environment already used', () => {
    // Windows spells it `Path`, and a second key of a different case would be
    // a PATH the child never reads.
    const env = createEnv({
      base: { Path: '/usr/bin' },
      cwd: path.resolve('/project'),
      packageInfo,
    });

    expect(env.Path).toMatch(/node_modules/);
    expect(env.PATH).toBeUndefined();
  });

  test('an npm command carries the lifecycle variables npm sets', () => {
    const env = createEnv({
      base: {},
      cwd: path.resolve('/project'),
      packageInfo,
      scriptName: 'build',
    });

    expect(env.npm_lifecycle_event).toBe('build');
    expect(env.npm_lifecycle_script).toBe('tsc');
    expect(env.npm_package_name).toBe('project');
    expect(env.npm_package_version).toBe('1.2.3');
  });

  test('a shell command gets the package variables but no lifecycle', () => {
    const env = createEnv({
      base: {},
      cwd: path.resolve('/project'),
      packageInfo,
    });

    expect(env.npm_package_name).toBe('project');
    expect(env.npm_lifecycle_event).toBeUndefined();
  });
});
