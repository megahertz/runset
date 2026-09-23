# API and design

## Pipeline

```
ConfigJs (loose file/lib input)  ─┐
CLI argv ──────────────────────── ┼─ createConfig ─►  Config  ── createPlan ─►  Plan  ── new Run ─►  Process[]
env ─────────────────────────────┘                (strict, resolved)       { config, packageInfo, commands }
```

Three steps, each one function:

```ts
const config = createConfig({ cli, cwd, env, destinations, configJs }); // every field optional
const plan = createPlan({ config });
const run = new Run(plan);
```

`createPlan` is itself a pipeline over the `Plan`: `normalize` produces the
commands, then each step settles a little more of them —

```ts
const plan = { config, packageInfo, commands: normalize(config, packageInfo) };
assignAutoLabels(plan); // who is labelled, per `config.labels`; names numbered apart
colorLabels(plan); // a palette pair for every label with no colors of its own
alignLabels(plan); // pad every label to one width
```

- **`ConfigJs`** — the loose input schema: what a user writes in
  `runset.config.*` and what a library caller passes to `runset({...})`.
  Everything optional, unions and falsy entries allowed.
- **`Config`** — the strict, resolved object passed across the whole app. Same
  flat shape as `ConfigJs`, but with defaults filled and options resolved.
- **`CommandDefinition`** — a loose, still-unresolved command (from the config
  or CLI). Normalized later into a strict **`Command`**.

Nothing in the pipeline is a tree. A run is a flat list of commands laid out in
**stages**: the stages happen one after another, and everything in a stage
happens at once. That is the whole of a run's shape, and `parallel` is the only
thing that decides it — whether a command joins the stage in front of it or
opens one of its own.

## Command

`CommandDefinition` is the loose form (a bare string, a partial leaf, or a
list). Normalization turns it into a strict `Command`.

```ts
type Std = ...; // stream config: timing (realtime|grouped) + destination (stdout|stderr|none|<path>)
type ExitAction = 'continue' | 'restart' | 'stop'; // what an exit does to the run

// Loose: what config / CLI produce. Flat — a list is not one of these; the
// only place a list may appear is `commands` itself, or a `scripts` entry.
type CommandDefinition =
  | string
  | false | null | undefined                        // for `shouldLint && {...}`
  | CommandEntry                                     // one command: has `command`
  | CommandSettings;                                 // `-p`/`-s` written down

// Strict: produced by normalization. Flat — one of these per command, in the
// order they were written.
interface Command {
  stage: number;            // which stage of the run this command belongs to
  command: string;          // the command line as written, placeholders filled
  line: string;             // what is handed to the shell: for npm, the script body
  script?: string;          // the package.json script name, when type is 'npm'
  type: 'shell' | 'npm';    // detected at runtime by reading package.json scripts
  stdout: Std;
  stderr: Std;
  label: string;            // printed before each output line when non-empty
  color: string;            // default ''
  bgColor: string;          // default ''
  parallel: boolean;        // what `stage` was derived from; the config's, itself false
  onSuccess: ExitAction;    // what a clean exit does; default 'continue'
  onFailure: ExitAction;    // what a non-zero exit does; default 'stop'
  disabled: boolean;        // default false
  cwd: string;              // absolute, resolved against the cwd it inherited
  env: NodeJS.ProcessEnv;   // added on top of the run's own environment
}
```

`CommandOptions` is `Command` without the parts normalization owns (`stage`,
`line`, `script`, `type`), all optional, and with the stream settings loosened:
a user may write `stdout: 'grouped'`, or a `Partial<Std>` naming one axis and
leaving the other to whatever it layers onto. `CommandEntry` is that bag with a
`command`; `CommandSettings` is that bag without one, plus `serial`.

The two object forms are told apart by `command` and by nothing else, so a
misspelled `commnad` is a settings entry carrying an unknown key — refused —
rather than a command that quietly never runs. A settings entry settles the
defaults for the entries written after it, as far as the end of the list it was
written in; `{ parallel: true }` is `-p` and `{ serial: true }` is `-s`, and
either of them closes the group in front of it the way the flag does.

