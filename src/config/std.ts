import type { Std, StdTiming } from '../types.ts';

export const TIMINGS = new Set<StdTiming>(['realtime', 'grouped']);

/**
 * Parses `<timing>+<destination>` (either order, either optional) into the
 * axes it names. Unnamed axes are left out so settings can be layered.
 */
export function parsePartialStd(value: string): Partial<Std> {
  const result: Partial<Std> = {};

  for (const part of value.split('+')) {
    const token = part.trim();
    if (token === '') {
      continue;
    }

    if (TIMINGS.has(token as StdTiming)) {
      result.timing = token as StdTiming;
    } else {
      result.destination = token;
    }
  }

  return result;
}

export function toPartialStd(value: Partial<Std> | string): Partial<Std> {
  return typeof value === 'string' ? parsePartialStd(value) : value;
}

/** Layers a stream setting, in either form, over `base` one axis at a time. */
export function mergeStd<T extends Partial<Std>>(
  base: T,
  value: Partial<Std> | string | undefined,
): T {
  return value === undefined ? base : { ...base, ...toPartialStd(value) };
}

export function defaultStd(destination: 'stderr' | 'stdout'): Std {
  return { destination, timing: 'realtime' };
}
