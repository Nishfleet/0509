import { describe, expect, it } from "vitest";

import { countWords, diffPageText, isEmptyDiff } from "../../../app/lib/site/diff";
import { extractPageText, hasChanged } from "../../../app/lib/site/extract-text";
import copyAfter from "../../fixtures/copy-change-after.html?raw";
import copyBefore from "../../fixtures/copy-change-before.html?raw";
import gymA from "../../fixtures/gymshark-2026-09-22-a.html?raw";
import gymB from "../../fixtures/gymshark-2026-09-22-b.html?raw";

describe("diffPageText", () => {
  it("returns no hunks for identical text, without running the differ", () => {
    const diff = diffPageText("same words here", "same words here");

    expect(diff.hunks).toEqual([]);
    expect(diff.addedWords).toBe(0);
    expect(diff.removedWords).toBe(0);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("folds a replacement into one hunk and carries its word offset", () => {
    const diff = diffPageText("Summer drop is live", "Winter drop is live");

    expect(diff.hunks).toEqual([{ before: "Summer", after: "Winter", atWord: 0 }]);
    expect(diff.addedWords).toBe(1);
    expect(diff.removedWords).toBe(1);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it("offsets a hunk by the words that precede it, not by the whole text", () => {
    const diff = diffPageText("alpha beta gamma", "alpha delta gamma");

    expect(diff.hunks).toEqual([{ before: "beta", after: "delta", atWord: 1 }]);
  });

  it("keeps an adjacent replacement to one hunk, as jsdiff merges them", () => {
    const diff = diffPageText("alpha beta gamma", "alpha delta epsilon");

    expect(diff.hunks).toEqual([
      { before: "beta gamma", after: "delta epsilon", atWord: 1 },
    ]);
  });

  it("counts an insertion as added words with an empty before", () => {
    const diff = diffPageText("Price is 50", "Price is now 50");

    expect(diff.hunks).toEqual([{ before: "", after: "now ", atWord: 2 }]);
    expect(diff.addedWords).toBe(1);
    expect(diff.removedWords).toBe(0);
  });

  it("counts a deletion as removed words with an empty after", () => {
    const diff = diffPageText("Free shipping today", "Free shipping");

    expect(diff.hunks).toEqual([{ before: " today", after: "", atWord: 2 }]);
    expect(diff.addedWords).toBe(0);
    expect(diff.removedWords).toBe(1);
  });

  it("diffs the real gymshark pair to nothing, because the hash gate never escalates it", async () => {
    const a = await extractPageText(gymA);
    const b = await extractPageText(gymB);

    expect(hasChanged(a.hash, b.hash)).toBe(false);
    expect(isEmptyDiff(diffPageText(a.text, b.text))).toBe(true);
  });

  it("diffs the real one-word copy change to exactly that word", async () => {
    const a = await extractPageText(copyBefore);
    const b = await extractPageText(copyAfter);

    expect(hasChanged(a.hash, b.hash)).toBe(true);
    const diff = diffPageText(a.text, b.text);

    expect(diff.hunks).toEqual([{ before: "Summer", after: "Winter", atWord: 1 }]);
  });
});

describe("countWords", () => {
  it("counts whitespace-separated words and treats blank as zero", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  one   two  ")).toBe(2);
  });
});
