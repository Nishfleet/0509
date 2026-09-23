import { describe, expect, it } from "vitest";

import { diffPageText } from "../../../app/lib/site/diff";
import { extractPageText } from "../../../app/lib/site/extract-text";

describe("diffPageText", () => {
  it("returns null when the same page is extracted twice", async () => {
    const html = "<p>Plans start at $10. Cancel any time.</p>";
    const prev = await extractPageText(html);
    const next = await extractPageText(html);

    expect(diffPageText(prev, next)).toBeNull();
  });

  it("returns the price word change and one sentence hunk", async () => {
    const prev = await extractPageText("<p>Plans start at $10. Cancel any time.</p>");
    const next = await extractPageText("<p>Plans start at $12. Cancel any time.</p>");
    const pageDiff = diffPageText(prev, next);

    expect(pageDiff).not.toBeNull();
    if (pageDiff === null) return;

    // diff@9.0.0 treats "$" as its own punctuation token and keeps it on the
    // unchanged "Plans start at $" word, so the removed word is "10".
    expect(pageDiff.words.some((change) => change.removed === true && change.value.includes("10"))).toBe(true);
    expect(pageDiff.words.some((change) => change.added === true && change.value.includes("12"))).toBe(true);
    expect(pageDiff.words.some((change) => change.added !== true && change.removed !== true && change.value.endsWith("$"))).toBe(true);
    expect(pageDiff.hunks.length).toBe(1);
    expect(pageDiff.hunks[0]?.oldStart).toBe(1);
    expect(pageDiff.hunks[0]?.lines).toContain("-Plans start at $10.");
    expect(pageDiff.hunks[0]?.lines).toContain("+Plans start at $12.");
  });

  it("covers the third sentence when that sentence changes", async () => {
    const prev = await extractPageText("<p>Alpha ends here. Beta ends here. Gamma stays put.</p>");
    const next = await extractPageText("<p>Alpha ends here. Beta ends here. Gamma moved now.</p>");
    const pageDiff = diffPageText(prev, next);

    expect(pageDiff).not.toBeNull();
    if (pageDiff === null) return;

    const hunk = pageDiff.hunks[0];
    expect(hunk).toBeDefined();
    if (hunk === undefined) return;
    expect(hunk.oldStart + hunk.oldLines - 1).toBeGreaterThanOrEqual(3);
  });
});
