import { describe, expect, test } from 'vitest';
import { mergeStd } from '../std.ts';

describe('[std] mergeStd', () => {
  const fallback = { destination: 'stdout', timing: 'realtime' } as const;

  test('a bare timing keeps the destination', () => {
    expect(mergeStd(fallback, 'grouped')).toEqual({
      destination: 'stdout',
      timing: 'grouped',
    });
  });

  test('a bare destination keeps the timing', () => {
    expect(mergeStd(fallback, 'stderr')).toEqual({
      destination: 'stderr',
      timing: 'realtime',
    });
  });

  test('anything unrecognised is a file path', () => {
    expect(mergeStd(fallback, './build.log')).toEqual({
      destination: './build.log',
      timing: 'realtime',
    });
  });

  test('the two axes combine with + in either order', () => {
    expect(mergeStd(fallback, 'stderr+grouped')).toEqual(
      mergeStd(fallback, 'grouped+stderr'),
    );
    expect(mergeStd(fallback, 'stderr+grouped')).toEqual({
      destination: 'stderr',
      timing: 'grouped',
    });
  });
});
