import { appendResult } from './lib/util.mjs';

// Reports what runset put into the child's environment.
appendResult(
  JSON.stringify({
    lifecycleEvent: process.env.npm_lifecycle_event ?? null,
    packageName: process.env.npm_package_name ?? null,
    custom: process.env.RUNSET_TEST_CUSTOM ?? null,
  }),
);
