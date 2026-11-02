import { AsyncLocalStorage } from 'node:async_hooks';

/** Where a function's `process.stdout` / `process.stderr` writes go. */
export interface CaptureTarget {
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

const storage = new AsyncLocalStorage<CaptureTarget>();

/** How many runs want the streams patched; the last one out restores them. */
let users = 0;
let restore: (() => void) | undefined;
/** Set while a captured write is being routed, so the sink's own write passes. */
let routing = false;

/**
 * Patches `process.stdout` / `process.stderr` so a write made inside
 * {@link runCaptured} goes to that call's target, and any other write goes
 * where it always did. The context follows the function's async work, so
 * output from callbacks it set up is captured too, after it has resolved.
 * Returns the release.
 */
export function captureOutput(): () => void {
  if (users === 0) {
    const restoreStdout = patch(process.stdout, (target) => target.stdout);
    const restoreStderr = patch(process.stderr, (target) => target.stderr);
    restore = () => {
      restoreStdout();
      restoreStderr();
    };
  }
  users += 1;

  return () => {
    users -= 1;
    if (users === 0) {
      restore?.();
      restore = undefined;
    }
  };
}

/** Calls `fn` with its writes to the process's streams routed to `target`. */
export async function runCaptured<T>(
  target: CaptureTarget,
  fn: () => T,
): Promise<Awaited<T>> {
  // `async`, so a function that throws synchronously rejects instead.
  return await storage.run(target, fn);
}

function patch(
  stream: NodeJS.WriteStream,
  pick: (target: CaptureTarget) => (chunk: string) => void,
): () => void {
  const original = stream.write;

  const write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const target = storage.getStore();
    if (target === undefined || routing) {
      return Reflect.apply(original, stream, [chunk, ...rest]) as boolean;
    }

    routing = true;
    try {
      pick(target)(
        typeof chunk === 'string' || Buffer.isBuffer(chunk)
          ? chunk.toString()
          : Buffer.from(chunk).toString(),
      );
    } finally {
      routing = false;
    }

    const callback = rest.find((arg) => typeof arg === 'function');
    if (callback !== undefined) {
      process.nextTick(callback as () => void);
    }
    return true;
  }) as typeof stream.write;

  Object.assign(stream, { write });
  return () => {
    // Whoever patched it after us keeps their patch.
    if (stream.write === write) {
      Object.assign(stream, { write: original });
    }
  };
}
