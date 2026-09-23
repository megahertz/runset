import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { Run, runset } from '../src/index.ts';
import { BASIC_PALETTE, paletteIndex } from '../src/utils/colors.ts';
import { run, runWithError } from './helpers/cli.ts';
import { fixturePath, tempDir } from './helpers/tempDir.ts';

/** The background a label asks for, before two of them are pulled apart. */
function wants(label: string): string {
  return BASIC_PALETTE[paletteIndex(label, BASIC_PALETTE)]?.bgColor ?? '';
}

/** The lines of a run's output, without the blank one at the end. */
function lines(output: string): string[] {
  return output.split('\n').filter((text) => text !== '');
}

describe('[labels] runset tags interleaved output with its command', () => {
  describe('when prefixes appear on their own', () => {
    test('a parallel group of two or more commands is prefixed', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(['-p', 'echo one', 'echo two'], dir.path);

      expect(lines(stdout).toSorted()).toEqual([
        '[echo#1] one',
        '[echo#2] two',
      ]);
    });

    test('a lone command is not', async () => {
      await using dir = await tempDir();
      const { stdout } = await run('echo hello', dir.path);
      expect(stdout).toBe('hello\n');
    });

    test('a serial run is not: its output never overlaps', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(['echo one', 'echo two'], dir.path);
      expect(stdout).toBe('one\ntwo\n');
    });
  });

  describe('--labels picks which commands are labelled', () => {
    test('all tags a serial run', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--labels', 'all', 'echo one', 'echo two'],
        dir.path,
      );

      expect(stdout).toBe('[echo#1] one\n[echo#2] two\n');
    });

    test('none leaves a parallel group bare, labels and all', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--labels', 'none', '-p', 'echo one::label=a', 'echo two'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['one', 'two']);
    });

    test('custom prints only the labels the user wrote', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--labels', 'custom', '-p', 'echo one', 'echo two'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['one', 'two']);
    });

    test('anything else is refused', async () => {
      await using dir = await tempDir();
      const { stderr } = await runWithError(
        ['--labels', 'some', 'echo one'],
        dir.path,
      );

      expect(stderr).toMatch(/labels is one of none, auto, custom, all/);
    });
  });

  describe('labels', () => {
    test('a label prefixes every line of a command s output', async () => {
      await using dir = await tempDir();
      const { stdout } = await run('echo hello::label=build', dir.path);
      expect(stdout).toBe('[build] hello\n');
    });

    test('labels survive chunks that do not line up with newlines', async () => {
      await using dir = await tempDir();
      const { stdout } = await run('test-task:echo x::label=e', dir.path);

      expect(lines(stdout).every((text) => text.startsWith('[e] '))).toBe(true);
    });

    test('commands sharing a name are numbered apart', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['-p', 'test-task:echo a', 'test-task:echo b'],
        dir.path,
      );

      const prefixes = new Set(lines(stdout).map((text) => text.slice(0, 18)));
      expect([...prefixes].toSorted()).toEqual([
        '[test-task:echo#1]',
        '[test-task:echo#2]',
      ]);
    });

    test('a label the user wrote is left as it is', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['-p', 'echo one::label=a', 'echo two::label=b'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['[a] one', '[b] two']);
    });

    test('a label keeps the spaces it was written with', async () => {
      await using dir = await tempDir();
      // The list runs to the end of the token, so the space just stays.
      const { stdout } = await run(
        ['-p', 'echo one::label=api ', 'echo two::label=dash'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['[api ] one', '[dash] two']);
    });

    test('one label in a group leaves the others their own names', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['-p', 'echo one::label=api', 'echo two'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['[api ] one', '[echo] two']);
    });

    test('under custom, one label leaves the others a blank one', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--labels', 'custom', '-p', 'echo one::label=api', 'echo two'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['[   ] two', '[api] one']);
    });

    test('a label on a command alone is printed', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--labels', 'custom', 'echo one::label=api', 'echo two'],
        dir.path,
      );

      expect(stdout).toBe('[api] one\ntwo\n');
    });

    test('labels are padded to one width so the output lines up', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['-p', 'echo one::label=build', 'echo two::label=x'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['[build] one', '[x    ] two']);
    });
  });

  test('a blank line carries the prefix, so the gutter runs unbroken', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      ['--labels', 'all', String.raw`printf "one\n\ntwo\n"`],
      dir.path,
    );

    expect(stdout).toBe('[printf] one\n[printf] \n[printf] two\n');
  });

  describe('color', () => {
    test.each([
      ['ink', 'bgCoral', 235, 210],
      ['paper', 'bgNavy', 255, 24],
    ])(
      'extended shades %s/%s render through the CLI and respect --no-color',
      async (foreground, background, fgIndex, bgIndex) => {
        await using dir = await tempDir();
        const target = {
          cwd: dir.path,
          env: { FORCE_COLOR: '2', NO_COLOR: '' },
        };
        const command = `echo hi::label=api,color=${foreground},bg-color=${background}`;
        const colored = await run(['--color', command], target);
        expect(colored.stdout).toBe(
          `\u001B[48;5;${bgIndex}m\u001B[38;5;${fgIndex}mapi\u001B[39m\u001B[49m hi\n`,
        );
        const plain = await run(['--no-color', command], target);
        expect(plain.stdout).toBe('[api] hi\n');
      },
    );

    test('--color turns the label into a filled block', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--color', 'echo hi::label=build,color=white,bg-color=bgGreen'],
        dir.path,
      );

      expect(stdout).toBe('\u001B[42m\u001B[37mbuild\u001B[39m\u001B[49m hi\n');
    });

    test('without color the same command falls back to brackets', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--no-color', 'echo hi::label=build,color=white,bg-color=bgGreen'],
        dir.path,
      );

      expect(stdout).toBe('[build] hi\n');
    });

    test('a color alone does not give a command a label', async () => {
      await using dir = await tempDir();
      const { stdout } = await run('echo hello::color=red', dir.path);
      expect(stdout).toBe('hello\n');
    });

    test('a blank label is left uncolored', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        [
          '--color',
          '--labels',
          'custom',
          '-p',
          'echo one::label=api',
          'echo two',
        ],
        dir.path,
      );

      expect(stdout).toContain('    two');
    });

    test('a name runset does not know is ignored, not fatal', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--color', 'echo hi::label=x,color=chartreuse'],
        dir.path,
      );

      expect(stdout).toBe('[x] hi\n');
    });

    test('parallel commands are handed colors of their own', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--color', '-p', 'echo one', 'echo two'],
        dir.path,
      );

      const codes = new Set(
        lines(stdout).map((text) => text.slice(0, text.indexOf('m') + 1)),
      );
      expect(codes.size).toBe(2);
    });
  });

  describe('lines', () => {
    test('a prefixed line is only written once it is whole', async () => {
      await using dir = await tempDir();
      // `test-task:delayed` writes its first half without a newline. Held back
      // until one arrives, the two commands cannot land on the same line.
      const { stdout } = await run(
        ['-p', 'test-task:delayed a 1', 'test-task:delayed b 200'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual([
        '[test-task:delayed#1] [a]__[a]',
        '[test-task:delayed#2] [b]__[b]',
      ]);
    });

    test('a last line with no newline is still emitted', async () => {
      await using dir = await tempDir();
      const { stdout } = await run(
        ['--labels', 'all', 'node -e "process.stdout.write(\'no newline\')"'],
        dir.path,
      );

      expect(stdout).toBe('[node] no newline');
    });
  });

  describe('formatLabel', () => {
    test('a config file may render the prefix itself', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        [
          'module.exports = {',
          "  labels: 'all',",
          '  formatLabel: ({ command, stream }) =>',
          "    stream + '/' + command.label.trim() + '| ',",
          '};',
        ].join('\n'),
      );

      const { stdout, stderr } = await run(
        ['echo one', 'echo two 1>&2'],
        dir.path,
      );

      expect(stdout).toBe('stdout/echo#1| one\n');
      expect(stderr).toBe('stderr/echo#2| two\n');
    });

    test('it is asked again for every line', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        [
          'let line = 0;',
          'module.exports = {',
          "  labels: 'all',",
          "  formatLabel: () => ++line + ': ',",
          '};',
        ].join('\n'),
      );

      const { stdout } = await run(String.raw`printf "a\nb\nc\n"`, dir.path);

      expect(stdout).toBe('1: a\n2: b\n3: c\n');
    });

    test('it is handed runset s own answer to decorate', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        [
          'module.exports = {',
          "  formatLabel: ({ defaultPrefix }) => '> ' + defaultPrefix,",
          '};',
        ].join('\n'),
      );

      const { stdout } = await run(
        ['-p', 'echo one::label=a', 'echo two::label=b'],
        dir.path,
      );

      expect(lines(stdout).toSorted()).toEqual(['> [a] one', '> [b] two']);
    });

    test('it is left alone for commands that have no prefix', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        ['module.exports = { formatLabel: () => "X " };'].join('\n'),
      );

      const { stdout } = await run('echo one', dir.path);

      expect(stdout).toBe('one\n');
    });

    test('anything but a function is refused', async () => {
      await using dir = await tempDir();
      await dir.write(
        'runset.config.js',
        ['module.exports = { formatLabel: "nope" };'].join('\n'),
      );

      const { stderr } = await runWithError('echo one', dir.path);

      expect(stderr).toMatch(/formatLabel must be a function/);
    });
  });

  describe('colors follow the label', () => {
    /**
     * The background each command ended up with, in the order written.
     *
     * The colors are settled while the plan is built, so nothing has to run.
     */
    function backgrounds(...commands: string[]): string[] {
      const runner = Run.fromConfigJs({
        color: false,
        commands,
        cwd: fixturePath(),
        parallel: true,
      });
      return runner.processes.map((item) => item.command.bgColor);
    }

    test('a label lands on the same color whatever it runs beside', () => {
      const beside = backgrounds('echo a::label=db', 'echo b::label=lint');
      const alone = backgrounds('echo a::label=web', 'echo b::label=db');

      expect(beside[0]).toBe(wants('db'));
      expect(alone[1]).toBe(wants('db'));
    });

    test('two labels wanting one color are still pulled apart', () => {
      // The point of the color is telling the two apart, so it outranks
      // giving each of them the one its label asked for.
      expect(paletteIndex('api', BASIC_PALETTE)).toBe(
        paletteIndex('dash', BASIC_PALETTE),
      );

      const [api, dash] = backgrounds(
        'echo a::label=api',
        'echo b::label=dash',
      );

      expect(api).toBe(wants('api'));
      expect(dash).not.toBe(api);
    });

    test('a color the user chose is not handed to anything else', async () => {
      await using dir = await tempDir();
      const runner = Run.fromConfigJs({
        color: false,
        commands: [
          { bgColor: wants('db'), command: 'echo a' },
          'echo b::label=db',
        ],
        cwd: dir.path,
        parallel: true,
      });

      const [mine, db] = runner.processes;
      expect(mine?.command.bgColor).toBe(wants('db'));
      expect(db?.command.bgColor).not.toBe(wants('db'));
    });
  });

  test('the library API takes the same options', async () => {
    await using dir = await tempDir();
    const group = await runset(
      [
        { command: 'echo one', label: 'api' },
        { bgColor: 'bgBlue', color: 'white', command: 'echo two' },
      ],
      { cwd: dir.path, parallel: true, stdout: 'none' },
    );

    const [first, second] = group.processes;
    expect(first?.command.label).toBe('api ');
    expect(second?.command.label).toBe('echo');
    // Only the command that named no colors is given a pair from the palette.
    expect(first?.command.bgColor).not.toBe('');
    expect(second?.command.bgColor).toBe('bgBlue');
  });
});

