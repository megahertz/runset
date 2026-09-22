import os from 'node:os';

/** 128 + the signal's number, the way a shell reports it: 130, 143, … */
export function signalExitCode(signal: NodeJS.Signals): number {
  const numbers = os.constants.signals as Partial<Record<string, number>>;
  return 128 + (numbers[signal] ?? 15);
}

/**
 * Quotes a value so the platform's shell passes it on as literal text —
 * double quotes are not enough, since `$(…)` still runs inside them.
 */
export function quoteForShell(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? quoteForCmd(value) : quoteForPosix(value);
}

/** Single quotes are fully literal; each `'` inside closes, escapes, reopens. */
function quoteForPosix(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Quoted for the C runtime first, then every `cmd.exe` metacharacter
 * `^`-escaped (see <https://qntm.org/cmd>). Newlines cannot survive `cmd.exe`,
 * so they become spaces.
 */
function quoteForCmd(value: string): string {
  const crt = value
    .replaceAll('\r\n', ' ')
    .replaceAll(/[\n\r]/g, ' ')
    .replaceAll(/(\\*)"/g, String.raw`$1$1\"`)
    .replace(/(\\*)$/, '$1$1');

  return `"${crt}"`.replaceAll(/["%&()<>^|]/g, (character) => `^${character}`);
}
