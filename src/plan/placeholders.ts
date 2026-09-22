import { quoteForShell } from '../utils/os.ts';
import { toCamelCase } from '../utils/string.ts';

/**
 * Fills `{1}`, `{@}`, `{*}` and `{name}` from the arguments after `--`.
 *
 * In a command line values are shell-quoted and unknown names left as written
 * (`${HOME}`); in an option (`forOption`) values are raw and unknown names
 * are empty, so `disabled={noTest}` is false when nothing was passed.
 */
export function substitutePlaceholders(
  text: string,
  args: string[],
  forOption = false,
): string {
  const PLACEHOLDER = /\{([^\s{}]*)\}/g;
  const wrap = forOption ? (value: string) => value : quoteForShell;

  return text.replaceAll(PLACEHOLDER, (match: string, key: string) => {
    if (key === '@') {
      return args.map((arg) => wrap(arg)).join(' ');
    }

    if (key === '*') {
      return args.length === 0 ? '' : wrap(args.join(' '));
    }

    if (/^[1-9]\d*$/.test(key)) {
      const value = args[Number(key) - 1];
      return value === undefined ? '' : wrap(value);
    }

    const named = namedValue(key, args);
    if (named !== undefined) {
      return wrap(named);
    }

    return forOption ? '' : match;
  });
}

/**
 * The value of `--name=value` or `--name value` (camel or kebab); a bare
 * `--name` is `'true'`.
 */
function namedValue(key: string, args: string[]): string | undefined {
  for (const [index, token] of args.entries()) {
    if (!token.startsWith('--') || token.length === 2) {
      continue;
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (toCamelCase(name) !== key) {
      continue;
    }

    if (equals !== -1) {
      return token.slice(equals + 1);
    }

    const next = args[index + 1];
    return next !== undefined && !next.startsWith('-') ? next : 'true';
  }

  return undefined;
}
