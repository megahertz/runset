import cp from 'node:child_process';
import { appendResult } from './lib/util.mjs';

// Starts a grandchild that outlives its parent unless the whole tree is taken
// down, and leaves a mark behind if it is ever allowed to finish.
const child = cp.spawn(
  process.execPath,
  [
    '-e',
    'setTimeout(() => require("fs").appendFileSync("test.txt", "SURVIVED"), 2000)',
  ],
  { cwd: process.cwd(), detached: false, stdio: 'ignore' },
);

appendResult(`spawned:${child.pid} `);
setInterval(() => {}, 1000);
