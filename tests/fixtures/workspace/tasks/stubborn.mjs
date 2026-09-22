// Takes the request to stop and does nothing about it, so only a SIGKILL ends
// this one. It is how the tests reach the escalation `--kill-timeout` governs.
process.on('SIGTERM', () => {});
process.on('SIGINT', () => {});

console.log('stubborn');
setInterval(() => {}, 1000);
