import fs from 'node:fs';

// Fails the first <failures> times it is run, then succeeds. Every run leaves
// a mark in attempts.txt, so a test can count how often runset started it.
const failures = Number(process.argv[2] ?? 1);
const file = 'attempts.txt';
const attempts =
  (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') + 'x';

fs.writeFileSync(file, attempts);
console.log(`attempt ${attempts.length}`);

process.exit(attempts.length > failures ? 0 : 1);
