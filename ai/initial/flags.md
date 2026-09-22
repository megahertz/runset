# Flags

## Precedence

Run-wide options resolve in this order (first wins):

CLI flag → config file → built-in default.

Per-command options are layered separately, by normalization, and there the
order is:

per-command trailing `::opt` → `commandDictionary` entry → a settings entry
written earlier in the same list → the list the command sits in → the run-wide
option → built-in default.

The two lists meet at "the run-wide option": whatever `Config` settled — from a
flag, from the config file, or from the default — is the floor a command builds
on. Run-wide-only options such as `--jobs` appear in the first list and never in
the second; there is no such thing as one command's `jobs`.

The schema is flat. There is no nested `options` block in a config file: `jobs`,
`onFailure` and `commands` are siblings.

## Output

- `--stdout <value>` — configure the stdout stream
- `--stderr <value>` — configure the stderr stream
- `-o, --output <value>` — apply `<value>` to both streams

`<value>` combines two orthogonal axes with `+` (order-independent):

- **timing**: `realtime` (default) | `grouped` (buffer, print on exit)
- **destination**: `stdout` | `stderr` | `none` (discard) | `<file path>`
  (anything else; a file called `none` is `./none`)

Redirecting a stream to itself is a no-op. Examples:

| Value            | Meaning                     |
| ---------------- | --------------------------- |
| `grouped`        | buffer, print on exit       |
| `stderr`         | redirect to stderr          |
| `./build.log`    | redirect to a file          |
| `none`           | discard                     |
| `stderr+grouped` | buffer, then emit on stderr |

Per-command: `runset lint::stdout=stderr+grouped`.

The two axes are independent, and a value that names only one of them says
nothing about the other. That matters where settings layer: over a dictionary
entry's `stdout: './alias.log'`, `alias::stdout=grouped` changes the timing and
leaves the file alone.

### Files

A destination that is neither `stdout` nor `stderr` is a file path, resolved
against the **run's** directory rather than the command's — a log named on the
command line is written where it was typed, not wherever a particular command
happens to run.

A file is opened once per run, by whichever command writes to it first, and
every command pointed at the same path shares that handle. So a new run starts
the file over, and the commands of one run combine into it rather than
truncating each other.

A file that cannot be written ends the run, whatever `--on-failure` says:
`--on-failure` is about a command that fails, and a log going nowhere is the
run's own problem — every command writing there would share it. The run exits
non-zero and says which path it was.

`runset` does not settle until what was written is actually on disk, so a script
that runs runset and then reads the log finds the whole of it there.

## Prefixes and color

- `--labels <mode>` — `none` | `auto` (default) | `custom` | `all`

A command is prefixed exactly when it has a label. Under `auto`, a prefix
appears wherever output interleaves — on any command sharing a stage with
another — and nowhere else. Each prefixed command is labelled with its own name
(repeats are numbered `name#1`, `name#2`), padded to one width, and tinted with
a color of its own:

```
api  request 1
dash rebuild 1
```

The label picks the color, not the order the commands were written in, so `db`
is the same color in this run as in the last one and in the project next door.
Two labels in one run that want the same one are pulled apart — telling them
apart is the whole point — and a color you chose yourself is never handed to
anything else.

A `label` of your own always prints. In a stage where one command has a label,
the others get a blank one instead of their name, holding the column open so the
output lines up. `color` and `bgColor` only style a label; they never add one.

| Mode     | Labelled                                          |
| -------- | ------------------------------------------------- |
| `none`   | nobody, not even a command given a `label`        |
| `auto`   | commands given a `label`, and any sharing a stage |
| `custom` | only commands given a `label`                     |
| `all`    | every command, by its name unless given a `label` |

Per-command options:

| Option    | Meaning                                            |
| --------- | -------------------------------------------------- |
| `label`   | the text in the prefix, instead of the script name |
| `color`   | foreground, e.g. `white`, `black`, `redBright`     |
| `bgColor` | background, e.g. `bgGreen`, `bgBlue`               |

