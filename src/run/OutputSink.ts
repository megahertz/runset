import type { Destinations, Std } from '../types.ts';
import { isStreamDestination } from '../types.ts';
import { terminalColumns, visibleWidth, wrapLine } from '../utils/terminal.ts';
import type { FileRegistry } from './FileRegistry.ts';

/**
 * Routes one command stream by its {@link Std}: `realtime` writes through,
 * `grouped` holds everything until {@link flush}, `none` discards.
 */
export class OutputSink {
  private buffered = '';
  /** A prefixed stream's unfinished line, held until its newline. */
  private pending = '';
  private opened: NodeJS.WritableStream | undefined;
  /** Whether everything written so far ended with a newline. */
  private atLineStart = true;

  private readonly std: Std;
  private readonly prefix: Prefix;
  private readonly destinations: Destinations;
  private readonly files: FileRegistry;
  private readonly wrap: boolean;
  /** `COLUMNS`, for a stream that is not a terminal. */
  private readonly envColumns: number | undefined;

  constructor(
    std: Std,
    prefix: Prefix,
    destinations: Destinations,
    files: FileRegistry,
    wrap = false,
    envColumns?: number,
  ) {
    this.std = std;
    this.prefix = prefix;
    this.destinations = destinations;
    this.files = files;
    this.wrap = wrap;
    this.envColumns = envColumns;
  }

  /** Opened on first use, so a command that never writes truncates nothing. */
  private get target(): NodeJS.WritableStream {
    if (isStreamDestination(this.std.destination)) {
      return this.destinations[this.std.destination];
    }

    this.opened ??= this.files.open(this.std.destination);
    return this.opened;
  }

  /**
   * The width labelled lines are wrapped to under `wrap`: the terminal's own,
   * else `COLUMNS`. A file has none, and neither has a run without `wrap`.
   */
  columns(): number | undefined {
    if (!this.wrap || !isStreamDestination(this.std.destination)) {
      return undefined;
    }
    return terminalColumns(this.target) ?? this.envColumns;
  }

  write(chunk: string): void {
    if (this.std.destination === 'none' || chunk === '') {
      return;
    }

    this.atLineStart = chunk.endsWith('\n');

    if (this.std.timing === 'grouped') {
      this.buffered += chunk;
      return;
    }

    if (this.prefix === '') {
      this.target.write(chunk);
      return;
    }

    // Only whole lines go out, so commands never land mid-line on each other.
    this.pending += chunk;
    const end = this.pending.lastIndexOf('\n');
    if (end === -1) {
      return;
    }

    const complete = this.pending.slice(0, end + 1);
    this.pending = this.pending.slice(end + 1);
    this.target.write(this.applyPrefix(complete));
  }

  /** A line of runset's own, on a line of its own: after any unfinished one. */
  writeLine(text: string): void {
    this.write(`${this.atLineStart ? '' : '\n'}${text}\n`);
  }

  /** Emits what is held back: a `grouped` stream, or a partial line. */
  flush(): void {
    const held = [this.pending, this.buffered].filter((text) => text !== '');
    this.pending = '';
    this.buffered = '';

    for (const text of held) {
      this.target.write(this.applyPrefix(text));
    }
  }

  private applyPrefix(chunk: string): string {
    const { prefix } = this;
    if (prefix === '') {
      return chunk;
    }

    const endsWithNewline = chunk.endsWith('\n');
    const body = endsWithNewline ? chunk.slice(0, -1) : chunk;
    const columns = this.columns();

    // Blank lines are prefixed too, keeping the label column unbroken.
    return (
      body
        .split('\n')
        .map((line) => this.label(line, prefix, columns))
        .join('\n') + (endsWithNewline ? '\n' : '')
    );
  }

  /** One line, prefixed; wrapped first when it would overflow the terminal. */
  private label(
    line: string,
    prefix: Prefix,
    columns: number | undefined,
  ): string {
    // Asked once per line, so a clock or counter reads the same on each piece.
    const text = typeof prefix === 'string' ? prefix : prefix();
    if (columns === undefined) {
      return text + line;
    }

    const width = visibleWidth(text);
    return wrapLine(line, columns - width, width)
      .map((piece) => text + piece)
      .join('\n');
  }
}

/** A line prefix: fixed, or asked for once per line. */
export type Prefix = (() => string) | string;
