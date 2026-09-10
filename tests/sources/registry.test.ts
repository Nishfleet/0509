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

  it("every stub adapter exports implemented: false", () => {
    for (const adapter of SOURCES) {
      expect(adapter.implemented, adapter.id).toBe(false);
    }
  });

  it("every stub fetch returns unavailable with reason not_implemented", async () => {
    for (const adapter of SOURCES) {
      const result = await adapter.fetch(baseEnv, {
        competitorId: "c1",
        competitorLabel: "Test",
      });
      expect(result, adapter.id).toEqual({ unavailable: true, reason: "not_implemented" });
    }
  });

  it("every stub diff returns an empty array", () => {
    for (const adapter of SOURCES) {
      expect(adapter.diff(null, { payload: {} }), adapter.id).toEqual([]);
    }
  });

  it("getSourceAdapter resolves by id", () => {
    expect(getSourceAdapter("google")?.id).toBe("google");
    expect(getSourceAdapter("hiring")?.id).toBe("hiring");
    expect(getSourceAdapter("nonexistent" as never)).toBeUndefined();
  });

  it("getEnabledSources filters by requiresEnv (all stubs return false → empty)", () => {
    const plan = "agency" as PlanFamily;
    expect(getEnabledSources(baseEnv, plan)).toEqual([]);
  });

  it("getEnabledSources treats a missing sources entitlement as 'all' (stubs still filtered by requiresEnv)", () => {
    // PlanEntitlements has no `sources` field yet (#2212 adds it). The
    // registry must not throw and must still apply requiresEnv.
    const plan = "free" as PlanFamily;
    const enabled = getEnabledSources(baseEnv, plan);
    expect(enabled).toEqual([]);
  });
});
