import { appendResult } from './lib/util.mjs';

// Records which signal runset passed on, so a test can tell SIGINT from SIGTERM.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    appendResult(signal);
    process.exit(0);
  });
}

// Stay up until something signals us, and say when it is safe to.
setInterval(() => {}, 1000);
console.log('ready');
