# runset

Run npm scripts and shell commands in parallel or sequence, with glob matching,
reusable pipelines, colored labels, and grouped output. Inspired by
`npm-run-all`, with more control over execution and output.

- **Flexible execution** — mix parallel and sequential steps, with concurrency
  limits
- **Readable output** — colored labels, grouped logs, and output redirection
- **Process control** — stop, continue, or restart on exit, clean up process
  trees on interruption
- **Workspace support**
- **Zero dependencies**

```sh
npm install --save-dev runset
```

Use `runset` in your npm scripts, or run it with `npx runset`:

```sh
npx runset lint test build              # one after another
npx runset -p lint test                 # together
npx runset clean -p lint test -s build  # clean, then lint + test, then build
npx runset -p "watch:**"                # all watch scripts together
```

Each `-p` or `-s` starts a new group. Groups run in order, so in the mixed
example above, build waits for both lint and test to finish.

Use `-j 2` to limit concurrency. Commands in a group run in batches of at most
two, with each batch waiting for all its commands before the next starts.

By default, a failed command stops the run. Ctrl+C stops all running commands
and their child processes.

## Commands

Names are looked up in `package.json` scripts. Other commands run in the shell.
Quote commands that contain spaces or patterns:

```sh
npx runset lint "node scripts/check.js"
npx runset "build:*"    # build:api, build:web
npx runset "build:**"   # also includes build:api:types
```

`*` matches one part of a script name between colons; `**` matches across
colons. A pattern with no matches is skipped.

Pass arguments to a script inside the quotes, or use placeholders for arguments
after `--`:

```sh
npx runset "test --watch"
npx runset "serve --port {1}" -- 8080
npx runset "test {@}" -- --watch --verbose
```

`{1}`, `{2}`, etc. insert individual arguments. `{@}` inserts all arguments
separately; `{*}` joins them into one argument. Placeholder values in command
arguments are quoted automatically for the shell.

Named placeholders read options after `--`: `{port}` takes its value from
`--port 8080` or `--port=8080`. A bare option supplies `true`, which is useful
for conditional commands:

```sh
npx runset "serve --port {port}" -- --port=8080
npx runset lint "test::disabled={noTest}" -- --no-test
```

Without `--no-test`, the missing value makes `disabled` false. Placeholders work
in command arguments and `::` option values, not command names.

Add `::` to set options for one command:

```sh
npx runset -p "api::label=server,color=cyan" web
npx runset "lint::on-failure=continue" build
```

