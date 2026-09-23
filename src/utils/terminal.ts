/**
 * Measuring and wrapping text the way a terminal lays it out: escape sequences
 * take no room, wide characters (CJK, emoji) take two columns.
 */

// CSI (`ESC [ … final`), OSC (`ESC ] … BEL|ST`), or a two-byte escape.
const ESCAPE =
  // oxlint-disable-next-line no-control-regex
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[@-Z\\-_])/g;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Printable ASCII only: one column per character, nothing to segment. */
const PLAIN = /^[ -~]*$/;

export function isTerminal(stream: NodeJS.WritableStream): boolean {
  return (stream as NodeJS.WriteStream).isTTY === true;
}

/** The width a terminal stream reports; `undefined` for anything else. */
export function terminalColumns(
  stream: NodeJS.WritableStream,
): number | undefined {
  const { columns } = stream as NodeJS.WriteStream;
  return isTerminal(stream) && columns > 0 ? columns : undefined;
}

/** `COLUMNS` as a positive integer, or `undefined`. */
export function parseColumns(value: string | undefined): number | undefined {
  const columns = Number(value);
  return Number.isInteger(columns) && columns > 0 ? columns : undefined;
}

/** The columns `text` takes on screen. */
export function visibleWidth(text: string): number {
  if (PLAIN.test(text)) {
    return text.length;
  }

  let width = 0;
  for (const { segment } of segmenter.segment(text.replace(ESCAPE, ''))) {
    width += columnWidth(segment, width);
  }
  return width;
}

/**
 * Hard-wraps one line to `width` columns, the way the terminal would have, so
 * each piece can carry a label of its own. A style still open at a break is
 * reset at the end of the piece and re-applied at the start of the next, so a
 * label never inherits it. `offset` is the column the line starts at, for tab
 * stops. A line that moves the cursor — `\r`, or any escape but a color — is
 * left whole: where it lands is not something runset can know.
 */
export function wrapLine(line: string, width: number, offset = 0): string[] {
  // No character is wider than two columns per code unit, so this one fits.
  const fits = line.length * 2 <= width && !line.includes('\t');
  if (width < 1 || fits || line.includes('\r')) {
    return [line];
  }

  if (PLAIN.test(line)) {
    const pieces: string[] = [];
    for (let start = 0; start < line.length; start += width) {
      pieces.push(line.slice(start, start + width));
    }
    return pieces;
  }

  const pieces: string[] = [];
  let current = '';
  let column = 0;
  let style: string[] = [];

  for (const token of tokenize(line)) {
    if (token.escape) {
      if (token.text.startsWith('\u001B[') && !isSgr(token.text)) {
        return [line];
      }
      current += token.text;
      style = applySgr(style, token.text);
      continue;
    }

    for (const { segment } of segmenter.segment(token.text)) {
      let size = columnWidth(segment, offset + column);

      // Something always lands on a piece, or a too-wide character never would.
      if (column > 0 && column + size > width) {
        pieces.push(style.length > 0 ? `${current}\u001B[0m` : current);
        current = style.join('');
        column = 0;
        size = columnWidth(segment, offset);
      }

      current += segment;
      column += size;
    }
  }

  pieces.push(current);
  return pieces;
}

interface Token {
  escape: boolean;
  text: string;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;

  for (const match of text.matchAll(ESCAPE)) {
    if (match.index > last) {
      tokens.push({ escape: false, text: text.slice(last, match.index) });
    }
    tokens.push({ escape: true, text: match[0] });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    tokens.push({ escape: false, text: text.slice(last) });
  }
  return tokens;
}

/** A color or style (`ESC [ … m`); any other CSI moves the cursor. */
function isSgr(sequence: string): boolean {
  return sequence.startsWith('\u001B[') && sequence.endsWith('m');
}

/** The SGR sequences in force after `sequence`; a reset clears them. */
function applySgr(style: string[], sequence: string): string[] {
  if (!isSgr(sequence)) {
    return style;
  }

  const params = sequence.slice(2, -1);
  if (params === '' || params === '0') {
    return [];
  }
  // `0;1` resets and then sets: only what follows the reset survives.
  return params.startsWith('0;') ? [sequence] : [...style, sequence];
}

/** The columns one grapheme takes when it starts at `column`. */
function columnWidth(grapheme: string, column: number): number {
  if (grapheme === '\t') {
    return 8 - (column % 8);
  }

  if (/^[ -~]$/.test(grapheme)) {
    return 1;
  }
  if (/^[\p{Cc}\p{Cf}\p{Mn}\p{Me}]+$/u.test(grapheme)) {
    return 0;
  }
  if (
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(grapheme) &&
    // VS16 asks for a character's emoji, two-column, form.
    /\p{Emoji_Presentation}|\uFE0F/u.test(grapheme)
  ) {
    return 2;
  }

  // East Asian Wide and Fullwidth: Hangul Jamo, CJK radicals and punctuation,
  // Kana, CJK ideographs, Yi, Hangul syllables, compatibility and fullwidth
  // forms, and the CJK extensions past the BMP.
  return /^[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u.test(
    grapheme,
  )
    ? 2
    : 1;
}
