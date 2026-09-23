import { diffWords, structuredPatch } from "diff";
import type { Change, StructuredPatchHunk } from "diff";

import { hasChanged } from "./extract-text";
import type { ExtractedPageText } from "./extract-text";

export interface PageDiff {
  words: Change[];
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
  const words = diffWords(prev.text, next.text);
  const hunks = structuredPatch(
    "before",
    "after",
    toSentenceLines(prev.text),
    toSentenceLines(next.text),
    "",
    "",
    { context: 1 },
  ).hunks;
  return { words, hunks, beforeHash: prev.hash, afterHash: next.hash };
}
