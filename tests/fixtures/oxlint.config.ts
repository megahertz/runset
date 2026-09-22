import { defineConfig } from '@megahertz/oxconfig/oxlint';
import root from '../../oxlint.config.ts';

export default defineConfig({
  extends: [root],

  overrides: [
    {
      files: ['**/*.mjs'],
      rules: {
        'no-await-in-loop': 'off',
        'no-console': 'off',
        'unicorn/no-null': 'off',
        'unicorn/no-process-exit': 'off',
      },
    },
  ],
});