- `stage` is the only structure a run has. The commands come back sorted by it,
  so a stage is always a run of neighbours and everything downstream — the
  scheduler, the prefix pass, the dry run — is a single scan.
- `type` is not written by the user — normalization reads `package.json` scripts
  to decide whether a token is an `npm` script or a raw `shell` command. `line`
  follows from it: a shell command is already its own line, while an npm one
  runs the script's body with the token's arguments appended, the way
  `npm run --` does.
- `cwd` is absolute by the time it is here. A command's or a list's own `cwd` is
  resolved against the one it inherited, so directories nest the way the
  commands were written; and an `npm` command with no `cwd` of its own runs from
  the package root rather than from the run's `cwd`, because that is the
  directory its body was written against.
- `onSuccess` / `onFailure` belong to the command that exited, not to anything
  around it. `stop` ends the whole run — a `RunContext.requestStop()` callback
  into Run — and `restart` is handled inside `Process.start`, so a restart is
  the same `Process` spawning another child and nothing above it ever learns of
  it.
- A command is prefixed exactly when its `label` is non-empty, and the run-wide
  `labels` mode settles who gets one, in a pass over the finished list. Under
  `auto` a command with no label that shares a stage is named after itself, even
  when someone in that stage has a label of their own; under `custom` it gets a
  blank one instead, which only holds the column. The same pass numbers invented
  repeats apart, pads them to one width, and gives each a `color`/`bgColor` its
  label picked out of the palette — the same label lands on the same color in
  every run, and two labels that want one entry are pulled apart so they still
  read as two.
- A config's `formatLabel` renders the prefix in place of runset's own, and is
  asked once per line so it may carry a clock or a counter:

  ```ts
  type LabelFormatter = (context: {
    command: Command; // `label` already padded
    color: boolean; // whether ANSI color is wanted
    defaultPrefix: string; // runset's own answer, to decorate
    stream: 'stderr' | 'stdout';
  }) => string;
  ```

## Process / schedule

`Process` is internal. It spawns a command, handles unlimited restarts, and
terminates its process tree when requested. There is no shared Executable
interface or StopSignal class: Run owns the stopping state and supplies a
`requestStop()` callback to processes.

```ts
/** Runs the stages one after another, everything in a stage at once — or, when
 *  `jobs` is narrower than the stage, in batches of that many. */
function schedule(
  processes: Process[],
  stopped: () => boolean,
  jobs: number,
): Promise<void>;
```

```ts
interface TerminateOptions {
  force?: boolean; // SIGKILL instead of asking
  signal?: NodeJS.Signals; // what to send; default SIGTERM
}
```

There is no group class and nothing that owns a subset of the run: `schedule` is
one loop over the stages, each a `Promise.all` of the commands in it. A stage
waits for the whole of the stage before it, which is the one thing a run knows
how to wait for.

`terminate()` sends SIGTERM, `terminate({ force: true })` sends SIGKILL, and
`signal` names another one. A run stopped by a signal of its own passes that
signal on rather than translating it: Ctrl+C reaches the commands as SIGINT,
which is the event a program that handles only one of the two is likeliest to be
listening for. `stop` policies and a bare library `terminate()` still mean
SIGTERM.

Sending it is all a signal can do, so the `Run` starts a clock on it: after
`killTimeout` everything still running is terminated with `force`, and a second
signal from outside does the same without waiting. A command is killed as a
process group on POSIX and with `taskkill /T` on Windows, because `shell: true`
means it may have started processes of its own.

Nothing throttles except `--jobs`, and it is `schedule` that applies it: a stage
wider than the budget is run in batches of that many rather than all at once. It
is the same loop either way, which is the whole reason for spelling it there —
no queue, no slots, nothing shared between the commands. A batch waits for all
of itself, so a slow command holds its share of the budget until the batch is
done; and a batch the run stops before it starts never starts.