See the [command options](#command-options) and [CLI flags](#cli-flags) at the
bottom for the full reference.

## Workspaces

Use `-r, --recursive` to run a script in every workspace package that has it:

```sh
npx runset -r build                   # packages in sequence
npx runset -rp "test:*" -j 4          # workspace tests, up to four at once
npx runset clean "build::recursive"  # only build expands across packages
```

runset finds the nearest `pnpm-workspace.yaml` or `package.json` with
`workspaces`, starting at the working directory. Workspace patterns support `!`
exclusions. The root package is excluded; packages run in path order, from their
own directories, with package names used for automatic labels. Packages without
the script are skipped. If no workspace package matches, the command resolves
normally as a local script, glob, or shell command.

## Exit behavior

`stop` ends the whole run. `continue` lets it carry on. `restart` runs the
command again without a delay or retry limit.

`--on-failure continue` runs the remaining commands but still exits non-zero if
any command fails. `--on-success stop` ends the run when a command succeeds,
stopping any others still running. Failures produce a summary identifying the
failed commands.

Ctrl+C and SIGTERM stop the command process trees. `--kill-timeout` sets the
grace period before forceful termination (5000 ms by default); a second Ctrl+C
forces termination immediately. A run interrupted by SIGINT exits with 130, or
143 for SIGTERM, unless it was already ending with another result.

## Output

Commands running together get colored labels automatically, so you can tell
which command wrote each line. Automatic labels use the script, program, or
workspace package name; repeated names get suffixes such as `#1` and `#2`. Set
your own with `::label=api,color=cyan`. Use `--color none` for plain text or
`--labels none` to hide labels.

| Label mode | What gets a label                                                               |
| ---------- | ------------------------------------------------------------------------------- |
| `auto`     | Commands sharing a parallel stage, plus any custom labels (default)             |
| `all`      | Every command, including sequential commands                                    |
| `custom`   | Only custom labels; other commands in the same stage leave a blank label column |
| `none`     | Nothing, including commands with custom labels                                  |

runset has 36 label backgrounds for 256-color terminals: 24 soft, vivid shades
with charcoal text and 12 deeper shades with off-white text. `--color <mode>`
(or `color` in a config file) picks how many of them automatic labels use:

| Mode    | Automatic labels                                                                            |
| ------- | ------------------------------------------------------------------------------------------- |
| `auto`  | `soft` on 256-color terminals, `basic` on other color terminals, otherwise `none` (default) |
| `none`  | no color, `[label]`                                                                         |
| `basic` | the terminal's 16 theme colors                                                              |
| `soft`  | the 24 soft shades                                                                          |
| `all`   | the soft and the deeper shades                                                              |

`auto` reads the terminal environment, so `FORCE_COLOR` and `NO_COLOR` apply.
Without an environment override, both stdout and stderr must be terminals for
color to be enabled. Explicit modes override detection. Label colors are chosen
from the label text, with collisions adjusted to distinguish commands.

You can also choose a shade: `"api::label=server,color=ink,bg-color=bgCoral"`.
Available shades are `mint`, `sky`, `rose`, `amber`, `lavender`, `aqua`,
`coral`, `sage`, `periwinkle`, `peach`, `teal`, `lilac`, `lime`, `steel`,
`pink`, `seafoam`, `apricot`, `mauve`, `jade`, `sand`, `iris`, `ice`, `salmon`,
`olive`, `navy`, `plum`, `forest`, `wine`, `ocean`, `indigo`, `copper`, `pine`,
`violet`, `brick`, `slate`, `cocoa`, `ink`, and `paper`. Pair the deeper shades
with `paper`, as in `"api::label=server,color=paper,bg-color=bgNavy"`. For
backgrounds, capitalize the shade and prefix it with `bg`, as in `bgMint`.
Existing names such as `cyan` and `bgBlue` still use your terminal's theme. From
a checkout, run `npm run preview:colors` to see all 36 label pairs.

To keep each command's output together, use grouped output:

```sh
npx runset -p lint test -o grouped
```

Each command's output is buffered and printed when it exits.

`--stdout` and `--stderr` configure streams separately; `-o, --output` sets
both. A value can name a timing (`realtime` or `grouped`), a destination
(`stdout`, `stderr`, `none`, or a file path), or both joined with `+`:

```sh
npx runset -p lint test --stdout grouped+./checks.log
npx runset build --stderr stdout
npx runset "lint::output=none" build
```

The default is realtime output to each stream's usual destination. A value that
sets only timing preserves the destination, and vice versa. Stream-specific
options override `output` in the same scope, regardless of flag order. File
paths resolve against the run's working directory. Each file is overwritten once
per run, and commands writing to the same file share it.

In a config, write `output: 'grouped'` or
`output: { timing: 'grouped', destination: './checks.log' }` — for the whole
run, in a settings entry, or on a single command.

Use `--show-command` to print commands when they start and `--show-exit-code` to
show their status and duration: `✓ 2.1s`, `✗ code 1 · 2.1s`, or
`– stopped · 2.1s`. Failure and stop lines also name the command. These lines
follow the command's stdout settings, including grouping and redirection.

`-w, --wrap` wraps long labelled lines and repeats the label on every line. It
uses the terminal width, or `COLUMNS` when no terminal width is available;
without either, lines stay whole. Wrapping is off by default.

## Config

Save a pipeline in `runset.config.ts`, then run `npx runset`:

```ts
import type { ConfigJs } from 'runset';

export default {
  commands: [
    'clean',
    { parallel: true },
    'lint',
    'test',
    { serial: true },
    'build',
  ],
} satisfies ConfigJs;
```

This runs clean, then lint and test together, then build. Settings entries apply
to the commands that follow them.

The same object may live in a `runset` section of `package.json` instead; a
`runset.config.*` file in the same directory wins over it.

Use `scripts` to give a command or pipeline a reusable name:

```ts
import type { ConfigJs } from 'runset';

export default {
  scripts: {
    check: ['lint', 'test'],
    api: { command: 'node server.js', env: { PORT: '4000' } },
  },
} satisfies ConfigJs;
```

Run these with `npx runset check` or `npx runset api`. Names in `scripts` take
priority over the same names in `package.json`.

Config files also support `.js`, `.mjs`, `.cjs`, and `.json`. runset looks in
the working directory and its parents. CLI commands run **after** any `commands`
listed in the config.

Run-wide CLI flags override config values. Per-command options override the
run-wide defaults. Config keys use camelCase, such as `onFailure`,
`showExitCode`, and `killTimeout`; see the references below.

Set environment variables for every command with a top-level `env` object or
repeatable `-e NAME=value` flags. CLI values override config values for the same
variable. A command can add its own `env` object, as `api` does above. These
settings affect child commands; use `--color` to control runset's own colors.

Config modules can also export a synchronous function receiving
`{ argv, cwd, env }` and returning the config object. Falsy entries in
`commands` are skipped, so lists can contain conditional commands.

Named pipelines can run together: with `api: ['build:api', 'test:api']` and
`web: ['build:web', 'test:web']` in `scripts`, `npx runset -p api web` runs both
builds, then both tests. Both builds must finish before either test starts.

## Library

```ts
import runset from 'runset';

await runset(['lint', 'test', 'build']);
await runset({ commands: ['lint', 'test'], parallel: true, jobs: 2 });
```

The promise resolves with a `Run`, or rejects with a `RunsetError` if the run
fails. Use `Run.fromConfigJs(config)` to prepare a run, `describe()` to inspect
it, `start()` to run it, and `terminate()` to stop it.

## Command options

Use `"command args::option=value,flag"` on the CLI or in config command strings.
The last `::` starts the option list. Boolean options can be bare (`disabled`)
or explicit (`disabled=false`). To pass a literal `::` in the command, append an
empty option list, as in `"perl -MData::Dumper::"`.

Config command objects use camelCase: for example,
`{ command: 'lint', onFailure: 'continue' }`. Settings entries omit `command`
and supply defaults for the following commands.

| Inline option             | Config key  | Meaning                                                                                                                         |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `label=<text>`            | `label`     | Set the output label; preserves spaces. Visibility follows `labels`.                                                            |
| `color=<name>`            | `color`     | Label foreground, such as `cyan`, `ink`, or `paper`; this is a color name, while run-wide `color` is a mode.                    |
| `bg-color=<name>`         | `bgColor`   | Label background, such as `bgBlue` or `bgCoral`. Colors alone do not add a label.                                               |
| `cwd=<dir>`               | `cwd`       | Set the command's directory, relative to the inherited directory. Explicitly setting it overrides the npm package-root default. |
| `disabled[=true\|false]`  | `disabled`  | Skip the command when true; default: `false`.                                                                                   |
| `parallel[=true\|false]`  | `parallel`  | Run alongside adjacent parallel commands. On a named pipeline, run its stages alongside neighboring pipelines.                  |
| `recursive[=true\|false]` | `recursive` | Expand npm scripts across workspace packages; inherits the run-wide setting (default: `false`).                                 |
| `on-success=<action>`     | `onSuccess` | `continue`, `stop`, or `restart`; inherits the run-wide setting (default: `continue`).                                          |
| `on-failure=<action>`     | `onFailure` | `continue`, `stop`, or `restart`; inherits the run-wide setting (default: `stop`).                                              |
| `output=<value>`          | `output`    | Configure both streams using the output syntax above.                                                                           |
| `stdout=<value>`          | `stdout`    | Configure stdout timing and/or destination.                                                                                     |
| `stderr=<value>`          | `stderr`    | Configure stderr timing and/or destination.                                                                                     |
| —                         | `env`       | Object of environment variables added to this command; config only.                                                             |

Settings entries also accept `serial: true` as the opposite of `parallel: true`.
Each settings entry that sets `parallel` or `serial` starts a new group.

For a custom label renderer, set the run-wide, config-only `formatLabel`
function. It receives `{ command, color, defaultPrefix, stream }` and returns
the prefix string, for example:

```ts
formatLabel: ({ defaultPrefix }) => `${new Date().toISOString()} ${defaultPrefix}`,
```

## CLI flags

```text
runset [options] <command...> [-- <placeholder arguments...>]
```

Except for `-p` and `-s`, flags apply to the whole run wherever they appear.
Long flags accept `--name value` or `--name=value`; short flags can be combined,
such as `-rp` or `-j4`. Use `--no-recursive`, `--no-show-command`,
`--no-show-exit-code`, `--no-wrap`, or `--no-dry-run` to disable a boolean
setting from the config. `--no-color` is an alias for `--color none`.

### Execution

| Flag                    | Meaning and default                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `-p, --parallel`        | Start a group that runs the following commands together.                                |
| `-s, --serial`          | Start a group that runs the following commands sequentially (the initial mode).         |
| `-j, --jobs <n>`        | Maximum concurrent commands, run in batches; default: unlimited.                        |
| `-r, --recursive`       | Run npm scripts in every workspace package that has them; default: off.                 |
| `--on-success <action>` | Action after a clean exit: `continue` (default), `stop`, or `restart`.                  |
| `--on-failure <action>` | Action after a failed exit: `stop` (default), `continue`, or `restart`.                 |
| `--kill-timeout <ms>`   | Grace period before forceful termination; default: `5000`. Use `0` for no grace period. |

### Output

| Flag                   | Meaning and default                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `-o, --output <value>` | Set timing and/or destination for both command streams.                                                      |
| `--stdout <value>`     | Set stdout timing and/or destination; default: `realtime+stdout`.                                            |
| `--stderr <value>`     | Set stderr timing and/or destination; default: `realtime+stderr`.                                            |
| `--labels <mode>`      | `auto` (default), `all`, `custom`, or `none`; see the label modes above.                                     |
| `--color <mode>`       | `auto` (default), `none`, `basic`, `soft`, or `all`.                                                         |
| `--show-command`       | Print each command when it starts; default: off.                                                             |
| `--show-exit-code`     | Print each command's exit status and duration; default: off.                                                 |
| `-w, --wrap`           | Wrap long labelled lines, repeating the label; default: off.                                                 |
| `--log-level <level>`  | Filter runset's own messages: `error`, `warn`, `info` (default), or `debug`. Does not filter command output. |

### Configuration and help

| Flag                     | Meaning and default                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-c, --config <path>`    | Load a specific config file instead of searching for one.                                                                                                                                                  |
| `--cwd <dir>`            | Set the run's directory for config/package lookup, shell commands, and relative output paths. Defaults to the current directory; npm scripts run from their package root unless given a per-command `cwd`. |
| `-e, --env <NAME=value>` | Add an environment variable to every command; repeat for multiple variables.                                                                                                                               |
| `--dry-run`              | Print resolved commands, stages, and effective options without running commands.                                                                                                                           |
| `-h, --help`             | Show CLI help.                                                                                                                                                                                             |
| `-v, --version`          | Show the installed version.                                                                                                                                                                                |
| `--`                     | End runset options; remaining arguments supply placeholders. They are not automatically appended to commands.                                                                                              |

## License

[MIT](LICENSE)
