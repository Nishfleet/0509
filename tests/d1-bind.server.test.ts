import { describe, expect, it, vi } from "vitest";

import { bindD1Named } from "~/lib/d1-bind.server";

describe("named D1 bindings", () => {
  it("converts undefined to SQL NULL only when the field opts in", () => {
    const bind = vi.fn(() => ({ run: vi.fn() }));
    const statement = { bind } as unknown as D1PreparedStatement;

    bindD1Named(statement, [
      ["ad.id", "ad-1"],
      ["ad.landingPageUrl", undefined, "null"],
    ]);

    expect(bind).toHaveBeenCalledWith("ad-1", null);
  });

  it("throws before D1 with the required field name", () => {
    const bind = vi.fn();
    const statement = { bind } as unknown as D1PreparedStatement;

    expect(() =>
      bindD1Named(statement, [
        ["ad.id", "ad-1"],
        ["ad.researchSummary", undefined],
      ]),
    ).toThrow(
      'D1 binding "ad.researchSummary" is undefined; pass a supported value or opt in to SQL NULL.',
    );
    expect(bind).not.toHaveBeenCalled();
  });
});