## ConfigJs

The config-file / library-input schema. `runset.config.[ts|js|mjs|cjs|json]` may
export this object directly, or a **sync function** that returns it.

```ts
interface ConfigJs {
  // run-wide options (flat — no nested `options` block)
  jobs?: number; // max commands running at once, run-wide; default Infinity
  killTimeout?: number; // ms from SIGTERM to SIGKILL; default 5000
  onSuccess?: ExitAction; // default 'continue'
  onFailure?: ExitAction; // default 'stop'
  color?: ColorMode; // 'auto' | 'none' | 'basic' | 'soft' | 'all'; default 'auto'
  parallel?: boolean; // the default `parallel` for every command; default false
  labels?: 'none' | 'auto' | 'custom' | 'all'; // who is labelled; default 'auto'
  wrap?: boolean; // wrap labelled lines to the terminal; default false
  formatLabel?: LabelFormatter; // renders the prefix; asked once per line
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  dryRun?: boolean; // print the resolved commands and run nothing
  env?: Record<string, string>; // added to every command's environment
  output?: Partial<Std> | string; // both streams; stdout / stderr outrank it
  stdout?: Partial<Std> | string;
  stderr?: Partial<Std> | string;
  cwd?: string;

  commands?: CommandDefinition[]; // the default pipeline
  // A reusable command, or a whole list of them under one name — the only
  // place a list may appear other than `commands` itself.
  scripts?: Record<string, CommandDefinition | CommandDefinition[]>;
}

// The module may export the object or a sync function returning it.
type ConfigJsExport =
  | ConfigJs
  | ((ctx: {
      argv: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
    }) => ConfigJs);
```

Example `runset.config.js`:

```js
module.exports = {
  jobs: 8,
  commands: [
    'build',
    'oxfmt::parallel',
    { command: 'oxlint', parallel: true },
    { serial: true },
    'test',
  ],
  scripts: {
    build: { command: 'tsc', parallel: true },
  },
};
```

## Config

The strict, resolved counterpart of `ConfigJs` — same flat fields, defaults
filled, options resolved. Constructed synchronously.

```ts
class Config {
  commands: CommandDefinition[]; // [...file.commands, ...argvCommands], still loose
  scripts: Record<string, CommandDefinition>;
  args: ParsedArgs; // literal positional arguments after --
  cwd: string; // resolved absolute cwd
  env: NodeJS.ProcessEnv; // the process's, then file `env`, then `--env`

  jobs: number; // default Infinity
  killTimeout: number; // ms; default 5000
  onSuccess: ExitAction; // default 'continue'
  onFailure: ExitAction; // default 'stop'
  color: ColorLevel; // the mode, `auto` resolved from env / the destinations below
  parallel: boolean; // default false
  labels: LabelMode; // default 'auto'
  formatLabel: LabelFormatter | undefined;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  dryRun: boolean;
  stdout: Std;
  stderr: Std;
  destinations: Destinations; // where the run writes; defaults to the process's

  validate(): void; // throws on the first hard error
}

// Parses, loads and validates. Everything left out comes from the process.
function createConfig({
  cli = parseCli(process.argv.slice(2)),
  configJs, // given → no config-file lookup
  cwd = process.cwd(),
  destinations = process, // its stdout / stderr
  env = process.env,
}?: ConfigOptions): Config;
```

### Initialization

`createConfig` is a plain **synchronous** function:

1. **Resolve the config source.** If `configJs` is passed (library caller), use
   it. Otherwise find `runset.config.[ts|js|mjs|cjs|json]` starting at `cwd` and
   **walking up parent directories**, first match wins. A `package.json` with a
   `runset` section (the `runset.config.json` shape) counts as a match too; a
   `runset.config.*` in the same directory beats it. `--cwd` sets the starting
   directory. `-c, --config <path>` skips the lookup entirely; a missing
   explicit file is a hard error, a missing default file yields an empty config.

   Parse argv once before loading the file. All flags are built in; tokens after
   `--` are literal task arguments. The parsed `--cwd` and `--config` determine
   the config source, including attached and clustered short values.

