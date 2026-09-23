import { diffWords, structuredPatch } from "diff";

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface PageDiff {
  changed: boolean;
  addedWords: number;
  removedWords: number;
  hunks: DiffHunk[];
}

function toSentenceLines(text: string): string {
  return text.split(/(?<=[.!?])\s+/).join("\n") + "\n";
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function diffPageText(before: string, after: string): PageDiff {
  const hunks = structuredPatch(
    "before",
    "after",
    toSentenceLines(before),
    toSentenceLines(after),
    "",
    "",
    { context: 1 },
  ).hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }));

  let addedWords = 0;
  let removedWords = 0;
  for (const part of diffWords(before, after)) {
    if (part.added) addedWords += wordCount(part.value);
    if (part.removed) removedWords += wordCount(part.value);
  }

  return {
    changed: hunks.length > 0,
    addedWords,
    removedWords,
    hunks,
  };
}
