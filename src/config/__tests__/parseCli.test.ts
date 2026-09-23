import { describe, expect, test } from 'vitest';
import { parseCli } from '../parseCli.ts';

describe('[parseCli]', () => {
  test('bare tokens come back as they were written', () => {
    const { commands } = parseCli(['lint', 'test']);
    expect(commands).toEqual(['lint', 'test']);
  });

  test('-p and -s become settings entries where they were typed', () => {
    const { commands } = parseCli(['-p', 'foo', 'bar', '-s', 'baz']);
    expect(commands).toEqual([
      { parallel: true },
      'foo',
      'bar',
      { parallel: false },
      'baz',
    ]);
  });

  test('a flag with no tasks after it is still a group boundary', () => {
    const { commands } = parseCli(['-p', '-s', 'baz']);
    expect(commands).toEqual([{ parallel: true }, { parallel: false }, 'baz']);
  });

  test('short flags cluster', () => {
    const { options, commands } = parseCli(['-pj2', 'foo']);
    expect(options.jobs).toBe(2);
    expect(commands).toEqual([{ parallel: true }, 'foo']);
  });

  test('a clustered value flag takes the rest of the cluster', () => {
    expect(parseCli(['-j2', 'foo']).options.jobs).toBe(2);
    expect(parseCli(['-j', '2', 'foo']).options.jobs).toBe(2);
  });

  test('--no-color negates a switch', () => {
    expect(parseCli(['--no-color', 'foo']).options.color).toBe(false);
    expect(parseCli(['--color', 'foo']).options.color).toBe(true);
  });

  test('--name=value works as well as --name value', () => {
    expect(parseCli(['--log-level=debug', 'foo']).options.logLevel).toBe(
      'debug',
    );
    expect(parseCli(['--log-level', 'debug', 'foo']).options.logLevel).toBe(
      'debug',
    );
  });

  test('everything after -- is a task argument', () => {
    const { positional, commands } = parseCli(['foo', '--', '-p', 'bar']);
    expect(commands).toEqual(['foo']);
    expect(positional).toEqual(['-p', 'bar']);
  });

  test('long flags and negative values after -- remain literal', () => {
    const values = ['--port', '-1', '--help', '--config=other', '--', 'a b'];
    expect(parseCli(['foo', '--', ...values])).toMatchObject({
      commands: ['foo'],
      positional: values,
      help: false,
      options: {},
    });
  });

  test('an undeclared flag before -- throws', () => {
    expect(() => parseCli(['--nope', 'foo'])).toThrow(/unknown option/i);
    expect(() => parseCli(['-Z', 'foo'])).toThrow(/unknown option/i);
  });

  test('-e collects NAME=value pairs, the value keeping any "="', () => {
    const { options, commands } = parseCli([
      '-e',
      'FORCE_COLOR=1',
      '--env=DEBUG=*',
      '-eQUERY=a=b',
      'start',
    ]);
    expect(options.env).toEqual({
      DEBUG: '*',
      FORCE_COLOR: '1',
      QUERY: 'a=b',
    });
    expect(commands).toEqual(['start']);
  });

  test('-e without a NAME= throws', () => {
    expect(() => parseCli(['-e', 'FOO', 'x'])).toThrow(/NAME=value/);
    expect(() => parseCli(['-e', '=1', 'x'])).toThrow(/NAME=value/);
  });

  test('a value flag with nothing after it throws', () => {
    expect(() => parseCli(['foo', '--jobs'])).toThrow(/needs a value/i);
  });
});
