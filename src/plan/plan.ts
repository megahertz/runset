import type { Config } from '../config/Config.ts';
import type { Command } from '../types.ts';
import { ConfigError } from '../utils/errors.ts';
import { type PackageInfo, readPackageJson } from '../utils/fs.ts';
import { alignLabels, assignAutoLabels, colorLabels } from './labels.ts';
import { normalize } from './normalize.ts';

/** Resolves a config into the commands a run will spawn. */
export function createPlan({ config }: { config: Config }): Plan {
  if (!config.hasCommands()) {
    throw new ConfigError('No commands to run.');
  }

  const packageInfo = readPackageJson(config.cwd);
  const plan: Plan = {
    commands: normalize(config, packageInfo),
    config,
    packageInfo,
  };

  assignAutoLabels(plan);
  colorLabels(plan);
  alignLabels(plan);

  return plan;
}

export interface Plan {
  commands: Command[];
  config: Config;
  packageInfo: PackageInfo;
}
