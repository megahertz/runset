import { Writable } from 'node:stream';
import { createConfig } from '../../src/config/Config.ts';
import { parseCli } from '../../src/config/parseCli.ts';
import { createPlan } from '../../src/plan/plan.ts';
import { Run } from '../../src/run/Run.ts';
import type { ConfigJs } from '../../src/types.ts';

/** `Run.fromConfigJs` writing to a pair of in-memory streams */
export function createRun(configJs: ConfigJs): {
  runner: Run;
  stderr: Sink;
  stdout: Sink;
} {
  const destinations = { stderr: new Sink(), stdout: new Sink() };
  const config = createConfig({ cli: parseCli([]), configJs, destinations });

  return { runner: new Run(createPlan({ config })), ...destinations };
}

/** A stream that keeps everything written to it. */
class Sink extends Writable {
  text = '';

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    done: () => void,
  ): void {
    this.text += String(chunk);
    done();
  }
}
