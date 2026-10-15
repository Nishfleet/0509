import { describe, expect, it } from "vitest";

import { changeExcerpt } from "../../app/lib/site-change-excerpt";

describe("changeExcerpt", () => {
  it("keeps at most 4 hunks of 20 lines, each cut at 240 characters", () => {
    const hunk = Array.from({ length: 30 }, (_, index) => (index === 0 ? "x".repeat(300) : `-line ${String(index)}`));
    const out = changeExcerpt([hunk, hunk, hunk, hunk, hunk]);
    expect(out).toHaveLength(4);
    expect(out[0]?.lines).toHaveLength(20);
    expect(out[0]?.lines[0]).toHaveLength(240);
  });

  it("passes a short hunk through unchanged", () => {
    expect(changeExcerpt([["@@ -1 +1 @@", "-Old", "+New"]])).toEqual([{ lines: ["@@ -1 +1 @@", "-Old", "+New"] }]);
  });
});
