import { describe, expect, test } from 'vitest';
import { parsePnpmPackages } from '../../utils/workspace.ts';

describe('[workspace] parsePnpmPackages', () => {
  test('reads the packages list, quotes and comments stripped', () => {
    const yaml = [
      'packages:',
      "  - 'packages/*' # all",
      '  - "!packages/private"',
      '  - apps/web',
      'catalog:',
      '  - not-a-package',
    ].join('\n');

    expect(parsePnpmPackages(yaml)).toEqual([
      'packages/*',
      '!packages/private',
      'apps/web',
    ]);
  });
});
