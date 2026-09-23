import type { Config } from '../config/Config.ts';
import type { Command, Std } from '../types.ts';
import { groupByStage } from './stages.ts';

/** The resolved run and every option in force, as `--dry-run` prints it. */
export function describeRun(
  config: Config,
  commands: readonly Command[],
): string {
  return [
    ...describeOptions(config),
    '',
    'Commands:',
    ...describeCommands(commands),
  ].join('\n');
}

function describeStd(std: Std): string {
  return `${std.timing} -> ${std.destination}`;
}

function amount(value: number): string {
  return Number.isFinite(value) ? String(value) : 'unlimited';
}

/** `name  value` lines, names padded into a column. */
function settings(rows: [string, string][]): string[] {
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, value]) => `${name.padEnd(width)}  ${value}`);
}

function describeOptions(config: Config): string[] {
  return [
    'Options:',
    ...settings([
      ['cwd', config.cwd],
      ['jobs', amount(config.jobs)],
      ['parallel', String(config.parallel)],
      ['recursive', String(config.recursive)],
      ['on-success', config.onSuccess],
      ['on-failure', config.onFailure],
      ['kill-timeout', `${config.killTimeout}ms`],
      ['stdout', describeStd(config.stdout)],
      ['stderr', describeStd(config.stderr)],
      ['labels', config.labels],
      ['color', String(config.color)],
      ['log-level', config.logLevel],
    ]).map((line) => `  ${line}`),
  ];
}

function describeCommand(command: Command): [string, string][] {
  const rows: [string, string][] = [];

  // An npm command runs the script's body, which is not what was typed.
  if (command.line !== command.command) {
    rows.push(['line', command.line]);
  }

  rows.push(
    ['cwd', command.cwd],
    ['on-success', command.onSuccess],
    ['on-failure', command.onFailure],
    ['stdout', describeStd(command.stdout)],
    ['stderr', describeStd(command.stderr)],
  );

  if (command.label !== '') {
    rows.push(['label', `"${command.label}"`]);
    const colors = [command.bgColor, command.color].filter(
      (name) => name !== '',
    );
    if (colors.length > 0) {
      rows.push(['color', colors.join(' on ')]);
    }
  }

  // Only what the command added, not runset's own environment.
  for (const [name, value] of Object.entries(command.env)) {
    rows.push([`env ${name}`, String(value)]);
  }

  return rows;
}

function describeCommands(commands: readonly Command[]): string[] {
  const lines: string[] = [];

  for (const [index, stage] of groupByStage(
    commands,
    (command) => command.stage,
  ).entries()) {
    lines.push(`  stage ${index + 1}:`);

    for (const command of stage) {
      lines.push(
        `    - ${command.command} (${command.type})`,
        ...settings(describeCommand(command)).map((line) => `        ${line}`),
      );
    }
  }

  return lines;
}
