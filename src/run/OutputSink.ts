import type { Destinations, Std } from '../types.ts';
import { isStreamDestination } from '../types.ts';
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

  private readonly std: Std;
  private readonly prefix: Prefix;
  private readonly destinations: Destinations;
  private readonly files: FileRegistry;

  constructor(
    std: Std,
    prefix: Prefix,
    destinations: Destinations,
    files: FileRegistry,
  ) {
    this.std = std;
    this.prefix = prefix;
    this.destinations = destinations;
    this.files = files;
  }

  /** Opened on first use, so a command that never writes truncates nothing. */
  private get target(): NodeJS.WritableStream {
    if (isStreamDestination(this.std.destination)) {
      return this.destinations[this.std.destination];
    }

    this.opened ??= this.files.open(this.std.destination);
    return this.opened;
  }

  write(chunk: string): void {
    if (this.std.destination === 'none') {
      return;
    }

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

    // Blank lines are prefixed too, keeping the label column unbroken.
    return (
      body
        .split('\n')
        .map((line) => (typeof prefix === 'string' ? prefix : prefix()) + line)
        .join('\n') + (endsWithNewline ? '\n' : '')
    );
  }
}

/** A line prefix: fixed, or asked for once per line. */
export type Prefix = (() => string) | string;
