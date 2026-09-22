import cp from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { makeTempDir } from './helpers/tempDir.ts';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACK_TIMEOUT = 180_000;

/** The environment minus everything the npm running this suite put in it. */
function withoutNpmConfig(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith('npm_config_')),
  );
}

/**
 * Runs a command to completion, rejecting on a non-zero exit code.
 *
 * A plain wrapper around `child_process.spawn`, not the `src/index.ts`
 * spawning helpers in `helpers/cli.ts` — this file drives `npm` itself (pack, install,
 * a couple of `npm run`s), never runset's own CLI source directly.
 */
function exec(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {
      cwd,
      // Without the outer npm's own configuration. Running the suite through
      // `npm test` exports every setting as an `npm_config_*` variable, and the
      // installs below would inherit a policy meant for this repository rather
      // than starting from whatever a real consumer's machine says.
      env: withoutNpmConfig(process.env),
      // npm ships as a `.cmd` shim on Windows, which only runs through a shell.
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with ${code}\n` +
              (stderr || stdout),
          ),
        );
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}

/**
 * [pack] packs the real tarball, installs it into a throwaway project, and
 * runs the installed CLI and library from there — the one test that would
 * have caught a `prepack` that forgot to build `dist/` before packing. Every
 * other test runs `src/index.ts` straight through Node's type-stripping, so an
 * empty or stale `dist/` still passes the rest of the suite.
 *
 * It is slow (a real `npm pack` and `npm install`), hence the generous
 * timeout below and the `[pack]` tag calling it out as the odd one out.
 *
 * `npm pack` (and `npm publish`) normally run through `prepack`, which is
 * `npm run check && npm run build` — `check` (which is what runs this very
 * test) happens *before* `build`. Two ways to keep that from recursing forever
 * were on the table:
 *
 *   1. Set an env var when spawning `npm pack` below and have the test
 *      `skipIf` it's present.
 *   2. Pack with `--ignore-scripts` (so packing never triggers `prepack`
 *      here) and build `dist/` ourselves first.
 *
 * (1) only stops the infinite loop; the test would still be *invoked* (and
 * fail, packing a `dist/` nothing has built yet) any time some other
 * `npm pack`/`npm publish` reaches its own `check` step, since `build` hasn't
 * run yet at that point. (2) sidesteps the ordering problem entirely
 * rather than just the recursion, so that's the one used here.
 */
describe('[pack] the packed tarball actually runs, once installed', () => {
  test(
    'a clean install of the tarball runs the CLI and imports the library',
    { timeout: PACK_TIMEOUT },
    async () => {
      // Build a fresh `dist/` ourselves rather than relying on one already
      // being there; tsdown's `clean` empties it first, so a stale file from
      // an earlier build is never what gets packed.
      await exec('npm', ['run', 'build'], REPO_ROOT);

      const packDestination = await makeTempDir('pack-');
      const projectDir = await makeTempDir('install-');
      try {
        await exec(
          'npm',
          ['pack', '--ignore-scripts', '--pack-destination', packDestination],
          REPO_ROOT,
        );
        const [tarballName] = await fsp.readdir(packDestination);
        const tarballPath = path.join(packDestination, tarballName);

        await exec('npm', ['init', '-y'], projectDir);
        // `--ignore-scripts` here too: runset ships no install-time scripts of
        // its own, and skipping them keeps this smoke test from depending on
        // whatever install-script policy the environment it runs in has.
        await exec(
          'npm',
          ['install', '--ignore-scripts', tarballPath],
          projectDir,
        );

        // The CLI: on POSIX the installed bin symlink works directly; on
        // Windows it's a `.cmd`/`.ps1` shim, so invoke the shipped JS with
        // `node` instead, per the task's own note on running it that way.
        const runCli =
          process.platform === 'win32'
            ? (args: string[]) =>
                exec(
                  'node',
                  [
                    path.join(
                      projectDir,
                      'node_modules',
                      'runset',
                      'dist',
                      'index.mjs',
                    ),
                    ...args,
                  ],
                  projectDir,
                )
            : (args: string[]) =>
                exec(
                  path.join(projectDir, 'node_modules', '.bin', 'runset'),
                  args,
                  projectDir,
                );

        const version = await runCli(['--version']);
        expect(version.stdout).toMatch(/^v\d+\.\d+\.\d+/);

        const echoed = await runCli(['echo installed-and-runnable']);
        expect(echoed.stdout).toMatch(/installed-and-runnable/);

        // The library: import it from a file that lives inside the installed
        // project, exactly as a real consumer would.
        const importCheckFile = path.join(projectDir, 'check-import.mjs');
        await fsp.writeFile(
          importCheckFile,
          "import runset from 'runset';\nconsole.log(typeof runset);\n",
        );
        const imported = await exec('node', [importCheckFile], projectDir);
        expect(imported.stdout.trim()).toBe('function');
      } finally {
        await fsp.rm(packDestination, { force: true, recursive: true });
        await fsp.rm(projectDir, { force: true, recursive: true });
      }
    },
  );
});
