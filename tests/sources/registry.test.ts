import { describe, expect, it } from "vitest";

import { SOURCES, getEnabledSources, getSourceAdapter } from "~/lib/sources/registry.server";
import { SOURCE_IDS } from "~/lib/sources/types";
import type { AppEnv } from "~/lib/env.server";
import type { PlanFamily } from "~/lib/plan-entitlements";

const baseEnv = {
  META_TOKEN_ENCRYPTION_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://0509.io",
} satisfies Partial<AppEnv> as AppEnv;

describe("source registry", () => {
  it("registers exactly the six source ids at the exact paths", () => {
    expect(SOURCES.map((a) => a.id).sort()).toEqual([...SOURCE_IDS].sort());
  });

  // Stubs = adapters still marked implemented: false. Source tickets that
  // flip their stub to real (#2198 subdomains) leave the remaining stubs here.
  const stubs = SOURCES.filter((a) => !a.implemented);

  it("every stub adapter exports implemented: false", () => {
    for (const adapter of stubs) {
      expect(adapter.implemented, adapter.id).toBe(false);
    }
  });

  it("every stub fetch returns unavailable with reason not_implemented", async () => {
    for (const adapter of stubs) {
      const result = await adapter.fetch(baseEnv, {
        competitorId: "c1",
        competitorLabel: "Test",
      });
      expect(result, adapter.id).toEqual({ unavailable: true, reason: "not_implemented" });
    }
  });

  it("every stub diff returns an empty array", () => {
    for (const adapter of stubs) {
      expect(adapter.diff(null, { payload: {} }), adapter.id).toEqual([]);
    }
  });

  it("getSourceAdapter resolves by id", () => {
    expect(getSourceAdapter("google")?.id).toBe("google");
    expect(getSourceAdapter("hiring")?.id).toBe("hiring");
    expect(getSourceAdapter("subdomains")?.id).toBe("subdomains");
    expect(getSourceAdapter("nonexistent" as never)).toBeUndefined();
  });

  it("getEnabledSources includes implemented adapters with requiresEnv: true", () => {
    const plan = "agency" as PlanFamily;
    const enabled = getEnabledSources(baseEnv, plan);
    const enabledIds = enabled.map((a) => a.id);
    // subdomains (#2198) is implemented and requiresEnv: true.
    expect(enabledIds).toContain("subdomains");
    // Stubs (requiresEnv: false) are excluded.
    for (const stub of stubs) {
      expect(enabledIds).not.toContain(stub.id);
    }
  });

  it("getEnabledSources treats a missing sources entitlement as 'all'", () => {
    // PlanEntitlements has no `sources` field yet (#2212 adds it). The
    // registry must not throw and must still apply requiresEnv.
    const plan = "scout" as PlanFamily;
    const enabled = getEnabledSources(baseEnv, plan);
    const enabledIds = enabled.map((a) => a.id);
    expect(enabledIds).toContain("subdomains");
  });

  // Issue #3195 — the TikTok flag, both ends, pinned: the per-source kill
  // flag IS (requiresEnv → DECODO_SCRAPER_AUTH) + (the plan's `sources`
  // entitlement). These three pin enabled/kill on both axes; the 7-day
  // cadence and the shared 800-requests/month Decodo budget stay covered by
  // tests/sources/tiktok-ads-snapshot.test.ts and -library.test.ts.
  it("tiktok ships behind its flag: enabled for scout when DECODO_SCRAPER_AUTH is set (#3195)", () => {
    const tiktokEnv = { ...baseEnv, DECODO_SCRAPER_AUTH: "dGVzdC1hdXRo" } as AppEnv;
    expect(getEnabledSources(tiktokEnv, "scout").map((a) => a.id)).toContain("tiktok");
  });

  it("tiktok kill flag: dropped from enabled sources when DECODO_SCRAPER_AUTH is absent (#3195)", () => {
    expect(getEnabledSources(baseEnv, "scout").map((a) => a.id)).not.toContain("tiktok");
  });

  it("tiktok stays off the free plan (sources: [meta]) even with the flag credential present (#3195)", () => {
    const tiktokEnv = { ...baseEnv, DECODO_SCRAPER_AUTH: "dGVzdC1hdXRo" } as AppEnv;
    expect(getEnabledSources(tiktokEnv, "free").map((a) => a.id)).not.toContain("tiktok");
  });
});
