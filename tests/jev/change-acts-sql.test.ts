import { describe, expect, it } from "vitest";

import { CHANGE_KIND_QUESTION_ID, PRICING_ACT_AT, changeActsSql } from "../../app/lib/jev/thresholds";

describe("changeActsSql", () => {
  it("acts at 0.9 for any verdict and at the pricing mark only when the stored kind verdict says pricing", () => {
    const sql = changeActsSql("s", "v");
    expect(sql).toContain("v.p >= 0.9");
    expect(sql).toContain(`v.p >= ${String(PRICING_ACT_AT)}`);
    expect(sql).toContain(`kind_v.question_id = '${CHANGE_KIND_QUESTION_ID}' AND kind_v.choice = 'pricing'`);
    expect(sql).not.toContain("aspect");
    expect(PRICING_ACT_AT).toBe(0.6);
  });
});
