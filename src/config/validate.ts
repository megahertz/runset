import type { Std } from '../types.ts';
import { EXIT_ACTIONS } from '../types.ts';
import type { RunsetError } from '../utils/errors.ts';
import { TIMINGS } from './std.ts';

// Each returns an error message, or `undefined` when the value is fine.

export function formatValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

export function numberError(
  name: string,
  value: unknown,
  minimum: number,
): string | undefined {
  if (typeof value !== 'number' || Number.isNaN(value) || value < minimum) {
    return `${name} must be a number of ${minimum} or more, got ${formatValue(value)}.`;
  }
  return undefined;
}

export function booleanError(name: string, value: unknown): string | undefined {
  return typeof value === 'boolean'
    ? undefined
    : `${name} must be true or false, got ${formatValue(value)}.`;
}

export function stringError(name: string, value: unknown): string | undefined {
  return typeof value === 'string'
    ? undefined
    : `${name} must be a string, got ${formatValue(value)}.`;
}

export function oneOfError(
  name: string,
  value: unknown,
  allowed: ReadonlySet<unknown>,
): string | undefined {
  return allowed.has(value)
    ? undefined
    : `${name} is one of ${[...allowed].join(', ')}, got ${formatValue(value)}.`;
}

export function actionError(name: string, value: unknown): string | undefined {
  return oneOfError(name, value, EXIT_ACTIONS);
}

export function stdError(name: string, value: Std): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return `${name} must be a stream setting.`;
  }

  if (!TIMINGS.has(value.timing)) {
    return `Invalid timing ${formatValue(value.timing)} for ${name}; one of ${[...TIMINGS].join(', ')}.`;
  }

  if (typeof value.destination !== 'string' || value.destination === '') {
    return `${name} needs a destination to write to.`;
  }

  return undefined;
}

/** Throws `message` as an `ErrorClass`, if there is one. */
export function check(
  message: string | undefined,
  ErrorClass: new (message: string) => RunsetError,
): void {
  if (message !== undefined) {
    throw new ErrorClass(message);
  }
}
