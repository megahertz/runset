import type { Command } from '../types.ts';
import {
  BASIC_PALETTE,
  fallbackColor,
  PALETTE,
  paletteIndex,
} from '../utils/colors.ts';
import type { Plan } from './plan.ts';
import { groupByStage } from './stages.ts';

/**
 * Settles who is labelled, per `config.labels`. Under `auto`, a command
 * sharing a stage is named after itself, whether or not someone in its stage
 * has a label of their own. Under `custom` it gets a blank label instead,
 * holding the column when someone in its stage has one.
 */
export function assignAutoLabels({ commands, config }: Plan): void {
  const mode = config.labels;

  if (mode === 'none') {
    for (const command of commands) {
      command.label = '';
    }
    return;
  }

  const named: Command[] = [];

  for (const stage of groupByStage(commands, (command) => command.stage)) {
    const shared = stage.length > 1;
    const labeled = stage.some((command) => command.label !== '');

    for (const command of stage) {
      if (command.label !== '') {
        continue;
      }

      if (mode === 'all' || (mode === 'auto' && shared)) {
        command.label = nameOf(command);
        named.push(command);
      } else if (shared && labeled) {
        command.label = ' ';
      }
    }
  }

  numberRepeats(named);
}

/**
 * Gives each labelled command without colors of its own a palette pair: the
 * one its label hashes to, or the next free when that is taken. On a basic
 * terminal every shade is first swapped for its theme color, so nothing past
 * the plan has to know how many colors the terminal has.
 */
export function colorLabels({ commands, config }: Plan): void {
  const palette = config.extendedColor ? PALETTE : BASIC_PALETTE;
  if (!config.extendedColor) {
    for (const command of commands) {
      command.bgColor = fallbackColor(command.bgColor);
      command.color = fallbackColor(command.color);
    }
  }

  const labeled = commands.filter((command) => command.label !== '');
  const taken = new Set(
    labeled
      .map((command) =>
        palette.findIndex((pair) => pair.bgColor === command.bgColor),
      )
      .filter((index) => index !== -1),
  );

  for (const command of labeled) {
    // A blank label only holds the column; it stays uncolored.
    if (
      command.color !== '' ||
      command.bgColor !== '' ||
      command.label.trim() === ''
    ) {
      continue;
    }

    const index = claim(
      paletteIndex(command.label, palette),
      taken,
      palette.length,
    );
    taken.add(index);

    const pair = palette[index] as (typeof palette)[number];
    command.bgColor = pair.bgColor;
    command.color = pair.color;
  }
}

/** Pads every label to the widest one. */
export function alignLabels({ commands }: Plan): void {
  const labeled = commands.filter((command) => command.label !== '');
  const width = Math.max(0, ...labeled.map((command) => command.label.length));
  for (const command of labeled) {
    command.label = command.label.padEnd(width);
  }
}

/** The script name, or the program a shell command runs. */
function nameOf(command: Command): string {
  return (
    command.packageName ??
    command.scriptName ??
    command.command.split(/\s/, 1)[0] ??
    ''
  );
}

/** `serve`, `serve` → `serve#1`, `serve#2`. */
function numberRepeats(named: Command[]): void {
  const totals = new Map<string, number>();
  for (const command of named) {
    totals.set(command.label, (totals.get(command.label) ?? 0) + 1);
  }

  const counters = new Map<string, number>();
  for (const command of named) {
    if ((totals.get(command.label) ?? 0) < 2) {
      continue;
    }

    const index = (counters.get(command.label) ?? 0) + 1;
    counters.set(command.label, index);
    command.label = `${command.label}#${index}`;
  }
}

function claim(preferred: number, taken: Set<number>, size: number): number {
  // More labels than colors: share the preferred one.
  if (taken.size >= size) {
    return preferred;
  }

  let index = preferred;
  while (taken.has(index)) {
    index = (index + 1) % size;
  }

  return index;
}