```
$ runset -p "api::label=api,color=white,bg-color=bgGreen" dash
```

Names are the ones `node:util`'s `styleText` knows; an unrecognised one is
ignored rather than fatal. With color off (`--no-color`, a pipe, `NO_COLOR`) a
prefix falls back to `[label] `, so redirected output stays just as readable.

A prefixed line is written only once it is whole: a half-written line waits for
its newline (or for the command to exit) rather than being landed on by the next
command to write. Unprefixed output is passed straight through, as before.

### A prefix of your own

A JS or TS config file — or a library caller — may render the prefix itself with
`formatLabel`, which is asked once per line and handed runset's own answer to
decorate:

```js
module.exports = {
  formatLabel: ({ command, color, defaultPrefix, stream }) =>
    `${new Date().toISOString().slice(11, 23)} ${defaultPrefix}`,
};
```

It is only ever called for commands that have a label.

## Run mode

- `-p, --parallel <tasks>` — run tasks in parallel (`runset -p foo bar`)
- `-s, --serial <tasks>` — run tasks in sequence (`runset -s foo bar`)
- `-j, --jobs <n>` — max parallelism (default: unlimited)

Each `-p`/`-s` opens a group as well as naming one, so `-p foo -p bar` is two
groups rather than one long one, and the groups run in the order they were
typed.

A config file writes the same flag down as an entry with no `command` in it,
where the flag would have gone:

```js
commands: [
  'clean',
  { parallel: true },
  'lint',
  'test',
  { serial: true },
  'build',
];
```

That is `runset clean -p lint test -s build`, character for character in effect:
the parser turns each flag into exactly this entry, so a pipeline moves between
the command line and a config file without changing shape. An entry settles the
defaults for the entries after it — as far as the end of the list it was written
in — and a command that says otherwise for itself still outranks it. An entry
that says nothing about the mode (`{ cwd: 'services/api' }`, `{ env: … }`,
`{ onFailure: 'continue' }`) settles defaults without touching the shape of the
run.

`parallel` marks a _group_, and every command in the group says it:

```js
commands: ['lint', 'build:api::parallel', 'build:web::parallel', 'deploy'];
```

One command saying it on its own has nothing to join, and runs where it stands.
That is not worth complaining about: a glob that matched once, a neighbour that
was `disabled`, and `runset -p build` itself all arrive there honestly.

`--jobs` caps how wide a stage may run. A stage with more commands in it than
the budget is run in **batches** of that many, in the order the commands were
written, each batch waiting for the whole of the one before it. Two named
parallel pairs under `--jobs 2` therefore peak at two commands, not four.

Batches rather than a pool of slots is deliberate: a run is already a list of
waits, and this is one more of the same kind. The price is that a batch waits
for all of itself, so a slow command keeps the share of the budget it was given
rather than handing it to the next command in line.

A config file may also set `parallel` run-wide, as the default for every command
in the run:

```js
module.exports = { commands: ['lint', 'test', 'build'], parallel: true };
```

It is a default, not a decree — any command, list, or settings entry that says
`parallel` for itself overrides it.

### Pipelines

A run is stages, which says everything except one thing: two sequences running
side by side. Give each a name — a `commandDictionary` entry may be a whole list
— and say `parallel` about the name. The flag describes the list, not the
commands in it, so the order inside each one is left alone:

```js
module.exports = {
  commandDictionary: {
    api: ['build:api', 'test:api'],
    web: ['build:web', 'test:web'],
  },
  commands: ['api::parallel', 'web::parallel'],
};
```

The two lists are laid over the same stages: `build:api` and `build:web` run
together, then `test:api` and `test:web`. Which is worth reading twice —
`test:api` starts when **both** builds are done, not when its own is. A stage is
the unit a run waits on, and there is nothing finer.

