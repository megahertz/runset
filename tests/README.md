# Tests

The suite started as a port of
[`npm-run-all2`](https://github.com/bcomnes/npm-run-all2)'s tests, rewritten
against runset's own CLI and semantics. This file records what carried over,
what changed shape, and what was dropped.

## Layout

| Path                   | What it covers                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `sequential.test.ts`   | default serial execution, fail-fast, `--on-failure continue`                                            |
| `parallel.test.ts`     | `-p` groups, kill on failure, run-wide `--jobs`                                                         |
| `mixed.test.ts`        | `-p`/`-s` groups in one run, settings entries, linking                                                  |
| `pattern.test.ts`      | glob expansion over `package.json` script names                                                         |
| `placeholders.test.ts` | `{1}`, `{@}`, `{*}`, literal argv and unchanged command names/options                                   |
| `output.test.ts`       | `--stdout` / `--stderr` / `-o`, labels, file destinations                                               |
| `prefix.test.ts`       | automatic prefixes, labels, colours, `formatLabel`                                                      |
| `restart.test.ts`      | unlimited restarts, and the ways a run ends one                                                         |
| `exit.test.ts`         | exit policies, signals and their exit codes, `--kill-timeout`                                           |
| `config.test.ts`       | `runset.config.*`, `commandDictionary`, library API                                                     |
| `run.test.ts`          | `Run.fromConfigJs` without starting, `cwd` resolution                                                   |
| `fail.test.ts`         | bad flags, bad config values, failing commands, exit codes                                              |
| `cli.test.ts`          | help, version, `--cwd`, `--dry-run`, `--log-level`                                                      |
| `pack.test.ts`         | the packed tarball, installed and run — slow, and the only test that touches `dist/` rather than `src/` |

Unit tests for pure helpers live next to the code, in `src/*/__tests__/`; this
directory holds the end-to-end suite.

Each test gets a throwaway copy of `fixtures/workspace`, so the tasks can all
append to the same `test.txt` without the tests colliding — and vitest runs
every test in a file concurrently (`sequence.concurrent`). `helpers/tempDir.ts`
makes the copy, first thing in the test:

```ts
test('…', async () => {
  await using dir = await tempDir();
  await run(['lint'], dir.path);
  expect(await dir.result()).toBe('…');
});
```

`dir.path` is the `cwd` to hand runset and `dir.result()` is whatever the tasks
appended. `await using` removes the copy when the test's scope ends, whether it
passed or threw; set `dir.cleanTempDir = false` to keep it for inspection.
`tempDir` takes a fixture name for the rare test that wants a different one —
`tempDir('no-scripts')`. A helper that only builds a plan and runs nothing can
read the fixture in place via `fixturePath()`.

Nothing is shared between the tests of a file, and that is what keeps them safe
to run at once: a helper takes the `dir` it works on as an argument rather than
closing over one. A test that depends on timing — two tasks overlapping, a
signal landing while a task is up — should wait on something the task says
(`runCliAndKill(…, { after: 'ready' })`) or give the tasks slack
(`RUNSET_TEST_DELAY`), because a start can lag when the whole suite runs at
once.

CLI tests spawn `src/index.ts` directly — Node 24 strips the types, and that one
file is the CLI as well as the library — via `helpers/cli.ts`.

A run started in-process writes to `config.destinations`, which defaults to the
test process's own streams — so its output lands in the middle of vitest's
report. Three ways out, in order of preference:

- `helpers/createRun.ts` is `Run.fromConfigJs` with `destinations` pointed at a
  pair of in-memory streams. `createRun(configJs)` gives back the run and
  `stdout.text` / `stderr.text`, so the test reads what the run printed instead
  of the terminal doing it. runset's own messages go to the `stderr`
  destination, which is how a test asserts on one.
- A test that must go through the public `runset()` cannot reach `destinations`
  — the two call forms are what it is about. There `stdout: 'none'` discards the
  output, which is the documented way to say the run's own output is not the
  question.
- A test that only asks what was _resolved_ — a label, a color, a `cwd` — should
  not start a run at all: `Run.fromConfigJs` settles all of that while it builds
  the plan, and spawns nothing.

## Renamed on the way over

runset has one binary instead of three, and its own names for several flags:

| npm-run-all                    | runset                                          |
| ------------------------------ | ----------------------------------------------- |
| `run-s a b`, `npm-run-all a b` | `runset a b` (serial is the default)            |
| `run-p a b`, `--parallel`      | `runset -p a b`                                 |
| `-c, --continue-on-error`      | `--on-failure continue`                         |
| `--max-parallel <n>`           | `-j, --jobs <n>`                                |
| `--silent`                     | `--log-level error`                             |
| `--aggregate-output`           | `-o grouped`                                    |
| `--race`                       | `--on-success stop`                             |
| `nodeApi(tasks, opts)`         | `runset(commands, config)`, or `runset(config)` |

Every npm-run-all test that exercised the same behaviour under a different name
was kept under the new one — `race.js` included, which now lives in
`exit.test.ts` and `parallel.test.ts` under `--on-success stop`.

## Behaviours that differ on purpose

- **An unknown name is a shell command, not an error.** npm-run-all fails with
  "task not found"; runset detects `npm` vs `shell` by looking the name up in
  `package.json`, so anything that isn't a script is run by the shell and fails
  the way the shell fails it. The npm-run-all cases that asserted a "not found"
  failure were kept — they still fail — but they now document the shell path.
- **No deduplication across patterns.** npm-run-all removes tasks that two
  patterns both match. runset runs what you asked for, in the order you asked
  for it; `pattern.test.ts` pins that down.
- **A killed command reports no exit code.** When runset takes a command down
  because a sibling failed, that command's `exitCode` is `undefined` and it is
  not counted as a failure — the failure that prompted the kill is the one worth
  reporting. The _run_ still reports something: an interrupted run exits 130 or
  143, and a run the library caller terminated rejects rather than resolving.
- **An npm script runs from the package root.** `--cwd` moves where runset looks
  for the `package.json`, not where a script body runs; a shell command runs in
  `--cwd` itself. `run.test.ts` pins both down.

## Dropped as out of scope

These npm-run-all suites test features runset does not have (see
`ai/initial/flags.md` for the flag set, and `ai/future.md` for what is
deliberately deferred):

- `yarn.js` / `--npm-path` — runset runs a script's body in a shell rather than
  shelling out to a package manager, so there is no package manager to point at.
- `node-run.js` — `pre`/`post` script lifecycle is npm's job, not runset's.
- `package-config.js`, most of `config.js` — `npm_config_*` and
  `npm_package_config_*` plumbing comes from npm itself. `cli.test.ts` covers
  the `npm_*` variables runset does set.
- `print-name.js`, `print-label.js`, `color-mode.js` — runset has per-command
  `label`/`color` options instead of `--print-name`/`--color-mode`; the label
  behaviour is covered in `output.test.ts`.
- `{%}`, `{1:-default}`, `{1:=default}` placeholders — runset's placeholder set
  is `{1}`, `{@}` and `{*}`.
