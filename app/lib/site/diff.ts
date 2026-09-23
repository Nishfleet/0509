import { diffWords, structuredPatch } from "diff";

interface WordChange {
  before: string;
  after: string;
  atWord: number;
}

interface StoredHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  atWord: number;
}

export interface PageDiff {
  changes: WordChange[];
  hunks: StoredHunk[];
  addedWords: number;
  removedWords: number;
}

const CONTEXT_WORDS = 2;

export function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function words(value: string): string[] {
  const trimmed = value.trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
}

function toWordLines(value: string): string {
  const list = words(value);
  return list.length === 0 ? "" : `${list.join("\n")}\n`;
}

export function diffPageText(before: string, after: string): PageDiff {
  if (before === after) {
    return { changes: [], hunks: [], addedWords: 0, removedWords: 0 };
  }

  const changes: WordChange[] = [];
  let atWord = 0;
  let removed: string[] = [];
  let added: string[] = [];
  let changeAt = 0;

  const flush = () => {
    if (removed.length === 0 && added.length === 0) return;
    changes.push({ before: removed.join(" "), after: added.join(" "), atWord: changeAt });
    removed = [];
    added = [];
  };

  for (const part of diffWords(before, after)) {
    if (part.removed) {
      if (removed.length === 0 && added.length === 0) changeAt = atWord;
      removed.push(...words(part.value));
      atWord += countWords(part.value);
      continue;
    }
    if (part.added) {
      if (removed.length === 0 && added.length === 0) changeAt = atWord;
      added.push(...words(part.value));
      continue;
    }
    flush();
    atWord += countWords(part.value);
  }
  flush();

  const hunks: StoredHunk[] = structuredPatch(
    "before",
    "after",
    toWordLines(before),
    toWordLines(after),
    "",
    "",
    { context: CONTEXT_WORDS },
  ).hunks.map((hunk) => {
    let hunkAtWord = hunk.oldStart - 1;
    for (const line of hunk.lines) {
      if (!line.startsWith(" ")) break;
      hunkAtWord += 1;
    }
    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.lines,
      atWord: hunkAtWord,
    };
  });

  const addedWords = changes.reduce((total, change) => total + countWords(change.after), 0);
  const removedWords = changes.reduce((total, change) => total + countWords(change.before), 0);

  return { changes, hunks, addedWords, removedWords };
}

export function isEmptyDiff(diff: PageDiff): boolean {
  return diff.hunks.length === 0;
}
