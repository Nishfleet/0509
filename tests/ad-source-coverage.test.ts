import { describe, expect, it } from "vitest";

import {
  AD_SOURCE_COVERAGE,
  AD_SOURCE_COVERAGE_HONESTY_LINE,
  freePlanCoverageSources,
  paidPlanCoverageSources,
} from "~/lib/ad-source-coverage";
import { SOURCE_IDS } from "~/lib/sources/types";
import { getPlanEntitlements } from "~/lib/plan-entitlements";
import { googleAdsAdapter } from "~/lib/sources/google-ads.server";
import { linkedinAdsAdapter } from "~/lib/sources/linkedin-ads.server";
import { tiktokAdsAdapter } from "~/lib/sources/tiktok-ads.server";

/**
 * Issue #2992: the public coverage notes are ONE shared constant, rendered by
 * /pricing, /docs, and the /pricing markdown body. These tests pin the
 * constant's plan gating to the AUTHORITATIVE plan-entitlements catalog, so
 * the honest copy can never silently drift from what the entitlements grant
 * (free = Meta only; paid = the other three public ad libraries).
 */

describe("AD_SOURCE_COVERAGE", () => {
  it("covers exactly the four tracked ad sources, keyed by the seam's own ids", () => {
    expect(AD_SOURCE_COVERAGE.map((entry) => entry.id).sort()).toEqual(
      ["google_ads", "linkedin", "meta", "tiktok"],
    );
    for (const entry of AD_SOURCE_COVERAGE) {
      // "meta" is the pre-seam primary source path; the other three are
      // registered seam adapters. Every id must be one or the other.
      expect(
        SOURCE_IDS.includes(entry.id as (typeof SOURCE_IDS)[number]) || entry.id === "meta",
        `${entry.id} must be a registered seam source or the meta primary`,
      ).toBe(true);
    }
  });

  it("states what each source covers and what it does not — no empty copy", () => {
    for (const entry of AD_SOURCE_COVERAGE) {
      expect(entry.label.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.covers.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.notCovered.trim().length, entry.id).toBeGreaterThan(0);
      // The issue's rule: the note states region, ad types, and what is not
      // covered. "Not included:" sentences are rendered verbatim after the
      // covers sentence on /pricing and /docs, so they must read as a limit.
      expect(entry.notCovered, entry.id).toMatch(/only|not/i);
    }
  });

  it("matches the plan-entitlements catalog: free watches exactly the every-plan sources", () => {
    const free = getPlanEntitlements("free").sources;
    expect(Array.isArray(free), "free plan must use an allowlist for this test").toBe(true);
    expect(new Set(free as string[])).toEqual(
      new Set(freePlanCoverageSources().map((entry) => entry.id)),
    );
  });

  it("matches the plan-entitlements catalog: paid plans watch everything, so the paid-only trio is the complement", () => {
    for (const plan of ["scout", "starter", "agency"] as const) {
      expect(getPlanEntitlements(plan).sources, plan).toBe("all");
    }
    const paidIds = paidPlanCoverageSources().map((entry) => entry.id);
    // Meta is the only every-plan source; the other three are the paid trio.
    expect(freePlanCoverageSources().map((entry) => entry.id)).toEqual(["meta"]);
    expect(paidIds.sort()).toEqual(["google_ads", "linkedin", "tiktok"]);
  });

  it("labels the sources the way the pages already do — the seam adapters' own labels, not a third variant", () => {
    // The /ads-adjacent registries and the brand-page sections render the
    // seam adapters' labels (components/sources/source-sections.tsx mirrors
    // them); the constant must use the SAME words, or /pricing and /docs
    // visibly name a source the brand page calls something else (review
    // warning, #2992 finish session).
    const byId = new Map(AD_SOURCE_COVERAGE.map((entry) => [entry.id, entry.label]));
    expect(byId.get("google_ads"), "google-ads.server.ts label").toBe(googleAdsAdapter.label);
    expect(byId.get("linkedin"), "linkedin-ads.server.ts label").toBe(linkedinAdsAdapter.label);
    expect(byId.get("tiktok"), "tiktok-ads.server.ts label").toBe(tiktokAdsAdapter.label);
    // "meta" is the primary pre-seam path; its public name comes from the
    // compare citations data, not a seam adapter.
    expect(byId.get("meta")).toBe("Meta Ad Library");
  });

  it("carries the honesty line every surface renders", () => {
    expect(AD_SOURCE_COVERAGE_HONESTY_LINE).toContain("only when it captured something");
    // The phrase-ban vocabulary (tests/public-tree-phrase-ban.test.ts) stays
    // out of the shared copy the public surfaces render.
    for (const banned of ["unavailable", "not measured", "not live-checked", "does not measure", "limited today"]) {
      expect(AD_SOURCE_COVERAGE_HONESTY_LINE.toLowerCase()).not.toContain(banned);
      for (const entry of AD_SOURCE_COVERAGE) {
        expect(`${entry.covers} ${entry.notCovered}`.toLowerCase()).not.toContain(banned);
      }
    }
  });
});
