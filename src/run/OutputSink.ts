import type { Std } from '../types.ts';
import { terminalColumns, visibleWidth, wrapLine } from '../utils/terminal.ts';
import type { RunContext } from './Process.ts';

/**
 * Routes one command stream by its {@link Std}: `realtime` writes through,
 * `grouped` holds everything until {@link flush}, `none` discards.
 */
export class OutputSink {
  /** A grouped stream's output, or a prefixed stream's unfinished line. */
  private buffered = '';
  private opened: NodeJS.WritableStream | undefined;
  /** Whether everything written so far ended with a newline. */
  private atLineStart = true;

  private readonly std: Std;
  private readonly prefix: Prefix;
  /** The columns a fixed prefix takes; measured per line otherwise. */
  private readonly prefixWidth: number | undefined;
  private readonly context: Pick<RunContext, 'config' | 'files'>;

  constructor(
    std: Std,
    prefix: Prefix,
    context: Pick<RunContext, 'config' | 'files'>,
  ) {
    this.std = std;
    this.prefix = prefix;
    this.prefixWidth =
      typeof prefix === 'string' ? visibleWidth(prefix) : undefined;
    this.context = context;
  }

  /** Opened on first use, so a command that never writes truncates nothing. */
  private get target(): NodeJS.WritableStream {
    if (isStreamDestination(this.std.destination)) {
      return this.context.config.destinations[this.std.destination];
    }

    this.opened ??= this.context.files.open(this.std.destination);
    return this.opened;
  }

  /**
   * The width labelled lines are wrapped to under `wrap`: the terminal's own,
   * else `COLUMNS`. A file has none, and neither has a run without `wrap`.
   */
  columns(): number | undefined {
    const { envColumns, wrap } = this.context.config;
    if (!wrap || !isStreamDestination(this.std.destination)) {
      return undefined;
    }
    return terminalColumns(this.target) ?? envColumns;
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
    // Only the new chunk is searched: a long unfinished line is not rescanned.
    const end = chunk.lastIndexOf('\n');
    if (end === -1) {
      this.buffered += chunk;
      return;
    }

    const complete = this.buffered + chunk.slice(0, end + 1);
    this.buffered = chunk.slice(end + 1);
    this.target.write(this.applyPrefix(complete));
  }

  /** A line of runset's own, on a line of its own: after any unfinished one. */
  writeLine(text: string): void {
    this.write(`${this.atLineStart ? '' : '\n'}${text}\n`);
  }

  /** Emits what is held back: a `grouped` stream, or a partial line. */
  flush(): void {
    const held = this.buffered;
    this.buffered = '';

    if (held !== '') {
      this.target.write(this.applyPrefix(held));
    }
  }

  private applyPrefix(chunk: string): string {
    const { prefix } = this;
    if (prefix === '') {
      return chunk;
    }

    const endsWithNewline = chunk.endsWith('\n');
    const body = endsWithNewline ? chunk.slice(0, -1) : chunk;
    const end = endsWithNewline ? '\n' : '';
    const columns = this.columns();

    // Blank lines are prefixed too, keeping the label column unbroken.
    if (typeof prefix === 'string' && columns === undefined) {
      return prefix + body.replaceAll('\n', `\n${prefix}`) + end;
    }

    return (
      body
        .split('\n')
        .map((line) => this.label(line, prefix, columns))
        .join('\n') + end
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

    // A CRLF line ends in `\r`: it closes the line rather than moving the
    // cursor, so it is kept aside for the wrap and put back after it.
    const cr = line.endsWith('\r') ? '\r' : '';
    const width = this.prefixWidth ?? visibleWidth(text);
    return (
      wrapLine(line.slice(0, line.length - cr.length), columns - width, width)
        .map((piece) => text + piece)
        .join('\n') + cr
    );
  }
}

/** A line prefix: fixed, or asked for once per line. */
export type Prefix = (() => string) | string;

export function isStreamDestination(
  destination: string,
): destination is 'stderr' | 'stdout' {
  return destination === 'stdout' || destination === 'stderr';
}
