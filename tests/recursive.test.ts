import { describe, expect, test } from 'vitest';
import { runset } from '../src/index.ts';
import { run } from './helpers/cli.ts';
import { tempDir } from './helpers/tempDir.ts';

describe('[recursive] an npm script runs in every workspace package having it', () => {
  test('-r runs it in each package, skipping excluded ones', async () => {
    await using dir = await tempDir('monorepo');
    await run(['-r', 'build'], dir.path);
    expect(await dir.result()).toBe('ab');
  });

  test('"::recursive" marks one command', async () => {
    await using dir = await tempDir('monorepo');
    await run(['build::recursive', 'root-only'], dir.path);
    expect(await dir.result()).toBe('abR');
  });

  test("a glob matches each package's own scripts", async () => {
    await using dir = await tempDir('monorepo');
    await run(['-r', 'test:*'], dir.path);
    expect(await dir.result()).toBe('A');
  });

  test('a script no package has resolves as it would without -r', async () => {
    await using dir = await tempDir('monorepo');
    await run(['-r', 'root-only'], dir.path);
    expect(await dir.result()).toBe('R');
  });

  test('with -p the packages share a stage, labelled by package name', async () => {
    await using dir = await tempDir('monorepo');
    const { stdout } = await run(['--dry-run', '-r', '-p', 'build'], dir.path);
    expect(stdout).toMatch(/label +"pkg-a"/);
    expect(stdout).toMatch(/label +"pkg-b"/);
    expect(stdout).not.toContain('stage 2');
  });

  test('pnpm-workspace.yaml lists the packages', async () => {
    await using dir = await tempDir('monorepo');
    await dir.write(
      'pnpm-workspace.yaml',
      'packages:\n  - "packages/b" # only b\n',
    );
    await runset({ commands: ['build'], cwd: dir.path, recursive: true });
    expect(await dir.result()).toBe('b');
  });
});
