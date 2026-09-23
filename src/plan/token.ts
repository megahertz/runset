import { parsePartialStd } from '../config/std.ts';
import { actionError, check } from '../config/validate.ts';
import type { CommandOptions, ExitAction } from '../types.ts';
import { NormalizeError } from '../utils/errors.ts';
import { toCamelCase, toKebabCase } from '../utils/string.ts';
import { substitutePlaceholders } from './placeholders.ts';

export const BOOLEAN_OPTIONS = ['disabled', 'parallel', 'recursive'] as const;
export const ACTION_OPTIONS = ['onFailure', 'onSuccess'] as const;

/** Keys a `::` suffix may set. */
export const INLINE_OPTIONS = new Set([
  'bgColor',
  'color',
  'cwd',
  'label',
  'output',
  'stderr',
  'stdout',
  ...BOOLEAN_OPTIONS,
  ...ACTION_OPTIONS,
]);

/**
 * Splits `"name args::options"` at the last `::`. The options run to the end
 * of the string, so a trailing space stays part of the last value.
 */
export function splitToken(raw: string): Token {
  const trimmed = raw.trimStart();
  const marker = trimmed.lastIndexOf('::');
  const command = (marker === -1 ? trimmed : trimmed.slice(0, marker)).trim();
  const space = command.search(/\s/);

  return {
    args: space === -1 ? '' : command.slice(space + 1).trim(),
    name: space === -1 ? command : command.slice(0, space),
    options: marker === -1 ? '' : trimmed.slice(marker + 2),
  };
}

/**
 * Parses `key=value,flag`. Split before placeholders are filled, so a `,` or
 * `=` arriving in a value cannot inject another option.
 */
export function parseInlineOptions(
  text: string,
  args: string[],
): CommandOptions {
  const options: Record<string, unknown> = {};

  for (const entry of text.split(',')) {
    if (entry.trim() === '') {
      continue;
    }

    const eq = entry.indexOf('=');
    const key = toCamelCase((eq === -1 ? entry : entry.slice(0, eq)).trim());
    const written = eq === -1 ? 'true' : entry.slice(eq + 1);
    // Only a label keeps its spaces; every other value is a keyword.
    const value = substitutePlaceholders(
      key === 'label' ? written : written.trim(),
      args,
      true,
    );

    if (!INLINE_OPTIONS.has(key)) {
      throw new NormalizeError(
        `Unknown command option "${toKebabCase(key)}" in "::${text.trim()}".`,
      );
    }

    if (key === 'output' || key === 'stderr' || key === 'stdout') {
      options[key] = parsePartialStd(value);
    } else if ((BOOLEAN_OPTIONS as readonly string[]).includes(key)) {
      // Empty is a placeholder with no argument behind it: `disabled={noTest}`.
      options[key] = value !== 'false' && value !== '';
    } else if ((ACTION_OPTIONS as readonly string[]).includes(key)) {
      check(actionError(`"${toKebabCase(key)}"`, value), NormalizeError);
      options[key] = value as ExitAction;
    } else {
      options[key] = value;
    }
  }

  return options as CommandOptions;
}

export interface Token {
  /** Everything after the name. */
  args: string;
  name: string;
  /** The `::` suffix, placeholders not yet filled. */
  options: string;
}
