# runset

Run npm scripts in sequence or in parallel. Based on ideas from
[`npm-run-all`](https://github.com/mysticatea/npm-run-all), with reusable
pipelines, colored labels, and grouped output.

Requires Node.js 24.2 or later. No runtime dependencies.

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

`{1}`, `{2}`, etc. insert individual arguments. `{@}` inserts all arguments.
Placeholder values are quoted automatically for the shell.

## Options

| Option                  | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `-p, --parallel`        | Run the following commands together              |
| `-s, --serial`          | Run the following commands one after another     |
| `-j, --jobs <n>`        | Limit how many commands run at once              |
| `--on-failure <action>` | `stop` (default), `continue`, or `restart`       |
| `--on-success <action>` | `continue` (default), `stop`, or `restart`       |
| `-o, --output grouped`  | Buffer each command's output until it exits      |
| `--stdout <file>`       | Write stdout to a file                           |
| `--labels <mode>`       | `auto` (default), `all`, `custom`, or `none`     |
| `--show-exit-code`      | Print `✓ 2.1s` or `✗ code 1 · 2.1s` at each exit |
| `-w, --wrap`            | Wrap long labelled lines, a label on each        |
| `--cwd <dir>`           | Set the working directory                        |
| `-e, --env <k=v>`       | Add an env variable for every command            |
| `--dry-run`             | Show what would run without starting anything    |
| `-c, --config <path>`   | Use a specific config file                       |

Use `--help` for all options.

Add `::` to set options for one command:

```sh
npx runset -p "api::label=server,color=cyan" web
npx runset "lint::on-failure=continue" build
```

`stop` ends the whole run. `continue` lets it carry on. `restart` runs the
command again without a delay or retry limit.

## Output

Commands running together get colored labels automatically, so you can tell
which command wrote each line. Set your own with `::label=api,color=cyan`. Use
`--color none` for plain text or `--labels none` to hide labels.

runset has 36 label backgrounds for 256-color terminals: 24 soft, vivid shades
with charcoal text and 12 deeper shades with off-white text. `--color <mode>`
(or `color` in a config file) picks how many of them automatic labels use:

| Mode    | Automatic labels                                           |
| ------- | ---------------------------------------------------------- |
| `auto`  | `soft` on 256-color terminals, `basic` on others (default) |
| `none`  | no color, `[label]`                                        |
| `basic` | the terminal's 16 theme colors                             |
| `soft`  | the 24 soft shades                                         |
| `all`   | the soft and the deeper shades                             |

`auto` reads the terminal environment, so `FORCE_COLOR` and `NO_COLOR` apply.

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

In a config, write `output: 'grouped'` — for the whole run, or on a single
command.

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

Use `commandDictionary` to give a command or pipeline a reusable name:

```ts
import type { ConfigJs } from 'runset';

export default {
  commandDictionary: {
    check: ['lint', 'test'],
    api: { command: 'node server.js', env: { PORT: '4000' } },
  },
} satisfies ConfigJs;
```

Run these with `npx runset check` or `npx runset api`. Dictionary names take
priority over npm script names.

Config files also support `.js`, `.mjs`, `.cjs`, and `.json`. runset looks in
the working directory and its parents. CLI commands run **after** any `commands`
listed in the config.

## Library

```ts
import runset from 'runset';

await runset(['lint', 'test', 'build']);
await runset({ commands: ['lint', 'test'], parallel: true, jobs: 2 });
```

The promise resolves with a `Run`, or rejects with a `RunsetError` if the run
fails. Use `Run.fromConfigJs(config)` to prepare a run, `describe()` to inspect
it, `start()` to run it, and `terminate()` to stop it.

## License

[MIT](LICENSE)
