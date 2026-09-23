import { describe, expect, it } from "vitest";

import { briefText, digestIdFromAlertId } from "../../app/lib/delivery-alert";

describe("delivery failure alert rows", () => {
  it("reads the brief text and the digest id", () => {
    expect(briefText('{"text":"hello"}')).toBe("hello");
    expect(briefText("not json")).toBe("");
    expect(briefText('{"html":"<p>x</p>"}')).toBe("");
    expect(briefText('{"text":123}')).toBe("");
    expect(briefText(null)).toBe("");
    expect(digestIdFromAlertId("dlq:dg_1")).toBe("dg_1");
    expect(digestIdFromAlertId("al_1")).toBeNull();
  });
});
