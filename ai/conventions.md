# Conventions

Working rules from [tasks.md](tasks.md). Keep things simple and preserve the
behavior we agreed on.

## Documentation

- When an option changes, update `ai/initial/flags.md` first, then `README.md`
  and `ai/initial/api-and-design.md`.
- Some repetition between these docs is fine for now.

## Code and API

- Keep the public API small: anything we expose becomes something we must
  support. Don't add public methods just for tests; mark test-only access as
  internal.
- Keep `Run` limited to `config`, `start()`, `terminate()`, `describe()`,
  `isFailed()`, and `getExitCode()`.
- Share helpers instead of copying them. A helper lives in the stage that owns
  it — `config/`, `plan/` or `run/` — and imports only point downstream:
  `types.ts`/`errors.ts` ← `config/` ← `plan/` ← `run/` ← `cli.ts`/`index.ts`.
  There is no `util/`.
- Comments are short and say why, not what. Design rationale belongs in `ai/`.
- Store internal command details on the command itself, but keep them out of the
  public API and output.
- Use simple validation functions. Check conditions directly instead of catching
  errors to decide what happens next.
- Split files when needed to avoid circular imports. Use named intermediate
  values when they make code easier to read.
- Read CLI arguments once. Handle `--help` and `--version` before loading the
  config, so they work even when the config is broken.

## Behavior

- Settings should have a visible effect or give a clear error, never silently do
  nothing.
- Split `::` options before filling in placeholders, so values containing commas
  or equals signs stay values.
- `describe()` and `--dry-run` only show the plan. Write it directly to stdout,
  without the logger.

## Tooling

- Test the exact minimum Node version in CI (`24.2`, not just `24`).
- Use `npm run format` to fix formatting, including Markdown.
