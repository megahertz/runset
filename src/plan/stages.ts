import type { Command } from '../types.ts';

export const EMPTY_SEGMENT: Segment = { commands: [], parallel: false };

/** A `-p`/`-s`: what follows starts a new group past everything before it. */
export const BOUNDARY: Segment = {
  boundary: true,
  commands: [],
  parallel: false,
};

/**
 * Lays segments out into stages. A parallel segment joins the open stage;
 * anything else starts past every stage in use, and so does what follows it.
 * A segment's commands keep their relative stages, shifted onto its own.
 */
export function link(segments: Segment[]): Command[] {
  const commands: Command[] = [];
  /** The stage a parallel segment joins. */
  let open = 0;
  /** The last stage in use; -1 while none is. */
  let used = -1;

  for (const segment of segments) {
    if (segment.boundary) {
      open = used + 1;
      continue;
    }

    if (segment.commands.length === 0) {
      continue;
    }

    const base = segment.parallel ? open : used + 1;

    for (const command of segment.commands) {
      command.stage += base;
      used = Math.max(used, command.stage);
      commands.push(command);
    }

    open = segment.parallel ? open : used + 1;
  }

  return commands;
}

/** Splits a stage-sorted list into its stages, in order. */
export function groupByStage<T>(
  items: readonly T[],
  stageOf: (item: T) => number,
): T[][] {
  return [...Map.groupBy(items, stageOf).values()];
}

/** The commands one token or list produced, staged among themselves. */
export interface Segment {
  /** A group boundary rather than anything to run: see {@link BOUNDARY}. */
  boundary?: boolean;
  /** `stage` counted from this segment's start. */
  commands: Command[];
  /** Whether the segment joins the commands beside it. */
  parallel: boolean;
}
