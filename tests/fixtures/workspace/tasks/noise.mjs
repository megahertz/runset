// Prints `<n>` numbered lines as fast as it can — enough output that a run
// which settled before its files were flushed would leave a truncated log.
const count = Number(process.argv[2] ?? 1000);

for (let index = 1; index <= count; index += 1) {
  process.stdout.write(`line ${index}\n`);
}
