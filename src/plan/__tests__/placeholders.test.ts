import { describe, expect, test } from 'vitest';
import { quoteForShell } from '../../utils/os.ts';
import { substitutePlaceholders } from '../placeholders.ts';

describe('[placeholders] substitutePlaceholders', () => {
  const args = ['one', 'two'];

  /** The expected quoting, so the wiring is what these tests are about. */
  const q = (value: string): string => quoteForShell(value);

  test('quotes the values it substitutes', () => {
    expect(substitutePlaceholders('serve {1}', args)).toBe(`serve ${q('one')}`);
  });

  test('{@} spreads, {*} joins', () => {
    expect(substitutePlaceholders('{@}', args)).toBe(`${q('one')} ${q('two')}`);
    expect(substitutePlaceholders('{*}', args)).toBe(q('one two'));
  });

  test('an out-of-range index disappears', () => {
    expect(substitutePlaceholders('a {9} b', args)).toBe('a  b');
  });

  test('unknown names are left alone', () => {
    expect(substitutePlaceholders('echo {a,b}', args)).toBe('echo {a,b}');
    // A shell variable, not a placeholder: runset must leave it alone.
    const shellVariable = String.raw`${'$'}{HOME}`;
    expect(substitutePlaceholders(shellVariable, args)).toBe(shellVariable);
  });

  test('a substitution is never read back as shell source', () => {
    const hostile = ['$(printf SUBSTITUTED)'];
    expect(substitutePlaceholders('{1}', hostile)).toBe(
      q('$(printf SUBSTITUTED)'),
    );
  });
});
