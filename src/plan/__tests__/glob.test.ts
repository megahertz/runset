import { describe, expect, test } from 'vitest';
import { matchGlob } from '../../utils/glob.ts';

const SCRIPTS = [
  'build',
  'build:browser',
  'build:server',
  'build:server:esm',
  'lint',
  'watch:server',
];

describe('[glob] matchGlob', () => {
  test('"*" stays within one segment', () => {
    expect(matchGlob('build:*', SCRIPTS)).toEqual([
      'build:browser',
      'build:server',
    ]);
  });

  test('"**" spans one or more segments', () => {
    expect(matchGlob('build:**', SCRIPTS)).toEqual([
      'build:browser',
      'build:server',
      'build:server:esm',
    ]);
  });

  test('"**" requires at least one segment', () => {
    expect(matchGlob('build:**', ['build'])).toEqual([]);
  });

  test('a wildcard may sit inside a segment', () => {
    expect(matchGlob('build:ser*', SCRIPTS)).toEqual(['build:server']);
  });

  test('a wildcard may sit in the middle of a name', () => {
    expect(matchGlob('*:server', SCRIPTS)).toEqual([
      'build:server',
      'watch:server',
    ]);
  });

  test('a name with no wildcard matches only itself', () => {
    expect(matchGlob('build', SCRIPTS)).toEqual(['build']);
  });

  test('regex metacharacters in a name are literal', () => {
    expect(matchGlob('?test', ['?test', 'atest'])).toEqual(['?test']);
    expect(matchGlob('a.b', ['a.b', 'axb'])).toEqual(['a.b']);
  });

  test('an unmatched glob yields nothing rather than throwing', () => {
    expect(matchGlob('nope:*', SCRIPTS)).toEqual([]);
  });
});
