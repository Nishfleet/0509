import { structuredPatch } from "diff";

interface DiffHunk {
  before: string;
  after: string;
  atWord: number;
}

export interface PageDiff {
  hunks: DiffHunk[];
  addedWords: number;
  removedWords: number;
}

const CONTEXT_WORDS = 2;

export function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function toWordLines(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  return `${trimmed.split(/\s+/).join("\n")}\n`;
}

export function diffPageText(before: string, after: string): PageDiff {
  if (before === after) {
    return { hunks: [], addedWords: 0, removedWords: 0 };
  }

  const patch = structuredPatch(
    "before",
    "after",
    toWordLines(before),
    toWordLines(after),
    "",
    "",
    { context: CONTEXT_WORDS },
  );

  const hunks: DiffHunk[] = [];
  let addedWords = 0;
  let removedWords = 0;

  for (const hunk of patch.hunks) {
    const removed: string[] = [];
    const added: string[] = [];
    let atWord = hunk.oldStart - 1;

    for (const line of hunk.lines) {
      if (line.startsWith("-")) {
        removed.push(line.slice(1));
        continue;
      }
      if (line.startsWith("+")) {
        added.push(line.slice(1));
        continue;
      }
      if (removed.length === 0 && added.length === 0) {
        atWord += 1;
      }
    }

    if (removed.length === 0 && added.length === 0) continue;

    hunks.push({ before: removed.join(" "), after: added.join(" "), atWord });
    removedWords += removed.length;
    addedWords += added.length;
  }

  return { hunks, addedWords, removedWords };
}

export function isEmptyDiff(diff: PageDiff): boolean {
  return diff.hunks.length === 0;
}
