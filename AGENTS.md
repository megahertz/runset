`runset` is a CLI task runner for npm scripts — runs them in parallel or in
sequence, with glob matching and reusable pipelines. A more capable
`npm-run-all`.

- **Planning docs:** @ai/initial/description.md — goals, non-goals, and
  constraints; @ai/initial/api-and-design.md — core types and API design;
  @ai/initial/flags.md — CLI flags and their semantics; @ai/initial/fragments/ —
  sketches and ideas borrowed from other projects for reference; @ai/future.md —
  deferred ideas that may never ship.
- **TypeScript, ESM only.** Keep imports explicit with `.ts` extensions;
  `tsdown` resolves them when it bundles.
- **One file ships.** `tsdown` rolls `src/` into `dist/index.mjs`, which is both
  the `bin` and the library entry — `src/index.ts` runs the CLI when
  `import.meta.main` says it is what node was asked to run, and is only exports
  otherwise.
- **Keep `src/` type-strippable.** The tests run `src/index.ts` through Node
  directly, so avoid syntax Node's strip-only mode rejects: no constructor
  parameter properties, no `enum`, no namespaces.
- Keep constants local or inline unless shared across functions or expensive to
  recreate on a hot path.
- Prefer Node built-ins (`node:child_process`, etc.); keep runtime deps light —
  this is a foundational dev tool.
- Tooling: `tsdown` (build), `tsc` (typecheck), `oxlint` + `oxfmt`
  (lint/format), `vitest` (test). Full validation is `npm run check` — run it
  after every significant change.
