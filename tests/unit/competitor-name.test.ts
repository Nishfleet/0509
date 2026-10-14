import { describe, expect, it } from "vitest";

import { NAME_EMPTY_ERROR, NAME_MAX, NAME_TOO_LONG_ERROR, parseCompetitorName } from "../../app/lib/competitor-name";

describe("parseCompetitorName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(parseCompetitorName("  Kindred \n  Goods  ")).toEqual({ ok: true, name: "Kindred Goods" });
  });

  it("refuses an empty name", () => {
    expect(parseCompetitorName("   ")).toEqual({ ok: false, message: NAME_EMPTY_ERROR });
  });

  it("refuses a name past the limit and accepts one at it", () => {
    expect(parseCompetitorName("a".repeat(NAME_MAX + 1))).toEqual({ ok: false, message: NAME_TOO_LONG_ERROR });
    expect(parseCompetitorName("a".repeat(NAME_MAX)).ok).toBe(true);
  });
});