2. **Load it** with `importSync` (a `createRequire`-based sync `require`;
   handles CJS, JSON, and — via Node 24's `require(esm)` + TS type-stripping —
   the rest). Unwrap `moduleLoaded.default` if present. If the export is a
   **function**, call it (sync) with `{ argv, cwd, env }` to get the `ConfigJs`
   object.
3. **Merge commands**: `[...file.commands, ...argvCommands]`; falsy entries
   filtered.
4. **Resolve run-wide options** with precedence `CLI flag → config → default`,
   and retain the positional arguments from the initial parse.

5. **Validate** the run-wide values (`config.validate()`).

Parsing argv or loading a config may throw on the way; "no commands at all" is
`createPlan`'s to refuse, so the CLI can still answer a bare `runset` with help.
The CLI prints collected warnings after building the run. Classification:

| Situation                           | Handling                           |
| ----------------------------------- | ---------------------------------- |
| Unknown key in the config file      | warn, ignore                       |
| Unknown CLI flag                    | throw                              |
| Invalid value (bad type / bad enum) | throw                              |
| `--config <path>` missing           | throw                              |
| No commands at all                  | throw                              |
| Config-file `require` throws        | throw (surface underlying message) |

```ts
/**
 * Synchronously load a CJS or JSON module by path — the sync counterpart of
 * `import()`. Relative paths resolve from the current working directory.
 */
export function importSync<T = unknown>(modulePath: string): T {
  return require(path.resolve(modulePath)) as T;
}
```

### Option precedence

Run-wide options are resolved by `Config`, with
`CLI flag → config file → built-in default`. Per-command options are resolved
later by normalization, which layers:

```
per-command trailing `::opt` → scripts entry → settings entry in force → enclosing list → Config option → built-in default
```

Run-wide-only options (e.g. `jobs`, `killTimeout`) live solely on `Config` and
never appear on a `Command`.

The layering is a spread everywhere but the stream settings, which are two
independent axes wearing one name. Those are merged per axis and kept partial
until everything that has something to say about them has said it — otherwise
`alias::stdout=grouped` over an entry's `stdout: './alias.log'` would take
silence about the destination for an answer and put it back to `stdout`.

## Normalization

`CommandDefinition[]` → a flat, strict `Command[]`. This stage:

- reads `package.json` scripts (once, from `Config.cwd`);
- expands glob tokens (`build:*`, `watch:**`) against **package.json scripts**
  (`scripts` keys are exact; a glob only matches a literal glob-keyed entry — a
  rare override);
- resolves bare names against `scripts` (a `scripts` entry overrides a
  same-named package script);
- detects each command's `type`;
- resolves per-command options via the precedence above;
- folds each settings entry into the defaults the rest of its list inherits;
- resolves each command's `cwd`, against the one it inherited;
- validates each command as it is built, before anything is built from it;
- lays everything out into stages, numbering each command with its own.

### Placeholders

`{1}`, `{2}`, … select positional arguments, `{@}` quotes each separately, and
`{*}` joins all into one quoted argument; `{name}` answers with whatever
`--name` was given. Everything after `--` is literal, and a command's **name**
is never substituted — it is about to be read back as a script, a `scripts` key,
a glob or a shell command.

Two readers, one flag. A command's arguments are read by a shell, so they are
shell-quoted and an unmatched `{…}` is left as written (`${HOME}` is not a
placeholder). An option's value is read by runset itself, so it is not quoted
and an unmatched name is empty — which is what makes `disabled={noTest}` false
when the argument never arrived.

### Validation

