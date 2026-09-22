# runset

`runset` is a CLI task runner for npm scripts — a more capable alternative to
`npm-run-all`. It runs the scripts defined in a project's `package.json` in
**parallel** or in **sequence**, with glob matching and reusable pipelines.

## Goals

- Run multiple npm scripts with one command, in parallel or in sequence.
- Match script names with **glob patterns** (e.g. `runset "build:*"`).
- **Smart output** — prefixed, colored, interleaved or grouped per task.
- **Fail-fast** or **continue-on-error** per run.
- Reusable pipelines via a config file (`runset.config.[js|cjs|mjs|ts|json]`).

See [future.md](../future.md) for ideas deliberately left out of the core goals.

## Non-goals

- Not a general-purpose build system or a replacement for `make`.
- Not a package manager; it orchestrates scripts, it does not install anything.

## Constraints

- TypeScript, ESM only. Node >= 24.2.
- Dependency-light: prefer Node built-ins (`node:child_process`, `node:util`, …)
  over third-party packages.
