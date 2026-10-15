import { describe, expect, it } from "vitest";

import { sweepFailure } from "../app/lib/sweep-health";

describe("sweepFailure", () => {
  it("is healthy when nothing failed", () => {
    expect(sweepFailure({ failed: 0, attempted: 40 })).toBeNull();
  });

  it("is healthy when only a few of many failed", () => {
    expect(sweepFailure({ failed: 3, attempted: 40 })).toBeNull();
  });

  it("is a failure when half or more failed", () => {
    expect(sweepFailure({ failed: 20, attempted: 40 })).toBe("20 of 40 failed");
    expect(sweepFailure({ failed: 40, attempted: 40 })).toBe("40 of 40 failed");
  });

  it("is a failure when the only page failed", () => {
    expect(sweepFailure({ failed: 1, attempted: 1 })).toBe("1 of 1 failed");
  });
});
