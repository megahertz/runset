import { describe, expect, test } from 'vitest';
import { CliError } from '../../utils/errors.ts';
import { regroupQuoted } from '../winArgv.ts';

describe('[winArgv] regroupQuoted', () => {
  test('a non-win32 platform is left alone — the shell already stripped the quotes', () => {
    expect(regroupQuoted(["'npx", "howfat'"], 'linux')).toEqual([
      "'npx",
      "howfat'",
    ]);
  });

  test('win32: a split single-quoted pair regroups into one token', () => {
    expect(regroupQuoted(["'npx", "howfat'"], 'win32')).toEqual(['npx howfat']);
  });

  test('win32: a self-contained quoted token is just unquoted in place', () => {
    expect(regroupQuoted(["'one'"], 'win32')).toEqual(['one']);
  });

  test('win32: a token with no quotes is untouched', () => {
    expect(regroupQuoted(['plain', "'a'", 'plain2'], 'win32')).toEqual([
      'plain',
      'a',
      'plain2',
    ]);
  });

  test('win32: interior whitespace collapses to a single space between tokens', () => {
    // Whatever whitespace cmd.exe originally split on, folding the group back
    // together joins with exactly one space — this is for regrouping a
    // command, not for reproducing the user's exact spacing.
    expect(regroupQuoted(["'npx", 'run', "howfat'"], 'win32')).toEqual([
      'npx run howfat',
    ]);
  });

  test('win32: a group of three or more tokens joins in order', () => {
    expect(regroupQuoted(["'one", 'two', 'three', "four'"], 'win32')).toEqual([
      'one two three four',
    ]);
  });

  test('win32: an unterminated quote throws, naming the token', () => {
    expect(() => regroupQuoted(["'npx", 'howfat'], 'win32')).toThrow(CliError);
    expect(() => regroupQuoted(["'npx", 'howfat'], 'win32')).toThrow(
      /unterminated quote.*'npx howfat/i,
    );
  });

  test('win32: an empty argv stays empty', () => {
    expect(regroupQuoted([], 'win32')).toEqual([]);
  });
});
