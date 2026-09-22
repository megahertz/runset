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
