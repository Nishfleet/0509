import { describe, expect, it } from "vitest";

import { ACT_AT, REJECT_AT, noulAction } from "../app/lib/jev/thresholds";

describe("thresholds constants", () => {
  it("exposes the act and reject boundaries", () => {
    expect(ACT_AT).toBe(0.9);
    expect(REJECT_AT).toBe(0.1);
  });

  it("rejects below the act boundary", () => {
    expect(REJECT_AT).toBeLessThan(ACT_AT);
  });
});

describe("noulAction", () => {
  it("acts at the boundary and above", () => {
    expect(noulAction(1)).toBe("act");
    expect(noulAction(ACT_AT)).toBe("act");
  });

  it("asks just inside the act boundary", () => {
    expect(noulAction(0.8999)).toBe("maybe");
  });

  it("rejects at the boundary and below", () => {
    expect(noulAction(0)).toBe("reject");
    expect(noulAction(REJECT_AT)).toBe("reject");
  });

  it("asks just inside the reject boundary", () => {
    expect(noulAction(0.1001)).toBe("maybe");
  });

  it("asks in the middle", () => {
    expect(noulAction(0.5)).toBe("maybe");
  });

  it("asks for NaN, where neither comparison is true", () => {
    expect(noulAction(Number.NaN)).toBe("maybe");
  });
});
