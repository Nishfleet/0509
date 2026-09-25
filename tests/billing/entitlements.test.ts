import { describe, expect, it } from "vitest";

import {
  MOST_RESTRICTIVE,
  resolveEntitlements,
  type Entitlements,
} from "../../app/lib/billing/entitlements";

const SCOUT = {
  competitors: 5,
  site_pages_scope: "home_pricing",
  own_site_alerts: false,
  paid_scraper_sources: false,
  marks_history_days: 90,
  standing_history_weeks: 4,
  workspaces_max: 1,
  api_access: true,
} satisfies Entitlements;

const STARTER = {
  competitors: 15,
  site_pages_scope: "all",
  own_site_alerts: true,
  paid_scraper_sources: true,
  marks_history_days: 365,
  standing_history_weeks: 52,
  workspaces_max: 1,
  api_access: true,
} satisfies Entitlements;

const AGENCY = {
  competitors: 50,
  site_pages_scope: "all",
  own_site_alerts: true,
  paid_scraper_sources: true,
  marks_history_days: 365,
  standing_history_weeks: 52,
  workspaces_max: null,
  api_access: true,
} satisfies Entitlements;

const empty = JSON.stringify({});

describe("resolveEntitlements", () => {
  it("returns each tier's full defaults for an empty override object", () => {
    expect(resolveEntitlements("scout", empty)).toEqual(SCOUT);
    expect(resolveEntitlements("starter", empty)).toEqual(STARTER);
    expect(resolveEntitlements("agency", empty)).toEqual(AGENCY);
  });

  it("returns MOST_RESTRICTIVE for an unknown tier", () => {
    expect(resolveEntitlements("enterprise", empty)).toEqual(MOST_RESTRICTIVE);
  });

  it("overrides one key and leaves the other seven at the tier default", () => {
    expect(resolveEntitlements("scout", JSON.stringify({ competitors: 7 }))).toEqual({
      ...SCOUT,
      competitors: 7,
    });
  });

  it("ignores override values of the wrong type", () => {
    expect(
      resolveEntitlements("scout", JSON.stringify({ competitors: "7", api_access: "yes" })),
    ).toEqual(SCOUT);
  });

  it("falls back to the tier defaults when limitsJson is not JSON", () => {
    expect(resolveEntitlements("starter", "not json")).toEqual(STARTER);
  });

  it("drops override keys that are not in ENTITLEMENT_KEYS", () => {
    const result = resolveEntitlements("scout", JSON.stringify({ unknown_key: true }));
    expect(result).toEqual(SCOUT);
    expect(result).not.toHaveProperty("unknown_key");
  });
});
