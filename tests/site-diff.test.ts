import { describe, expect, it } from "vitest";

import { diffSiteText } from "../app/lib/site/diff";

describe("diffSiteText", () => {
  it("reports no change for identical text", () => {
    const d = diffSiteText("a\nb\nc\n", "a\nb\nc\n");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.excerpt).toBe("");
  });

  it("counts added and removed lines and marks the excerpt", () => {
    const d = diffSiteText(
      "Plans from $20\nFree shipping\n",
      "Plans from $25\nFree shipping\nNew tier launched\n",
    );
    expect(d.removed).toBe(1);
    expect(d.added).toBe(2);
    expect(d.excerpt).toContain("- Plans from $20");
    expect(d.excerpt).toContain("+ Plans from $25");
    expect(d.excerpt).toContain("+ New tier launched");
  });

  it("bounds the excerpt on a huge diff", () => {
    const before = Array.from({ length: 500 }, (_, i) => `old line ${i}`).join("\n");
    const after = Array.from({ length: 500 }, (_, i) => `new line ${i}`).join("\n");
    const d = diffSiteText(before, after);
    expect(d.excerpt.length).toBeLessThanOrEqual(4500);
    expect(d.added).toBeGreaterThan(0);
    expect(d.removed).toBeGreaterThan(0);
  });
});
