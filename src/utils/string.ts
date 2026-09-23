export function toCamelCase(name: string): string {
  return name.replaceAll(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

export function toKebabCase(name: string): string {
  return name.replaceAll(
    /[A-Z]/g,
    (letter: string) => `-${letter.toLowerCase()}`,
  );
}

/** `850ms` under a second, `2.1s` from one up. */
export function formatDuration(ms: number): string {
  const rounded = Math.round(ms);
  return rounded < 1000 ? `${rounded}ms` : `${(ms / 1000).toFixed(1)}s`;
}
