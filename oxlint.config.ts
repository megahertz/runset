import { configs, defineConfig } from '@megahertz/oxconfig/oxlint';

export default defineConfig({
  ignorePatterns: ['ai'],

  overrides: [
    configs.base,
    configs.strict,
    configs.ts,
    configs.tsStrict,
    configs.perfectionist,
    configs.node,
    configs.esm,
    configs.unicorn,
    configs.vitest,
  ],
});
