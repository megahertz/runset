// Everything about colors lives here: palettes, shades, hashing and painting.
// Only the `colorLabels` plan pass lives in plan/labels.ts. Don't move anything
// from this module there during a refactor without a strong reason.
import { inspect, styleText } from 'node:util';
import type { InspectColor } from 'node:util';
import type { ColorMode } from '../types.ts';
import { toCamelCase } from './string.ts';

const KNOWN = new Set(Object.keys(inspect.colors));

// Xterm's color cube gives these shades stable RGB values on typical terminals.
// The first 16 slots belong to the user's theme; ink and paper use grayscale slots.
export const SHADES: Record<
  string,
  { fallback: InspectColor; foreground?: 'ink' | 'paper'; index: number }
> = {
  mint: { index: 115, fallback: 'greenBright' },
  sky: { index: 111, fallback: 'blueBright' },
  rose: { index: 211, fallback: 'magentaBright' },
  amber: { index: 179, fallback: 'yellowBright' },
  lavender: { index: 183, fallback: 'magentaBright' },
  aqua: { index: 80, fallback: 'cyanBright' },
  coral: { index: 210, fallback: 'redBright' },
  sage: { index: 151, fallback: 'greenBright' },
  periwinkle: { index: 147, fallback: 'blueBright' },
  peach: { index: 216, fallback: 'yellowBright' },
  teal: { index: 79, fallback: 'cyanBright' },
  lilac: { index: 177, fallback: 'magentaBright' },
  lime: { index: 149, fallback: 'greenBright' },
  steel: { index: 110, fallback: 'blueBright' },
  pink: { index: 218, fallback: 'magentaBright' },
  seafoam: { index: 121, fallback: 'cyanBright' },
  apricot: { index: 215, fallback: 'yellowBright' },
  mauve: { index: 139, fallback: 'magentaBright' },
  jade: { index: 114, fallback: 'greenBright' },
  sand: { index: 180, fallback: 'yellowBright' },
  iris: { index: 141, fallback: 'blueBright' },
  ice: { index: 117, fallback: 'cyanBright' },
  salmon: { index: 174, fallback: 'redBright' },
  olive: { index: 150, fallback: 'greenBright' },
  navy: { index: 24, fallback: 'blue', foreground: 'paper' },
  plum: { index: 96, fallback: 'magenta', foreground: 'paper' },
  forest: { index: 22, fallback: 'green', foreground: 'paper' },
  wine: { index: 89, fallback: 'red', foreground: 'paper' },
  ocean: { index: 25, fallback: 'blue', foreground: 'paper' },
  indigo: { index: 61, fallback: 'blue', foreground: 'paper' },
  copper: { index: 94, fallback: 'red', foreground: 'paper' },
  pine: { index: 23, fallback: 'cyan', foreground: 'paper' },
  violet: { index: 55, fallback: 'magenta', foreground: 'paper' },
  brick: { index: 88, fallback: 'red', foreground: 'paper' },
  slate: { index: 60, fallback: 'blue', foreground: 'paper' },
  cocoa: { index: 95, fallback: 'red', foreground: 'paper' },
  ink: { index: 235, fallback: 'black' },
  paper: { index: 255, fallback: 'whiteBright' },
};

/** Every shade by its foreground and its background name, e.g. `mint`, `bgMint`. */
const SHADE_NAMES = new Map(
  Object.entries(SHADES).flatMap(
    ([name, custom]) =>
      [
        [name, custom],
        [toCamelCase(`bg-${name}`), custom],
      ] as const,
  ),
);

export const BASIC_PALETTE: { bgColor: string; color: string }[] = [
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

/** Interleave hue families so adjacent assignments remain easy to tell apart. */
export const PALETTE: { bgColor: string; color: string }[] = Object.entries(
  SHADES,
)
  .filter(([name]) => name !== 'ink' && name !== 'paper')
  .map(([name, { foreground }]) => ({
    bgColor: toCamelCase(`bg-${name}`),
    color: foreground ?? 'ink',
  }));

/** A `ColorMode` once `auto` has been settled. */
export type ColorLevel = Exclude<ColorMode, 'auto'>;

/** What `colorLabels` hands out under each mode; `none` still picks, unseen. */
export const PALETTES: Record<
  ColorLevel,
  { bgColor: string; color: string }[]
> = {
  none: BASIC_PALETTE,
  basic: BASIC_PALETTE,
  soft: PALETTE.filter((pair) => pair.color === 'ink'),
  all: PALETTE,
};

/** A built-in style or one of runset's foreground/background shades. */
export function isColorName(name: string): boolean {
  return KNOWN.has(name) || shade(name) !== undefined;
}

/**
 * Styles text; a shade is painted from the 256-color table. Plain text when
 * not `enabled`.
 */
export function paint(text: string, colors: string[], enabled = true): string {
  if (!enabled) {
    return text;
  }

  let result = text;
  // Wrap in reverse order so backgrounds open first and close last.
  for (const name of colors.toReversed()) {
    const custom = shade(name);
    if (custom !== undefined) {
      const background = name.startsWith('bg');
      const open = `\u001B[${background ? 48 : 38};5;${custom.index}m`;
      const close = `\u001B[${background ? 49 : 39}m`;
      result = open + result.replaceAll(close, open) + close;
    } else if (KNOWN.has(name)) {
      result = styleText(name as InspectColor, result, {
        validateStream: false,
      });
    }
  }
  return result;
}

/** The theme color used for a shade on a basic terminal. */
export function fallbackColor(name: string): string {
  const custom = shade(name);
  if (custom === undefined) {
    return name;
  }
  return name.startsWith('bg')
    ? toCamelCase(`bg-${custom.fallback}`)
    : custom.fallback;
}

/** A stable palette index for a label. */
export function paletteIndex(label: string, palette = PALETTE): number {
  /** The largest modulus that keeps `hash * 31 + code` an exact integer. */
  const HASH_MODULUS = 2_147_483_647;
  let hash = 0;

  // By code point, so an astral character is not counted twice.
  for (const character of label) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }

  return hash % palette.length;
}

export function shade(name: string): (typeof SHADES)[string] | undefined {
  return SHADE_NAMES.get(name);
}
