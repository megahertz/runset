const text = String(process.argv[2]);

// Written in dribs and drabs so that line-oriented output handling (prefixes,
// buffering) has to cope with chunks that don't line up with newlines.
const chunks = [
  text,
  `${text}\n`,
  `${text}\n${text}`,
  `${text}\n${text}\n`,
  `\n${text}\n${text}`,
  `${text}\n\n\n`,
  `\n${text}`,
];

for (const chunk of chunks) {
  process.stdout.write(chunk);
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}
