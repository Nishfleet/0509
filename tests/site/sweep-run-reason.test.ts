import { describe, expect, it } from "vitest";

import { sweepRunReason } from "../../app/lib/site/sweep-run-reason";

describe("sweepRunReason", () => {
  it("names the pages, the steps and the errors, so a night of failures is diagnosable from the row", () => {
    expect(
      sweepRunReason(
        [
          { step: "check page_rival", error: "browser timeout after 120000ms" },
          { step: "publish page_self", error: "HTTP 403 from https://mybrand.com/pricing" },
        ],
        2,
        40,
      ),
    ).toBe(
      "2 of 40 pages failed in 2 steps: check page_rival: browser timeout after 120000ms; publish page_self: HTTP 403 from https://mybrand.com/pricing",
    );
  });

  it("keeps the row bounded when a whole night fails", () => {
    const failures = Array.from({ length: 40 }, (_, index) => ({
      step: `check page_${String(index)}`,
      error: "x".repeat(400),
    }));
    const reason = sweepRunReason(failures, 40, 40);

    expect(reason?.startsWith("40 of 40 pages failed in 40 steps: ")).toBe(true);
    expect(reason).toContain("...; ");
    expect(reason).toContain("35 more");
    expect(reason?.length).toBeLessThan(1_000);
  });

  it("writes no reason for a clean sweep, so a null reason means no recorded failure", () => {
    expect(sweepRunReason([], 0, 40)).toBeNull();
  });

  it("counts one failing step in the singular", () => {
    expect(sweepRunReason([{ step: "check page_rival", error: "HTTP 500" }], 1, 40)).toBe(
      "1 of 40 pages failed in 1 step: check page_rival: HTTP 500",
    );
  });
});
