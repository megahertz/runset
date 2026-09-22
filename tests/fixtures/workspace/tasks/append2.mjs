import { appendResult, TASK_DELAY } from './lib/util.mjs';

const text = process.argv[2];

appendResult(text);
setTimeout(() => {
  appendResult(text);
  process.exit(0);
}, TASK_DELAY);

// Exit quietly when runset terminates us, without writing the second half.
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
