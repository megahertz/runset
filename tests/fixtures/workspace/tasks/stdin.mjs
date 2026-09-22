import { appendResult } from './lib/util.mjs';

process.stdin.on('data', (chunk) => {
  appendResult(chunk.toString());
  process.exit(0);
});

setTimeout(() => process.exit(1), 5000);
