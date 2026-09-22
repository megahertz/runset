import { groupByStage } from '../plan/stages.ts';
import type { Process } from './Process.ts';

/**
 * Runs the stages in order, everything in a stage at once — or, when `jobs`
 * is narrower, in batches of that many. A stopped run starts no new batch.
 */
export async function schedule(
  processes: Process[],
  stopped: () => boolean,
  jobs: number,
): Promise<void> {
  for (const stage of groupByStage(processes, (p) => p.command.stage)) {
    const size = Math.min(jobs, stage.length);

    for (let start = 0; start < stage.length; start += size) {
      if (stopped()) {
        return;
      }

      const batch = stage.slice(start, start + size);
      // oxlint-disable-next-line no-await-in-loop
      await Promise.all(batch.map((process) => process.start()));
    }
  }
}
