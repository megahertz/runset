import { describe, expect, test } from 'vitest';
import { terminalColumns, visibleWidth, wrapLine } from '../terminal.ts';

const RED = '\u001B[31m';
const BOLD = '\u001B[1m';
const RESET = '\u001B[0m';

describe('visibleWidth', () => {
  test('counts characters', () => {
    expect(visibleWidth('hello')).toBe(5);
  });

  test('ignores color escapes', () => {
    expect(visibleWidth(`${RED}hi${RESET}`)).toBe(2);
  });

  test('counts wide characters as two columns', () => {
    expect(visibleWidth('日本')).toBe(4);
    expect(visibleWidth('👍')).toBe(2);
    expect(visibleWidth('❤️')).toBe(2);
    expect(visibleWidth('🇺🇦')).toBe(2);
  });

  test('counts a combining mark as nothing', () => {
    expect(visibleWidth('é')).toBe(1);
  });
});

describe('wrapLine', () => {
  test('leaves a line that fits alone', () => {
    expect(wrapLine('.....', 5)).toEqual(['.....']);
  });

  test('breaks a long line at the width', () => {
    expect(wrapLine('..........', 4)).toEqual(['....', '....', '..']);
  });

  test('does not split a wide character across the break', () => {
    expect(wrapLine('a日本', 4)).toEqual(['a日', '本']);
  });

  test('resets a style at the break and re-applies it after', () => {
    expect(wrapLine(`${RED}${BOLD}abcdef${RESET}`, 3)).toEqual([
      `${RED}${BOLD}abc${RESET}`,
      `${RED}${BOLD}def${RESET}`,
    ]);
  });

  test('does not carry a style that was already reset', () => {
    expect(wrapLine(`${RED}ab${RESET}cdef`, 3)).toEqual([
      `${RED}ab${RESET}c`,
      'def',
    ]);
  });

  test('leaves progress lines and cursor movement alone', () => {
    expect(wrapLine('..........\r..', 4)).toEqual(['..........\r..']);
    expect(wrapLine('\u001B[2K..........', 4)).toEqual(['\u001B[2K..........']);
  });

  test('always makes progress, however narrow', () => {
    expect(wrapLine('日本', 1)).toEqual(['日', '本']);
  });

  test('does nothing with no room at all', () => {
    expect(wrapLine('....', 0)).toEqual(['....']);
  });
});

describe('terminalColumns', () => {
  test('a TTY reports its own width', () => {
    const tty = { columns: 120, isTTY: true } as unknown as NodeJS.WriteStream;
    expect(terminalColumns(tty)).toBe(120);
  });

  test('anything else has none', () => {
    expect(terminalColumns({} as NodeJS.WriteStream)).toBeUndefined();
  });
});
