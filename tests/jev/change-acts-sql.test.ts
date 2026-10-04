import { describe, expect, it } from "vitest";

import { PRICING_ACT_AT, changeActsSql } from "../../app/lib/jev/thresholds";

describe("changeActsSql", () => {
  it("acts at 0.9 for any change and at the pricing mark only for a pricing change", () => {
    const sql = changeActsSql("s", "v");
    expect(sql).toBe(
      `(v.p >= 0.9 OR (s.kind = 'change' AND s.aspect = 'pricing' AND v.p >= ${String(PRICING_ACT_AT)}))`,
    );
    expect(PRICING_ACT_AT).toBe(0.6);
  });
});
