import config from '@megahertz/oxconfig/oxfmt';

export default {
  ...config,
  ignorePatterns: ['CLAUDE.md'], // Symlinks on Windows
};
