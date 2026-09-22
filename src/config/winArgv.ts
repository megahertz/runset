import { CliError } from '../utils/errors.ts';

/**
 * Windows only: rejoins `'single quoted'` tokens that `cmd.exe` leaves split,
 * joined by single spaces. The identity everywhere else.
 */
export function regroupQuoted(
  argv: string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') {
    return argv;
  }

  const result: string[] = [];
  let open: string[] | undefined;

  for (const token of argv) {
    if (open === undefined) {
      if (token.startsWith("'") && token.endsWith("'") && token.length > 1) {
        result.push(token.slice(1, -1));
      } else if (token.startsWith("'")) {
        open = [token.slice(1)];
      } else {
        result.push(token);
      }
      continue;
    }

    if (token.endsWith("'")) {
      open.push(token.slice(0, -1));
      result.push(open.join(' '));
      open = undefined;
    } else {
      open.push(token);
    }
  }

  if (open !== undefined) {
    throw new CliError(`Unterminated quote in "'${open.join(' ')}".`);
  }

  return result;
}
