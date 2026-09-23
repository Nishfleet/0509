import { diffWords, structuredPatch } from "diff";

export interface WordChange {
  before: string;
  after: string;
  startWord: number;
  endWord: number;
  startChar: number;
}

export interface StoredHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  startWord: number;
}

export interface PageDiff {
  changes: WordChange[];
  hunks: StoredHunk[];
  wordsBefore: number;
  wordsAfter: number;
  wordDelta: number;
}

const splitWords = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export function diffWordsPositioned(before: string, after: string): WordChange[] {
  const parts = diffWords(before, after);

  const changes: WordChange[] = [];
  let beforeWord = 0;
  let beforeChar = 0;
  let pendingRemoved: string | null = null;
  let pendingStart = -1;
  let pendingStartChar = -1;

  const flush = (added: string) => {
    if (pendingRemoved === null) return;
    changes.push({
      before: pendingRemoved,
      after: added,
      startWord: pendingStart,
      endWord: beforeWord,
      startChar: pendingStartChar,
    });
    pendingRemoved = null;
    pendingStart = -1;
    pendingStartChar = -1;
  };

  for (const part of parts) {
    if (part.removed) {
      flush("");
      pendingRemoved = part.value;
      pendingStart = beforeWord;
      pendingStartChar = beforeChar;
      beforeWord += splitWords(part.value).length;
      beforeChar += part.value.length;
      continue;
    }

    if (part.added) {
      if (pendingRemoved === null) {
        changes.push({
          before: "",
          after: part.value,
          startWord: beforeWord,
          endWord: beforeWord,
          startChar: beforeChar,
        });
        continue;
      }
      flush(part.value);
      continue;
    }

    flush("");
    beforeWord += splitWords(part.value).length;
    beforeChar += part.value.length;
  }

  flush("");

  return changes;
}

export function buildStoredHunks(before: string, after: string, context = 2): StoredHunk[] {
  if (context < 0) {
    throw new RangeError("context must be zero or more words of context, never negative");
  }

  const withNewline = (text: string): string =>
    text.endsWith("\n") ? text : `${text}\n`;

  const toWordLines = (text: string): string => withNewline(splitWords(text).join("\n"));
  const patch = structuredPatch(
    "before",
    "after",
    toWordLines(before),
    toWordLines(after),
    "",
    "",
    { context },
  );

  return patch.hunks.map((hunk) => {
    const lines = hunk.lines;
    let startWord = hunk.oldStart - 1;
    for (const line of lines) {
      if (!line.startsWith(" ")) break;
      startWord += 1;
    }
    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines,
      startWord,
    };
  });
}

export interface PageDiffInput {
  prevHash: string;
  nextHash: string;
  beforeText: string;
  afterText: string;
  context?: number;
}

export function buildPageDiff(input: PageDiffInput): PageDiff {
  const { prevHash, nextHash, beforeText, afterText, context = 2 } = input;

  if (prevHash.length === 0 || nextHash.length === 0 || prevHash === nextHash) {
    throw new Error(
      "hash gate has not fired: refusing to diff unchanged payloads " +
        "(a Workflow step that reaches this needs to write its snapshot row and stop)",
    );
  }

  const changes = diffWordsPositioned(beforeText, afterText);
  const hunks = buildStoredHunks(beforeText, afterText, context);
  const wordsBefore = splitWords(beforeText).length;
  const wordsAfter = splitWords(afterText).length;

  return { changes, hunks, wordsBefore, wordsAfter, wordDelta: wordsAfter - wordsBefore };
}
