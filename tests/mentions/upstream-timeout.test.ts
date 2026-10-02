import { describe, expect, it } from "vitest";

import { isUpstreamTimeout } from "../../workers/sources/mentions/types";

describe("isUpstreamTimeout", () => {
  it("accepts a TimeoutError DOMException", () => {
    expect(isUpstreamTimeout(new DOMException("t", "TimeoutError"))).toBe(true);
  });

  it("accepts any object whose name is TimeoutError", () => {
    expect(isUpstreamTimeout({ name: "TimeoutError" })).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a plain Error", new Error("x")],
    ["an AbortError DOMException", new DOMException("a", "AbortError")],
    ["null", null],
    ["undefined", undefined],
    ["the string TimeoutError", "TimeoutError"],
    ["a number", 42],
  ])("rejects %s", (_label, error) => {
    expect(isUpstreamTimeout(error)).toBe(false);
  });
});
