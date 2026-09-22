import { describe, expect, test } from 'vitest';
import { quoteForShell } from '../../utils/os.ts';

describe('[shellQuote] quoteForShell', () => {
  const posix = (value: string): string => quoteForShell(value, 'linux');
  const cmd = (value: string): string => quoteForShell(value, 'win32');

  test('sh: a plain value is single-quoted', () => {
    expect(posix('one')).toBe("'one'");
  });

  test('sh: the characters a shell would act on stay literal', () => {
    // Written with the `$` spliced in so the file itself has no `${…}` in it.
    const variable = `${'$'}{HOME}`;

    expect(posix('$(printf x)')).toBe("'$(printf x)'");
    expect(posix('`printf x`')).toBe("'`printf x`'");
    expect(posix(variable)).toBe(`'${variable}'`);
    expect(posix('a; rm -rf b')).toBe("'a; rm -rf b'");
    expect(posix(String.raw`back\slash`)).toBe(String.raw`'back\slash'`);
    expect(posix('two\nlines')).toBe("'two\nlines'");
  });

  test('sh: a single quote closes, escapes, and reopens', () => {
    expect(posix("it's")).toBe(String.raw`'it'\''s'`);
  });

  test('cmd: a plain value is double-quoted', () => {
    expect(cmd('one')).toBe('^"one^"');
  });

  test('cmd: the characters cmd.exe acts on are caret-escaped', () => {
    expect(cmd('%PATH%')).toBe('^"^%PATH^%^"');
    expect(cmd('a & b')).toBe('^"a ^& b^"');
    expect(cmd('a | b')).toBe('^"a ^| b^"');
    expect(cmd('a > b')).toBe('^"a ^> b^"');
  });

  test('cmd: a quote is escaped for the runtime and then for cmd', () => {
    expect(cmd('say "hi"')).toBe(String.raw`^"say \^"hi\^"^"`);
  });

  test('cmd: trailing backslashes double so they do not escape the quote', () => {
    expect(cmd('C:\\dir\\')).toBe(String.raw`^"C:\dir\\^"`);
  });

  test('cmd: a newline becomes a space — cmd.exe cannot carry one', () => {
    expect(cmd('two\nlines')).toBe('^"two lines^"');
  });
});
