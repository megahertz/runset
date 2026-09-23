import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
/** The one directory under the system temp dir the suite writes to. */
const TEMP_ROOT = path.join(os.tmpdir(), 'runset-tests');
const RESULT_FILE = 'test.txt';

/**
 * A throwaway copy of a fixture directory.
 *
 * Every test gets its own copy so that the fixture tasks can all append to the
 * same `test.txt` name without the tests trampling each other when vitest runs
 * them concurrently. {@link tempDir} is the usual way in; construct it directly
 * only when a test wants to own the {@link create} / {@link remove} calls.
 */
export class Dir {
  /** Set to `false` inside a test to keep the copy around for inspection. */
  cleanTempDir = true;

  /** The fixture this copy is made from. */
  originalPath: string;

  /** Absolute path of the copy — pass it to runset as `cwd`. */
  path = '';

  #fixture: string;

  constructor(fixture = 'workspace') {
    this.#fixture = fixture;
    this.originalPath = fixturePath(fixture);
  }

  /** Makes a fresh copy of the fixture and points {@link path} at it. */
  async create(): Promise<void> {
    this.path = await makeTempDir(`${this.#fixture}-`);
    await fsp.cp(this.originalPath, this.path, { recursive: true });
  }

  async exists(subPath: string): Promise<boolean> {
    try {
      await fsp.stat(this.join(subPath));
      return true;
    } catch {
      return false;
    }
  }

  join(subPath: string): string {
    return path.join(this.path, subPath);
  }

  async read(subPath: string): Promise<string> {
    return fsp.readFile(this.join(subPath), 'utf8');
  }

  async readDir(subPath = ''): Promise<string[]> {
    return fsp.readdir(this.join(subPath));
  }

  async readJson<T = unknown>(subPath: string): Promise<T> {
    return JSON.parse(await this.read(subPath)) as T;
  }

  async readLines(subPath: string): Promise<string[]> {
    const content = await this.read(subPath);
    return content.split('\n').map((line) => line.trim());
  }

  /** Deletes the copy when an `await using` scope ends, however it ends. */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.cleanTempDir) {
      await this.remove();
    }
  }

  /** Deletes the whole copy. */
  async remove(): Promise<void> {
    await fsp.rm(this.path, { recursive: true });
  }

  /**
   * Contents of `test.txt`, or `undefined` when no task wrote anything — an
   * empty file included, which is what a task killed mid-write leaves behind.
   */
  async result(): Promise<string | undefined> {
    const content = (await this.exists(RESULT_FILE))
      ? await this.read(RESULT_FILE)
      : '';
    return content === '' ? undefined : content;
  }

  async rm(
    subPath: string,
    { throwOnMissing = false }: { throwOnMissing?: boolean } = {},
  ): Promise<void> {
    try {
      await fsp.rm(this.join(subPath), { recursive: true });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
        throwOnMissing
      ) {
        throw error;
      }
    }
  }

  async write(subPath: string, content: string): Promise<void> {
    await fsp.writeFile(this.join(subPath), content);
  }
}

/**
 * A fresh copy of a fixture, removed again when the test's scope ends — even
 * when the test throws:
 *
 * ```ts
 * test('…', async () => {
 *   await using dir = await tempDir();
 *   await run(['lint'], { cwd: dir.path });
 * });
 * ```
 *
 * `fixture` names a directory under `tests/fixtures`, and defaults to
 * `workspace` — the one nearly every test wants.
 */
export async function tempDir(fixture?: string): Promise<Dir> {
  const dir = new Dir(fixture);
  await dir.create();
  return dir;
}

/** The fixture itself, for a test that only reads it and never runs in it. */
export function fixturePath(fixture = 'workspace'): string {
  return path.resolve(FIXTURES, fixture);
}

/** A fresh, empty directory under {@link TEMP_ROOT}; removing it is the caller's job. */
export async function makeTempDir(prefix: string): Promise<string> {
  await fsp.mkdir(TEMP_ROOT, { recursive: true });
  return fsp.mkdtemp(path.join(TEMP_ROOT, prefix));
}
