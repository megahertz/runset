import type { Command } from '../types.ts';
import type { Plan } from './plan.ts';
import { groupByStage } from './stages.ts';

export const PALETTE: { bgColor: string; color: string }[] = [
  { bgColor: 'bgGreen', color: 'black' },
  { bgColor: 'bgBlue', color: 'white' },
  { bgColor: 'bgMagenta', color: 'white' },
  { bgColor: 'bgCyan', color: 'black' },
  { bgColor: 'bgYellow', color: 'black' },
  { bgColor: 'bgRed', color: 'white' },
  { bgColor: 'bgGray', color: 'white' },
  { bgColor: 'bgGreenBright', color: 'black' },
  { bgColor: 'bgBlueBright', color: 'black' },
  { bgColor: 'bgMagentaBright', color: 'black' },
  { bgColor: 'bgCyanBright', color: 'black' },
  { bgColor: 'bgYellowBright', color: 'black' },
];

/**
 * Settles who is labelled, per `config.labels`. Under `auto`, a command
 * sharing a stage is named after itself — or gets a blank label holding the
 * column when someone in its stage has a label of their own.
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

      if (mode === 'all' || (mode === 'auto' && shared && !labeled)) {
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
 * one its label hashes to, or the next free when that is taken.
 */
export function colorLabels({ commands }: Plan): void {
  const labeled = commands.filter((command) => command.label !== '');
  const taken = new Set(
    labeled
      .map((command) =>
        PALETTE.findIndex((pair) => pair.bgColor === command.bgColor),
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

    const index = claim(paletteIndex(command.label), taken);
    taken.add(index);

    const pair = PALETTE[index] as (typeof PALETTE)[number];
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

/** A stable palette index for a label. */
export function paletteIndex(label: string): number {
  /** The largest modulus that keeps `hash * 31 + code` an exact integer. */
  const HASH_MODULUS = 2_147_483_647;
  let hash = 0;

  // By code point, so an astral character is not counted twice.
  for (const character of label) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }

  return hash % PALETTE.length;
}

/** The script name, or the program a shell command runs. */
function nameOf(command: Command): string {
  return command.scriptName ?? command.command.split(/\s/, 1)[0] ?? '';
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

function claim(preferred: number, taken: Set<number>): number {
  // More labels than colors: share the preferred one.
  if (taken.size >= PALETTE.length) {
    return preferred;
  }

  let index = preferred;
  while (taken.has(index)) {
    index = (index + 1) % PALETTE.length;
  }

  return index;
}