describe('[labels] --wrap labels every line a long one wraps to', () => {
  const DOTS = 'echo ..........';

  test('breaks a labelled line at the terminal width', async () => {
    await using dir = await tempDir();
    // `[a] ` takes four of the ten columns, leaving six for the dots.
    const { stdout } = await run(
      ['--wrap', '--labels', 'all', `${DOTS}::label=a`],
      {
        cwd: dir.path,
        env: { COLUMNS: '10' },
      },
    );

    expect(stdout).toBe('[a] ......\n[a] ....\n');
  });

  test('is off by default', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(['--labels', 'all', `${DOTS}::label=a`], {
      cwd: dir.path,
      env: { COLUMNS: '10' },
    });

    expect(stdout).toBe('[a] ..........\n');
  });

  test('may be turned on in a config file', async () => {
    await using dir = await tempDir();
    await dir.write('runset.config.json', JSON.stringify({ wrap: true }));

    const { stdout } = await run(['--labels', 'all', `${DOTS}::label=a`], {
      cwd: dir.path,
      env: { COLUMNS: '10' },
    });

    expect(stdout).toBe('[a] ......\n[a] ....\n');
  });

  test('leaves the line whole with no width to go by', async () => {
    await using dir = await tempDir();
    // Not a TTY, and no COLUMNS.
    const { stdout } = await run(
      ['-w', '--labels', 'all', `${DOTS}::label=a`],
      {
        cwd: dir.path,
        env: { COLUMNS: '' },
      },
    );

    expect(stdout).toBe('[a] ..........\n');
  });

  test('leaves unlabelled output alone', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(['--wrap', DOTS], {
      cwd: dir.path,
      env: { COLUMNS: '4' },
    });

    expect(stdout).toBe('..........\n');
  });

  test('hands a command the width its label leaves it', async () => {
    await using dir = await tempDir();
    const { stdout } = await run(
      ['--wrap', '--labels', 'all', 'node -p process.env.COLUMNS::label=a'],
      { cwd: dir.path, env: { COLUMNS: '80' } },
    );

    expect(stdout).toBe('[a] 76\n');
  });

  test('so a nested runset wraps inside its parent s label', async () => {
    await using dir = await tempDir();
    const cli = `"${process.execPath}" "${fileURLToPath(new URL('../src/index.ts', import.meta.url))}"`;
    // The inner run has 16 columns: `[inner] ` leaves 8 of them.
    const { stdout } = await run(
      [
        '--wrap',
        '--labels',
        'all',
        `${cli} --wrap --labels all "${DOTS}::label=inner"::label=a`,
      ],
      { cwd: dir.path, env: { COLUMNS: '20' } },
    );

    expect(stdout).toBe('[a] [inner] ........\n[a] [inner] ..\n');
  });
});
