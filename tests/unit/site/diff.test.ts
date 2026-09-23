import { describe, expect, it } from "vitest";

import type { DiffHunk } from "../../../app/lib/site/diff";
import { diffPageText } from "../../../app/lib/site/diff";

const BEFORE = "Welcome to Acme. Plans start at £40 a month. Cancel anytime.";

describe("diffPageText", () => {
  it("reports no change for identical texts", () => {
    const result = diffPageText(BEFORE, BEFORE);

    expect(result.changed).toBe(false);
    expect(result.hunks).toEqual([]);
    expect(result.addedWords).toBe(0);
    expect(result.removedWords).toBe(0);
  });

  it("diffs a price change as one hunk with added and removed words", () => {
    const after = "Welcome to Acme. Plans start at £35 a month. Cancel anytime.";
    const result = diffPageText(BEFORE, after);

    expect(result.changed).toBe(true);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks.some((hunk) => hunk.lines.some((line) => line.startsWith("-") && line.includes("£40")))).toBe(true);
    expect(result.hunks.some((hunk) => hunk.lines.some((line) => line.startsWith("+") && line.includes("£35")))).toBe(true);
    expect(result.addedWords).toBeGreaterThanOrEqual(1);
    expect(result.removedWords).toBeGreaterThanOrEqual(1);
  });

  it("maps each structuredPatch hunk onto exactly the five DiffHunk fields", () => {
    const after = "Welcome to Acme. Plans start at £35 a month. Cancel anytime.";
    const expected: DiffHunk = {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        " Welcome to Acme.",
        "-Plans start at £40 a month.",
        "+Plans start at £35 a month.",
        " Cancel anytime.",
      ],
    };

    expect(diffPageText(BEFORE, after).hunks).toEqual([expected]);
  });

  it("counts only added words when a sentence is appended", () => {
    const result = diffPageText(BEFORE, `${BEFORE} New: free shipping.`);

    expect(result.changed).toBe(true);
    expect(result.addedWords).toBeGreaterThanOrEqual(3);
    expect(result.removedWords).toBe(0);
  });
});