A name is the only way to write it. `commands` is flat — a list inside it is not
a thing — because the same run is already spellable there, phase by phase
instead of branch by branch:

```js
commands: [
  { parallel: true },
  'build:api',
  'build:web',
  { parallel: true },
  'test:api',
  'test:web',
];
```

Both spell one table of stages, and a run is that table and nothing else. The
named form is for when the branches are long enough to want reading down rather
than across — and for when one of them is worth reusing, or wants a `cwd` of its
own.

## On exit

What a command's exit does to the run, set per command or run-wide:

- `--on-success <action>` — for a clean exit. Default: `continue`
- `--on-failure <action>` — for a non-zero exit. Default: `stop`
- `--kill-timeout <ms>` — grace period before a `SIGKILL`. Default: `5000`

| Action     | Meaning                                                  |
| ---------- | -------------------------------------------------------- |
| `continue` | nothing; whatever else is running carries on             |
| `restart`  | run the command again until the run is stopped           |
| `stop`     | the run is over — everything still running is terminated |

The policy belongs to the command that exited, so one command may end a session
while another is free to come and go:

```
$ runset -p "npm start::on-success=stop" "tail -f app.log::on-success=continue"
```

`stop` reaches the whole run, not just whatever was waiting on the command, and
it needs no exit code of its own: the run's code still comes from the first
command that _failed_, so stopping on a clean exit ends the run at zero.

The two combinations people reach for are spelled out rather than abbreviated:
`--on-failure continue` carries the run on past a failure (it still exits
non-zero), and `--on-success stop` makes whichever command finishes first end
the session.

`restart` is unlimited, with no counters, cap, health-based budget reset or
delay between the attempts. Stopping the run is what ends them.

```sh
runset "npm start::on-failure=restart"
```

### Ctrl+C

A `SIGINT` or `SIGTERM` aimed at runset is passed on to every command still
running — the same signal, not a translation of it, so Ctrl+C reaches the
commands as the SIGINT they are written to expect. runset says so first, in
yellow, answering the `^C` on the line the terminal echoed it onto:

```
^C runset: SIGINT received, stopping the run
```

It matters more than it looks: without it the next thing on screen is some
command's parting words — which read as if they were the reason the run ended
rather than a consequence of it.

An interrupted run is not a run that succeeded, whatever its commands managed
before the signal reached them. runset exits the way a shell reports a signal —
**130** for `SIGINT`, **143** for `SIGTERM` — so `runset build && deploy` does
not deploy because the build was Ctrl+C'd. That holds even under
`--on-failure continue`, where an earlier failure had not stopped the run: the
signal is what ended it, and the signal is what it reports.

A run that was _already_ ending because something failed keeps that failure's
exit code. The Ctrl+C only hurried along a run that was over anyway, and the
failure is still the more useful answer to "why did this stop?". By the same
token, an `--on-success stop` run that ended cleanly still exits 0.

### When a command will not stop

A signal can only ask. A command with a handler that never exits would hold the
run open for good, so `--kill-timeout` is how long it has to act on being asked
— 5000 ms by default — after which everything still running is sent `SIGKILL`.
`--kill-timeout 0` leaves no grace period at all.

A second Ctrl+C does not wait for the timeout:

```
^C runset: SIGINT received, stopping the run
^C runset: SIGINT again, killing what is left
```

The second signal never changes the verdict; all it does is stop waiting.

Because every command runs in a shell, and a shell may have started more
processes of its own, runset takes down the whole process tree rather than the
shell alone — a process group on POSIX, `taskkill /T` on Windows. A watcher does
not get to keep the port it was holding.

## General

- `-c, --config <path>` — load a config file (skips the default lookup)
- `--cwd <dir>` — working directory for tasks
- `--color` / `--no-color` — force color on/off. Priority: CLI flag >
  `FORCE_COLOR` / `NO_COLOR` env > tty autodetection
