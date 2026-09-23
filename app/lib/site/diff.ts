import { diffWords } from "diff";

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

export function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function diffPageText(before: string, after: string): PageDiff {
  if (before === after) {
    return { hunks: [], addedWords: 0, removedWords: 0 };
  }

  const parts = diffWords(before, after);
  const hunks: DiffHunk[] = [];
  let addedWords = 0;
  let removedWords = 0;
  let atWord = 0;
  let removed = "";
  let added = "";

  const flush = () => {
    if (removed === "" && added === "") return;
    hunks.push({ before: removed, after: added, atWord });
    removed = "";
    added = "";
  };

  for (const part of parts) {
    if (part.removed) {
      removed += part.value;
      removedWords += countWords(part.value);
      continue;
    }
    if (part.added) {
      added += part.value;
      addedWords += countWords(part.value);
      continue;
    }
    flush();
    atWord += countWords(part.value);
  }
  flush();

  return { hunks, addedWords, removedWords };
}

export function isEmptyDiff(diff: PageDiff): boolean {
  return diff.hunks.length === 0;
}
