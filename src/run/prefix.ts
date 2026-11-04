import type { Command, PrefixDecorator } from '../types.ts';
import { isColorName, paint } from '../utils/colors.ts';
import type { Prefix } from './OutputSink.ts';

/**
 * The prefix of a command's output lines: `''` without a label, a function
 * when `decoratePrefix` may answer differently per line.
 */
export function makePrefix(
  command: Command,
  color: boolean,
  decoratePrefix: PrefixDecorator | undefined,
  stream: 'stderr' | 'stdout',
): Prefix {
  if (command.label === '') {
    return '';
  }

  const defaultPrefix = defaultLabel(command, color);
  if (decoratePrefix === undefined) {
    return defaultPrefix;
  }

  const plainPrefix = `${command.label} `;
  return () =>
    String(
      decoratePrefix({ color, command, defaultPrefix, plainPrefix, stream }),
    );
}

/** A colored block with color; `[label]` without. */
export function defaultLabel(command: Command, color: boolean): string {
  // A blank label only holds the column.
  if (color && command.label.trim() === '') {
    return `${command.label} `;
  }

  // Background first, the order other tools emit them in.
  const formats = [command.bgColor, command.color].filter((name) =>
    isColorName(name),
  );
  if (!color || formats.length === 0) {
    return `[${command.label}] `;
  }

  return `${paint(command.label, formats)} `;
}
