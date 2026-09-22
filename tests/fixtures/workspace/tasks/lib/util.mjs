import fs from 'node:fs';

/** Where the tasks record what they did; relative to the task's cwd. */
export const RESULT_FILE = 'test.txt';

/** How long the long-running tasks stay alive, in milliseconds. */
export const TASK_DELAY = Number(process.env.RUNSET_TEST_DELAY ?? 150);

export function appendResult(content) {
  fs.appendFileSync(RESULT_FILE, content);
}