`Config.validate()` covers the run-wide options; every command is checked as
normalization finishes it, and a settings entry is checked where it stands — it
is the one place a misspelled key has nothing to fail against later, since an
entry that settles nothing would simply leave the run as it was. The `::`
spelling is parsed, so it is checked on the way through, but an object in a
config file is not: without the second check
`{ command: 'x', onFailure: 'invalid' }` would reach the run and simply never be
matched by anything — the command would fail and nothing would happen about it.
It happens before `disabled` is taken at its word, too, so `disabled: 'no'` is
refused rather than read as the `true` it technically is. Both passes check real
runtime types, `Infinity` explicitly allowed.

### Staging

A `CommandDefinition[]` becomes one flat `Command[]`, each command numbered with
the stage it belongs to:

- consecutive `parallel: true` items join the stage already open, so they run
  together;
- a `parallel: false` item is a **barrier**: it opens a stage of its own, past
  everything before it, and pushes what follows past itself;
- a **settings entry** — an object with no `command` — is `-p`/`-s` written
  down: it settles the defaults for the entries after it, and, when it names a
  mode, closes the group in front of it so that what follows starts a new one.
  It runs nothing and takes no stage of its own;
- a **named list** (a `scripts` entry that is an array) is spliced into the same
  array as everything else, its own stages shifted onto the one it landed on.
  Nothing nests — all that survives a list is the stages it occupied, and a list
  whose every command is `disabled` leaves nothing at all.

The commands are then sorted by stage. Two parallel lists lay themselves out
over the same stages, so the numbers can come back out of order — `a1 a2 b1 b2`
numbered `1 2 1 2` — and sorting makes "a stage is a run of neighbours" true
rather than nearly true, which is what lets the scheduler, the prefix pass and
the dry run all stay a single scan. The sort is stable, so within a stage the
commands keep the order they were written in.

A config's run-wide `parallel` is the default each command starts from, so
setting it puts the whole flat list in one stage without any item saying so.

```js
commands: ['build', 'oxfmt::parallel', 'oxlint::parallel', 'deploy'];
// runs as:
//   1. build
//   2. oxfmt + oxlint   (together)
//   3. deploy
```

`parallel` marks a group, and a group is marked on every command in it, so one
command saying it on its own has nothing to join and runs where it stands. That
is not reported: a group of one is a group, and a glob that matched once or a
neighbour that was `disabled` leaves one behind without anyone having erred.

A named list is how two sequences run side by side — the one shape a flat list
of commands cannot spell on its own. Give each a name, and say `parallel` about
the name; the flag describes the list, not the commands in it:

```js
{
  scripts: {
    api: ['build:api', 'test:api'],
    web: ['build:web', 'test:web'],
  },
  commands: ['api::parallel', 'web::parallel'],
}
// stage 1: build:api + build:web
// stage 2: test:api  + test:web
```

Note what the stages say and what they do not: the two lists are laid over the
same stages, so `test:api` starts when **both** builds are done, not when its
own is. A stage is the unit a run waits on, and that is the price of there being
nothing finer — a true join belongs to the dependency graph in
[future.md](../future.md).

CLI `-p/-s` is the same thing spelled with flags: the parser walks `argv`
left-to-right and turns each `-p`/`-s` into a settings entry where it was typed,
leaving the bare tokens beside it as they were written. So
`runset clean -p lint test -s build` and

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

are not two shapes that happen to agree — they are one list, reached two ways.
Tokens with no flag in front of them come back bare, to be ordered by whatever
the config says.

## Run and entry points

```ts
// one run: a resolved config and the processes built from its commands
class Run {
  readonly config: Config;
  // One per resolved command, flat and in stage order; nothing spawned. Each
  // carries its own `command`, so there is no second list beside this one.
  // `@internal`: visible to the tests, stripped from the declarations.
  readonly processes: Process[];
  isFailed(): boolean;
  getExitCode(): number;

  // a library caller's config object: createConfig → createPlan → new Run
  static fromConfigJs(configJs: ConfigJs): Run;
  constructor(plan: Plan);
  start(): Promise<Run>; // rejects with RunsetError when anything failed
  terminate(options?: TerminateOptions): void;
  describe(): string; // the --dry-run rendering
}
```

