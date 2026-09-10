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
    // Landed sources flip implemented to true (#2189 google_ads); only the
    // remaining stubs must still be false.
    const stubs = SOURCES.filter((a) => !a.implemented);
    for (const adapter of stubs) {
      expect(adapter.implemented, adapter.id).toBe(false);
    }
  });

  it("every stub fetch returns unavailable with reason not_implemented", async () => {
    const stubs = SOURCES.filter((a) => !a.implemented);
    for (const adapter of stubs) {
      const result = await adapter.fetch(baseEnv, {
        competitorId: "c1",
        competitorLabel: "Test",
      });
      expect(result, adapter.id).toEqual({ unavailable: true, reason: "not_implemented" });
    }
  });

  it("every stub diff returns an empty array", () => {
    const stubs = SOURCES.filter((a) => !a.implemented);
    for (const adapter of stubs) {
      expect(adapter.diff(null, { payload: {} }), adapter.id).toEqual([]);
    }
  });

  it("getSourceAdapter resolves by id", () => {
    expect(getSourceAdapter("google")?.id).toBe("google");
    expect(getSourceAdapter("hiring")?.id).toBe("hiring");
    expect(getSourceAdapter("nonexistent" as never)).toBeUndefined();
  });

  it("getEnabledSources includes implemented sources whose requiresEnv is true (agency = all sources)", () => {
    const plan = "agency" as PlanFamily;
    // google_ads is implemented with requiresEnv: () => true; stubs still
    // return false and are excluded. Agency allows all sources.
    expect(getEnabledSources(baseEnv, plan).map((a) => a.id)).toEqual(["google_ads"]);
  });

  it("getEnabledSources excludes google_ads from the free plan (allowlist is ['meta'])", () => {
    // The free plan's `sources` entitlement is ['meta'] (#2212); google_ads
    // is not in the allowlist, so it is excluded even though requiresEnv
    // is true. Stubs are excluded by requiresEnv.
    const plan = "free" as PlanFamily;
    const enabled = getEnabledSources(baseEnv, plan);
    expect(enabled).toEqual([]);
  });
});
