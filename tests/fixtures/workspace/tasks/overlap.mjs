import { appendResult, TASK_DELAY } from './lib/util.mjs';

// Brackets its own lifetime in the result file, so a test can read the maximum
// number of commands that were ever running at the same time back out of it.
const name = process.argv[2];

appendResult(`>${name}`);
setTimeout(() => {
  appendResult(`<${name}`);
  process.exit(0);
}, TASK_DELAY);