`start()` rejects for four reasons, in this order: an output file that could not
be written; a signal from outside; a `terminate()` the caller made itself; and,
last, a command that failed. The order is the order of causes — the reason the
run ended is more useful than what its commands managed on the way. An
interrupted run exits `128 + the signal's number` (130 for SIGINT, 143 for
SIGTERM) unless a failure had already ended it, in which case that failure's
code stands.

Constructing a `Run` spawns nothing, and everything that can go wrong before
anything starts has gone wrong by then: `createConfig` validated the config,
`createPlan` resolved the commands, and the constructor only builds a process
for each. `Run.start()` owns what surrounds the commands themselves — the signal
handlers, the open files, and the verdict.

### Library usage

```ts
import runset, { Run } from 'runset';

let shouldLint = true;

await runset([
  'build',
  'oxfmt::parallel',
  shouldLint && { command: 'oxlint', parallel: true },
  ['test', 'test:watch'],
]);
```

The commands and the settings around them may also arrive as one object, which
is the shape a `runset.config.*` file has:

```ts
await runset({
  commands: ['build', 'test'],
  jobs: 4,
  parallel: true,
});
```

Both call forms reach the same `Config`, so equivalent inputs resolve
identically. They are told apart by the **argument count** and by the shape: a
lone object carrying `commands` is the configuration, and anything else is the
list of commands.

The two forms are `runset`'s alone. `Run.fromConfigJs` takes **one** argument,
the object a `runset.config.*` file exports, so the ambiguity `runset` has to
resolve never reaches it — and the caller who wants to look a run over rather
than start it writes the unambiguous form:

```ts
const services = Run.fromConfigJs({
  commands: ['npm start', 'npm run dash'],
  onSuccess: 'stop', // whichever finishes first ends the session
  parallel: true,
});

console.log(services.describe()); // the plan: stages, labels, colors, cwd, env
await services.start();
```

`runset` is the one-liner over that and nothing more:

```ts
function runset(first, second?): Promise<Run> {
  // Either call form, folded into the one shape `fromConfigJs` accepts.
  return Run.fromConfigJs(toConfigJs(first, second)).start();
}
```

`fromConfigJs` is the library's path through the same pipeline the CLI takes:

```ts
static fromConfigJs(configJs: ConfigJs): Run {
  // No command line: a library caller's process arguments are its own.
  const config = createConfig({ cli: parseCli([]), configJs });
  return new Run(createPlan({ config }));
}
```

The CLI walks it by hand, because it has to answer `--help` before loading a
config file, and a bare `runset` with nothing to run after loading one:

```ts
const cli = parseCli(argv);
const config = createConfig({ cli });
new Run(createPlan({ config }));
```

## Public boundary

Runtime exports: `runset` (also default), `Run`, `RunsetError`, `ConfigError`,
`CliError`, and `NormalizeError`; the last three extend `RunsetError` with an
`exitCode` of 1, so one `instanceof RunsetError` covers every failure runset
reports itself. Export the input types and `TerminateOptions`, but keep Config,
`createConfig`, `createPlan`, Process and color helpers internal;
`Run.fromConfigJs` is the public way to a run that has not started.

There is no per-command result in the API. What a run did is answered by
`isFailed()`, `getExitCode()` and the `RunsetError`, whose `message` names every
command that failed and whose `exitCode` is the run's own. `Run.processes` is
marked `@internal` so the tests can still look a run over; `stripInternal` keeps
it out of the published declarations. Looking a run over _before_ it starts is
`describe()`, the same rendering `--dry-run` prints.

Shared validation in `src/config/validate.ts` checks numbers, booleans, exit
actions and stream settings. Callers supply the context a message names and
choose ConfigError or NormalizeError; string parsing remains separate from
runtime-type validation.
