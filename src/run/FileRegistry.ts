import fs from 'node:fs';
import path from 'node:path';

/** One shared write stream per file path, for the lifetime of a run. */
export class FileRegistry {
  /** The first failure any file reported. */
  error: Error | undefined;

  private readonly streams = new Map<string, fs.WriteStream>();
  private readonly cwd: string;
  private readonly onFailure: (error: Error) => void;

  /** `onFailure` is called once, with the first failure. */
  constructor(cwd: string, onFailure: (error: Error) => void) {
    this.cwd = cwd;
    this.onFailure = onFailure;
  }

  open(destination: string): fs.WriteStream {
    const filePath = path.resolve(this.cwd, destination);
    let stream = this.streams.get(filePath);

    if (stream === undefined) {
      stream = fs.createWriteStream(filePath);
      // Open errors arrive async; unhandled, they would crash the process.
      stream.on('error', (error: Error) => {
        this.fail(destination, error);
      });
      this.streams.set(filePath, stream);
    }

    return stream;
  }

  /** Ends every file and waits for `close`, which follows errors too. */
  async closeAll(): Promise<void> {
    const streams = [...this.streams.values()];
    this.streams.clear();

    await Promise.all(streams.map((stream) => closed(stream)));
  }

  private fail(destination: string, error: Error): void {
    if (this.error !== undefined) {
      return;
    }

    this.error = new Error(
      `cannot write to "${destination}": ${error.message}`,
    );
    this.onFailure(this.error);
  }
}

function closed(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) {
      resolve();
      return;
    }

    stream.once('close', resolve);
    stream.end();
  });
}
