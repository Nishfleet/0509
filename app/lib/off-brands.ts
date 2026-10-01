const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

export function offBrandsSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${LIST.format(names)} is switched off, so nothing from it shows here.`;
  return `${LIST.format(names)} are switched off, so nothing from them shows here.`;
}
