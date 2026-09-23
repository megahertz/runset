import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every spawned node — the CLI and the fixture tasks — reuses compiled
    // (and type-stripped) modules instead of redoing it on each start.
    env: {
      NODE_COMPILE_CACHE: path.join(os.tmpdir(), 'runset-tests/compile-cache'),
      // Node before 24.3 warns that type stripping is experimental, on the
      // very stderr the tests assert on.
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
      // How long the fixture tasks stay alive. Parallel tasks' writes only
      // interleave if the second starts before the first is done, and with the
      // whole suite running at once — on Windows above all — a start can lag
      // well past a shorter delay.
      RUNSET_TEST_DELAY: '500',
    },
    // The suite spawns real shells and waits on real processes.
    hookTimeout: 30_000,
    sequence: { concurrent: true },
    testTimeout: 10_000,
  },
});
