import type { Command, LabelFormatter } from '../types.ts';
import { isColorName, paint } from '../utils/colors.ts';
import type { Prefix } from './OutputSink.ts';

/**
 * The prefix of a command's output lines: `''` without a label, a function
 * when `formatLabel` may answer differently per line.
 */
export function makePrefix(
  command: Command,
  color: boolean,
  formatLabel: LabelFormatter | undefined,
  stream: 'stderr' | 'stdout',
): Prefix {
  if (command.label === '') {
    return '';
  }

  const defaultPrefix = defaultLabel(command, color);
  if (formatLabel === undefined) {
    return defaultPrefix;
  }

  return () => String(formatLabel({ color, command, defaultPrefix, stream }));
}

/** A colored block with color; `[label]` without. */
function defaultLabel(command: Command, color: boolean): string {
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
