import fs from 'node:fs';

// Every package appends to the one file at the monorepo root.
fs.appendFileSync(new URL('../test.txt', import.meta.url), process.argv[2]);
