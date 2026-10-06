export function neutralizeBareUrls(text: string): string {
  return text.replaceAll("://", "[:]//").replaceAll(/www\./gi, (found) => `${found.slice(0, 3)}[.]`);
}
