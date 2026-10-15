const MAX_HUNKS = 4;
const MAX_LINES = 20;
const MAX_LINE_CHARS = 240;

export function changeExcerpt(hunks: readonly (readonly string[])[]): { lines: string[] }[] {
  return hunks.slice(0, MAX_HUNKS).map((lines) => ({
    lines: lines.slice(0, MAX_LINES).map((line) => line.slice(0, MAX_LINE_CHARS)),
  }));
}
