import { describe, expect, it } from "vitest";
import { safeCanaryDetail, CANARY_DETAIL_PATTERN } from "~/lib/canary-detail";
describe("safeCanaryDetail (Gate C journal gets the failure class, never raw text)", () => {
  it("renders name + message under the strict charset and length", () => {
    const d = safeCanaryDetail(new Error("D1_ERROR: no such table: proof_capture; SELECT * FROM x -- ' OR 1=1"));
    expect(CANARY_DETAIL_PATTERN.test(d)).toBe(true);
    expect(d).toContain("no such table");
    expect(d.length).toBeLessThanOrEqual(160);
  });
  it("never returns an empty string", () => {
    expect(safeCanaryDetail("")).toBe("unrenderable_error");
    expect(safeCanaryDetail(null)).toBe("null");
  });
});
