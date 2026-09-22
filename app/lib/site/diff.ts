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

export function hasChanged(prevHash: string, nextHash: string): boolean {
  if (typeof prevHash !== "string" || typeof nextHash !== "string") return false;
  if (prevHash.length === 0 || nextHash.length === 0) return false;
  return prevHash !== nextHash;
}

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

/**
 * The stored hunks, with page position. `structuredPatch` produces the bounded
 * `-`/`+` context the packet asks for, over a token-per-line rendering of both
 * texts, so a hunk's `oldStart` *is* its page position: the 1-based word index
 * in the before text. Extracted text is one normalised blob, so a line-based
 * patch of it would name the whole page as every hunk's position and bound
 * nothing.
 */
export function buildStoredHunks(before: string, after: string, context = 2): StoredHunk[] {
  if (context < 0) {
    throw new RangeError("context must be zero or more words of context, never negative");
  }

  const toWordLines = (text: string): string => splitWords(text).join("\n");
  const patch = structuredPatch(
    "before",
    "after",
    toWordLines(before),
    toWordLines(after),
    "",
    "",
    { context },
  );

  // jsdiff appends "\\ No newline at end of file" markers whenever an input does
  // not end in a newline — true of every token-per-line rendering, because the
  // last word has no newline after it. The marker is a file-format concern, not
  // a fact about the copy, and it would sit in every stored hunk as noise the
  // judge reads. Drop it; the hunk's own `-`/`+`/` ` lines carry all the meaning.
  const stripNoNewline = (lines: string[]): string[] =>
    lines.filter((line) => line !== "\\ No newline at end of file");

  return patch.hunks.map((hunk) => {
    const lines = stripNoNewline(hunk.lines);
    // `oldStart` is 1-based and names the hunk's first line, which can be a
    // context line before the change. The change's own position is the first
    // non-context line, one word per context line that preceded it. A pure
    // insertion has no `-` line, so the break must be on anything that is not
    // context — otherwise the trailing context words advance the position past
    // the end of the before text.
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

/** Inputs to the hash-gated builder. */
export interface PageDiffInput {
  prevHash: string;
  nextHash: string;
  beforeText: string;
  afterText: string;
  context?: number;
}

export function buildPageDiff(input: PageDiffInput): PageDiff {
  const { prevHash, nextHash, beforeText, afterText, context = 2 } = input;

  if (!hasChanged(prevHash, nextHash)) {
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