- `--log-level <level>` — `error` | `warn` | `info` (default) | `debug`
- `--dry-run` — print the resolved process tree and options; run nothing

`--color` autodetection asks about every stream the run will write to, not just
one: runset's own messages go to stderr while the commands' output goes to
stdout, and escape codes are only wanted where something is there to render
them. Either of them being a file or a pipe settles it for both.

### `--dry-run`

A dry run prints the resolved commands **and every option in force** — run-wide
first, then, stage by stage, everything that was settled about each command: the
line that will actually be handed to the shell, the directory it will run in,
both exit policies, the restart settings, both streams, whether it is prefixed
and under what label and colour, and any `env` entries it added. The environment
runset itself was started with is deliberately left out; it is not something the
user wrote, and printing it would bury what is.

The rendering _is_ what a dry run produces, so it goes to **stdout** rather than
through the logger: `runset --dry-run … > plan.txt` saves the plan, and
`--log-level error` does not throw it away.

```
$ runset --dry-run "test-task:append a" -p "echo b" "echo c"
Options:
  cwd            /project
  jobs           unlimited
  parallel       false
  on-success     continue
  on-failure     stop
  kill-timeout   5000ms
  stdout         realtime -> stdout
  stderr         realtime -> stderr
  labels         auto
  color          false
  log-level      info

Commands:
  stage 1:
    - test-task:append a (npm)
        line           node tasks/append2.mjs a
        cwd            /project
        on-success     continue
        on-failure     stop
        stdout         realtime -> stdout
        stderr         realtime -> stderr
  stage 2:
    - echo b (shell)
        …
    - echo c (shell)
        …
```

The stages are the run's whole shape — they happen one after another, and what
is in one happens at once — so the plan is drawn the way the run will go rather
than the way the commands were typed.

### Working directories

`--cwd` sets where the run happens: it is the directory the config file and the
`package.json` are looked for from, the directory relative output paths resolve
against, and the directory shell commands run in. It is resolved once.

An **npm** command is the exception. Its body was written against the package
root — `node ./scripts/build.js` means _that_ package's `scripts/` — so runset
runs it from there, the way `npm run` does. `--cwd` moves where runset looks for
the package, not where a script runs.

A command may name a `cwd` of its own, and a `cwd` aimed at a named list passes
down into it, so they nest: a list run in `services` holding a command in `api`
runs it in `services/api`, relative to the run's directory. An explicit `cwd`
outranks the package-root rule, npm command or not.

### Values a config file writes by hand

A config file is arbitrary JavaScript, so `jobs: 'many'` arrives as the string
it is. Both the run-wide options and every resolved command are checked before
anything spawns — types and ranges, not just spelling — because a run that took
that at its word would sit there with no workers at all, looking for all the
world like a run with nothing to do. An object command is held to the same rules
as the inline `::` spelling: `{ command: 'x', onFailure: 'invalid' }` is refused
rather than silently never matching anything. `Infinity` stays allowed; it is
how "no limit" is spelled.

### How an error spells an option

Each message names the option the way the source it came from writes it. A
run-wide option is `jobs`, `killTimeout`, `logLevel` — camelCase, because almost
every one of them is both a flag and a config key, and the config key is the
spelling that is always available. A per-command option is `on-failure`,
`bg-color`, `on-success` — kebab-case, because the source there is nearly always
the `::` string, which is written that way.

The price is paid by the command line: `runset --on-success halt` answers
`onSuccess is one of continue, restart, stop`, naming an option the user just
typed differently. That is accepted rather than fixed — a message that changed
its spelling depending on which of three places a value came from would be
harder to recognise, not easier.

## Task syntax

A task argument: `command args::option1=value1,option2=value2,boolFlag`

The **last** `::` in a task is the separator. Everything after it is runset's
option list, running to the end of the argument; everything before it is the
command, spelled the way it would be typed into a shell:

```
$ runset "serve --port 80::label=api "
```

