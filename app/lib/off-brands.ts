const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

export function offBrandsSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${LIST.format(names)} is off, so it produces nothing here.`;
  return `${LIST.format(names)} are off, so they produce nothing here.`;
}
