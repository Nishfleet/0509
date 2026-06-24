import { describe, expect, it } from "vitest";

import { canUsePlanFeature } from "~/lib/plan-entitlements";
import { ROUTE_FEATURE_REQUIREMENTS } from "~/lib/plan-feature-gate.server";

describe("plan feature enforcement matrix", () => {
  it("enumerates required route feature gates", () => {
    const routeIds = ROUTE_FEATURE_REQUIREMENTS.map((entry) => entry.routeId);
    expect(routeIds).toEqual(
      expect.arrayContaining([
        "api.v1.$resourceType.$resourceId",
        "api.v1.actions",
        "api.mcp",
        "export.$resourceType.$resourceId",
        "app.reports",
        "app.team",
      ]),
    );
  });

  it("keeps agency-only surfaces off scout and starter", () => {
    expect(canUsePlanFeature("scout", "api_access")).toBe(false);
    expect(canUsePlanFeature("starter", "mcp_access")).toBe(false);
    expect(canUsePlanFeature("agency", "api_access")).toBe(true);
    expect(canUsePlanFeature("agency", "share_links")).toBe(true);
  });

  it("keeps starter exports available only from starter upward", () => {
    expect(canUsePlanFeature("scout", "export_csv")).toBe(false);
    expect(canUsePlanFeature("starter", "export_csv")).toBe(true);
    expect(canUsePlanFeature("starter", "share_links")).toBe(false);
  });
});