Options last rather than wedged after the command name is what keeps a long task
readable, and it is why a value can keep the spaces it was written with — the
list ends where the argument ends, so nothing has to guess. That example labels
the command `api `, for lining it up with a four-character neighbour. Only
`label` keeps its spaces; every other value is a keyword, and is trimmed.

A command carrying a `::` of its own ends with one to say so — an empty option
list is still an option list, so it takes the separator's job and leaves the
rest of the command alone:

```
$ runset "perl -MData::Dumper::"
```

```
$ runset --serial clean lint "build:**"
$ runset --parallel "watch:**"
$ runset clean lint --parallel "build:** -- --watch"
```

Globs match script names: `watch:*` runs `watch:server` and `watch:browser`;
`watch:**` also runs deeper matches like `watch:server:s3`.

## Quoting on Windows

`cmd.exe` doesn't strip single quotes, so `runset 'npx howfat'` arrives split.
runset re-groups `'…'` tokens itself (win32-gated). Interior whitespace
collapses to single spaces — use it for grouping commands, not preserving exact
spacing. Double quotes are handled by `cmd.exe` directly.

An opening quote with nothing to close it is an error, raised before any command
starts rather than left to produce a command nobody wrote.

## Per-command environment

A command may add to the environment it runs in. There is no CLI spelling — it
is an object, so a config file or a library caller sets it:

```js
commands: [
  { command: 'npm start', cwd: apiDir, env: { PORT: '4000' } },
  { command: 'npm start', cwd: dashDir, env: { API_URL: 'http://localhost:4000' } },
],
```

What a command adds sits on top of the environment the run was given; an `env`
aimed at a named list passes down to the commands in it, and a command that
names its own replaces it rather than merging.

## Placeholders

Placeholders pull from the args passed to runset, and are quoted so that a value
reaches the command as the literal text it is.

Quoting, not merely surrounding with double quotes: runset builds a command
_line_ and gives it to a shell, so `$(…)`, backticks and `${…}` all still run
inside double quotes. A value is quoted the one way each shell has of meaning
"literally this" — single quotes on POSIX, and on Windows the two-layer escape
`cmd.exe` needs. `runset "deploy {1}" -- '$(rm -rf /)'` passes that string to
`deploy`; it does not run it.

Substitution happens in the argument portion of a command and in the values of
its `::` options. A command's **name** is literal — it is about to be read back
as a script name, a dictionary key, a glob or a shell command, and four
different outcomes from one string is not a feature.

### Positional

```
$ runset build "start-server -- --port {1}" -- 8080
```

- `{1}`, `{2}`, … — the Nth argument after `--`
- `{@}` — all arguments, each quoted on its own
- `{*}` — all arguments joined into one quoted argument

Everything after `--` is passed through literally, including long flags,
negative numbers, empty arguments and another `--`.

### Named

`{name}` answers with whatever `--name` was given after the `--`. There is no
schema to declare and no types: `--name=value` and `--name value` both answer
with the value, a bare `--name` answers `true`, and either spelling of the name
finds the other — `{noTest}` answers to `--noTest` and to `--no-test` alike.

```
$ runset lint "test::disabled={noTest}" -- --noTest
```

That is what the two readers differ over. An option's value is runset's own to
read, so a name nothing was passed for is simply empty — which is what makes
`disabled={noTest}` false when the argument never arrived. A command line is not
runset's to rewrite: there, an unmatched `{…}` is left exactly as written,
because a command line is full of braces that were never placeholders —
`${HOME}` above all.

Because everything after `--` stays literal, `-- --noTest 8080` answers both
`{noTest}` with `8080` and `{1}` with `--noTest`. One list, read two ways.

### From `npm run`

Useful to forward args through an npm script:

```json
{
  "scripts": {
    "start": "runset build \"start-server -- --port {1}\" --"
  }
}
```

```
$ npm run start 8080
```
