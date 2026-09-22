export function isGlob(pattern: string): boolean {
  return pattern.includes('*');
}

/** The `names` a glob matches, in declared order; none is not an error. */
export function matchGlob(pattern: string, names: readonly string[]): string[] {
  const regexp = toRegExp(pattern);
  return names.filter((name) => regexp.test(name));
}

function escape(literal: string): string {
  return literal.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * `*` matches within one `:`-separated segment, `**` spans one or more.
 * `build:**:*` means `build:**`.
 */
function toRegExp(pattern: string): RegExp {
  const segments = pattern.split(':');
  const source: string[] = [];

  for (const [index, segment] of segments.entries()) {
    if (segment === '*' && segments[index - 1] === '**') {
      continue;
    }

    if (segment === '**') {
      source.push(String.raw`[^:]+(?::[^:]+)*`);
    } else {
      source.push(
        segment
          .split('*')
          .map((part) => escape(part))
          .join('[^:]*'),
      );
    }
  }

  return new RegExp(`^${source.join(':')}$`);
}
