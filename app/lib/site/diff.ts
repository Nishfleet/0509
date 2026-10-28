import { diffWords, structuredPatch } from "diff";
import type { Change, StructuredPatchHunk } from "diff";

import { hasChanged } from "./extract-text";
import type { ExtractedPageText } from "./extract-text";

const WORD_DIFF_MAX_EDIT_LENGTH = 1500;

const WORDS = new Intl.Segmenter("en", { granularity: "word" });

export interface PageDiff {
  words: Change[] | null;
  hunks: StructuredPatchHunk[];
  beforeHash: string;
  afterHash: string;
}

export function toSentenceLines(text: string): string {
  return Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(text), (s) => s.segment.trim())
    .filter((s) => s.length > 0)
    .join("\n");
}

export function diffPageText(prev: ExtractedPageText, next: ExtractedPageText): PageDiff | null {
  if (!hasChanged(prev.hash, next.hash)) return null;
  const words = diffWords(prev.text, next.text, { maxEditLength: WORD_DIFF_MAX_EDIT_LENGTH }) ?? null;
  const hunks = structuredPatch("before", "after", toSentenceLines(prev.text), toSentenceLines(next.text), "", "", {
    context: 1,
  }).hunks;
  return { words, hunks, beforeHash: prev.hash, afterHash: next.hash };
}

function wordCount(value: string): number {
  return Array.from(WORDS.segment(value)).filter((segment) => segment.isWordLike).length;
}

export function changedWordCounts(diff: PageDiff | null): { added: number; removed: number } {
  if (diff === null) return { added: 0, removed: 0 };
  if (diff.words !== null) {
    return {
      added: diff.words.filter((c) => c.added).reduce((n, c) => n + wordCount(c.value), 0),
      removed: diff.words.filter((c) => c.removed).reduce((n, c) => n + wordCount(c.value), 0),
    };
  }
  const lines = diff.hunks.flatMap((hunk) => hunk.lines);
  const total = (prefix: string) =>
    lines.filter((line) => line.startsWith(prefix)).reduce((n, line) => n + wordCount(line.slice(1)), 0);
  return { added: total("+"), removed: total("-") };
}
