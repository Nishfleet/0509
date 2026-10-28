import { describe, expect, it } from "vitest";

import { changedWordCounts, diffPageText, toSentenceLines } from "../../../app/lib/site/diff";
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

    expect(toSentenceLines(prev.text)).toBe("Plans start at $10.\nCancel any time.");
    expect(toSentenceLines(next.text)).toBe("Plans start at $12.\nCancel any time.");

    expect(pageDiff.words?.some((change) => change.removed && change.value.includes("10"))).toBe(true);
    expect(pageDiff.words?.some((change) => change.added && change.value.includes("12"))).toBe(true);
    expect(pageDiff.words?.some((change) => !change.added && !change.removed && change.value.endsWith("$"))).toBe(true);
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

  it("counts the changed words of a small edit from the word diff", async () => {
    const prev = await extractPageText("<p>Plans start at $10. Cancel any time.</p>");
    const next = await extractPageText("<p>Plans start at $12 per month. Cancel any time.</p>");
    const pageDiff = diffPageText(prev, next);

    expect(pageDiff?.words).not.toBeNull();
    expect(changedWordCounts(pageDiff)).toEqual({ added: 3, removed: 1 });
  });

  it("skips the word diff on a page that changed almost everywhere and counts from the sentence diff", async () => {
    const sentences = (prefix: string) =>
      Array.from(
        { length: 1200 },
        (_, i) => `<p>${prefix}${i} alpha${prefix}${i} beta${prefix}${i} gamma${prefix}${i}.</p>`,
      ).join("");
    const prev = await extractPageText(sentences("a"));
    const next = await extractPageText(sentences("b"));
    const pageDiff = diffPageText(prev, next);

    expect(pageDiff).not.toBeNull();
    expect(pageDiff?.words).toBeNull();
    expect(pageDiff?.hunks.length).toBeGreaterThan(0);
    expect(changedWordCounts(pageDiff)).toEqual({ added: 4800, removed: 4800 });
  });

  it("counts no words when there is no diff", () => {
    expect(changedWordCounts(null)).toEqual({ added: 0, removed: 0 });
  });
});
