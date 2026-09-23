import { fileURLToPath } from 'node:url';
import { createConfig } from './config/Config.ts';
import { parseCli } from './config/parseCli.ts';
import { createPlan } from './plan/plan.ts';
import { Run } from './run/Run.ts';
import { RunsetError } from './utils/errors.ts';
import { readPackageJson } from './utils/fs.ts';

const HELP = `Usage: runset [options] <command...>

  Runs npm scripts and shell commands in sequence or in parallel.

Run mode:
  -p, --parallel <commands>  run the following commands together
  -s, --serial <commands>    run the following commands one after another
  -j, --jobs <n>             max commands running at once (default: unlimited)
  -r, --recursive            run npm scripts in every workspace package having them

On exit:
      --on-success <action>  what a clean exit does   (default: continue)
      --on-failure <action>  what a non-zero exit does (default: stop)
                             action: continue | restart | stop
      --kill-timeout <ms>    grace period before a SIGKILL (default: 5000)

Output:
      --stdout <value>       configure stdout: <timing>[+<destination>]
      --stderr <value>       configure stderr
  -o, --output <value>       apply <value> to both streams
                             timing: realtime | grouped
                             destination: stdout | stderr | none | <file path>
      --labels <mode>        label each output line with its command:
                             none | auto | custom | all (default: auto)
      --show-command         print each command as it starts
      --show-exit-code       mark each exit and its duration: ✓ 2.1s, ✗ code 1 · 2.1s
  -w, --wrap                 wrap labelled lines to the terminal, a label on each

General:
  -c, --config <path>        load a config file, skipping the default lookup
      --cwd <dir>            working directory for the commands
  -e, --env <NAME=value>     set an environment variable for every command
      --color, --no-color    force color on or off
      --log-level <level>    error | warn | info | debug (default: info)
      --dry-run              print the resolved stages and run nothing
  -h, --help                 show this help
  -v, --version              show the version

Command syntax:
  cmd args::opt=value,flag   per-command options, after the last "::":
                             "npm start::on-failure=restart"
                             "serve --port 80::label=api,color=cyan"
  "build:*"                  glob over package.json script names
  "build::recursive"         build in every workspace package that has it
  "serve -- --port {1}"      placeholders drawn from arguments after --

Examples:
  runset clean lint "build:**"
  runset -p "watch:**"
  runset clean -p lint test -s deploy
  runset -e FORCE_COLOR=1 -e 'DEBUG=*' start
`;

/** Runs the CLI and returns its exit code. */
export async function main(rawArgv: string[]): Promise<number> {
  try {
    const cli = parseCli(rawArgv);

    if (cli.version) {
      process.stdout.write(`${version()}\n`);
      return 0;
    }

    if (cli.help) {
      process.stdout.write(HELP);
      return 0;
    }

    const config = createConfig({ cli });

    if (cli.argv.length === 0 && !config.hasCommands()) {
      process.stdout.write(HELP);
      return 0;
    }

    await new Run(createPlan({ config })).start();
    return 0;
  } catch (error) {
    if (!(error instanceof RunsetError)) {
      throw error;
    }

    const report = error.report ?? error.message;
    if (report !== '') {
      process.stderr.write(`runset: ${report}\n`);
    }
    return error.exitCode;
  }
}

function version(): string {
  const self = readPackageJson(fileURLToPath(new URL('..', import.meta.url)));
  return `v${self.version}`;
}
