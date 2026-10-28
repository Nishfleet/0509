import { describe, expect, it } from "vitest";

import { LENDING_TIER } from "../../app/lib/data/active-workspace";
import { PLANS } from "../../app/lib/billing/plans";

describe("the plan that lends itself to client brands", () => {
  it("is exactly the plan with no workspace limit", () => {
    const unlimited = PLANS.filter((plan) => plan.limits.workspaces_max === null).map((plan) => plan.id);
    expect(unlimited).toEqual([LENDING_TIER]);
  });
});
