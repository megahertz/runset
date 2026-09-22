import { inspect, styleText } from 'node:util';
import type { InspectColor } from 'node:util';

const KNOWN = new Set(Object.keys(inspect.colors));

/** A color name `node:util`'s `styleText` knows. */
export function isColorName(name: string): name is InspectColor {
  return KNOWN.has(name);
}

/** Styles `text` with the known names among `colors`, if any. */
export function paint(text: string, colors: string[]): string {
  const formats = colors.filter((name) => isColorName(name));
  return formats.length === 0
    ? text
    : styleText(formats, text, { validateStream: false });
}
