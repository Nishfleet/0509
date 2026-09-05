import { readFileSync } from "node:fs";
import { join } from "node:path";
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
        "app.watchlists",
        "app.account",
        "share.$token",
        "delivery.server",
      ]),
    );
  });

  it("covers delivery save and execution surfaces", () => {
    const serialized = JSON.stringify(ROUTE_FEATURE_REQUIREMENTS);
    expect(serialized).toContain("save-delivery-config");
    expect(serialized).toContain("slack_delivery");
    expect(serialized).toContain("high_priority_alerts");
    expect(serialized).toContain("email_delivery");
    expect(serialized).toContain("deliverWatchlistAlerts");
  });

  it("covers agency branding save and render surfaces", () => {
    const serialized = JSON.stringify(ROUTE_FEATURE_REQUIREMENTS);
    expect(serialized).toContain("save-report-branding");
    expect(serialized).toContain("agency_branding");
    expect(serialized).toContain("preparedBy");
  });

  it("keeps server entry points wired to authoritative gates", () => {
    // BL-007: the watchlists action moved out of the route into its own
    // server module; the gate is asserted where the code now lives.
    const watchlists = readFileSync(
      join(process.cwd(), "app/lib/watchlist-route-actions.server.ts"),
      "utf8",
    );
    const delivery = readFileSync(join(process.cwd(), "app/lib/delivery.server.ts"), "utf8");
    const share = readFileSync(join(process.cwd(), "app/routes/share.$token.tsx"), "utf8");

    expect(watchlists).toContain("requireDeliveryConfigSave");
    expect(delivery).toContain("resolveEntitledDeliveryConfigs");
		expect(share).toContain("resolveWorkspaceBrandIdentity");
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
    // WP-29: watermarked share links from Starter; Scout still blocked.
    expect(canUsePlanFeature("scout", "share_links")).toBe(false);
    expect(canUsePlanFeature("starter", "share_links")).toBe(true);
  });

  it("keeps scout off slack delivery and instant alerts", () => {
    expect(canUsePlanFeature("scout", "slack_delivery")).toBe(false);
    expect(canUsePlanFeature("scout", "high_priority_alerts")).toBe(false);
    expect(canUsePlanFeature("starter", "slack_delivery")).toBe(true);
    expect(canUsePlanFeature("starter", "agency_branding")).toBe(false);
    expect(canUsePlanFeature("agency", "agency_branding")).toBe(true);
  });
});
