import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { readPackageJson } from '../../utils/fs.ts';

describe('[packageJson] readPackageJson', () => {
  test('walks up until it finds one', () => {
    const info = readPackageJson(fileURLToPath(new URL('.', import.meta.url)));

    expect(info.name).toBe('runset');
    expect(info.scripts.test).toBeDefined();
  });

  test('a directory with no package.json above it reads as empty', () => {
    const info = readPackageJson(path.parse(process.cwd()).root);

    expect(info.name).toBe('');
    expect(info.scripts).toEqual({});
  });
});
