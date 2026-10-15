import { describe, expect, it } from "vitest";

import { sweepHealth } from "../app/lib/sweep-health";

describe("sweepHealth", () => {
  it("is ok when nothing failed", () => {
    expect(sweepHealth({ failed: 0, attempted: 40, missed: [] })).toEqual({ state: "ok" });
  });

  it("is degraded, naming the pages it missed, when a few failed", () => {
    expect(sweepHealth({ failed: 2, attempted: 40, missed: ["page-a", "page-b"] })).toEqual({
      state: "degraded",
      reason: "2 of 40 failed: page-a, page-b",
    });
  });

  it("names at most ten missed pages and counts the rest", () => {
    const missed = Array.from({ length: 13 }, (_, index) => `p${String(index)}`);
    const health = sweepHealth({ failed: 13, attempted: 100, missed });
    expect(health).toMatchObject({ state: "degraded" });
    expect(health.state === "ok" ? "" : health.reason).toContain("p9 and 3 more");
  });

  it("is failed when half or more failed", () => {
    expect(sweepHealth({ failed: 20, attempted: 40, missed: [] })).toEqual({
      state: "failed",
      reason: "20 of 40 failed",
    });
    expect(sweepHealth({ failed: 1, attempted: 1, missed: ["only"] })).toMatchObject({ state: "failed" });
  });
});
