import type { LogLevel } from '../types.ts';
import { paint } from '../utils/colors.ts';

const RANK: Record<LogLevel, number> = { debug: 3, error: 0, info: 2, warn: 1 };

// `info` stays plain, so the colored levels stand out.
const COLORS: Record<LogLevel, string[]> = {
  debug: ['gray'],
  error: ['red'],
  info: [],
  warn: ['yellow'],
};

/** runset's own messages — never the commands' output. */
export class Logger {
  private readonly level: LogLevel;
  private readonly stream: NodeJS.WritableStream;
  private readonly color: boolean;

  constructor(level: LogLevel, stream: NodeJS.WritableStream, color = false) {
    this.level = level;
    this.stream = stream;
    this.color = color;
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  info(message: string): void {
    this.write('info', message);
  }

  debug(message: string): void {
    this.write('debug', message);
  }

  private write(level: LogLevel, message: string): void {
    if (RANK[level] > RANK[this.level]) {
      return;
    }
    this.stream.write(`${paint(message, COLORS[level], this.color)}\n`);
  }
}
