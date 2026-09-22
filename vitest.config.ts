import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every spawned node — the CLI and the fixture tasks — reuses compiled
    // (and type-stripped) modules instead of redoing it on each start.
    env: {
      NODE_COMPILE_CACHE: path.join(os.tmpdir(), 'runset-tests/compile-cache'),
    },
    // The suite spawns real shells and waits on real processes.
    hookTimeout: 30_000,
    sequence: { concurrent: true },
    testTimeout: 10_000,
  },
});
