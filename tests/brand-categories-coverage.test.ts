import { describe, expect, it } from "vitest";

import {
  BRAND_CATEGORIES,
  BRAND_CATEGORY_OTHER,
  brandCategoryForDomain,
} from "~/lib/brand-categories";
import snapshot from "./fixtures/indexable-ads-domains.snapshot.json";

/**
 * Issue #3126 — the category registry must cover the published surface.
 * Every live, indexable /ads/:domain in the production sitemap resolves to a
 * real buyer category; "More brands" is reserved for domains no buyer
 * category genuinely fits, so only an explicit allow-list entry may land
 * there. The fixture pins the sitemap reference (114 domains on 2026-09-12)
 * so a newly published domain that falls into the fallback bucket fails here
 * instead of silently shipping a near-empty category spine.
 */
describe("brandCategoryForDomain — sitemap coverage (issue #3126)", () => {
  it("fixture pins a meaningful slice of the registry", () => {
    expect(snapshot.domains.length).toBeGreaterThan(90);
    expect(new Set(snapshot.domains).size).toBe(snapshot.domains.length);
  });

  it("every sitemap domain resolves to a curated category unless allow-listed", () => {
    // Allow-list: domains with no buyer category that genuinely fits.
    // Empty today — a new domain that fits nothing must be added here
    // explicitly, not silently absorbed into the fallback bucket.
    const FALLBACK_ALLOWLIST: readonly string[] = [];

    const pitfall = snapshot.domains.filter((domain) => {
      const category = brandCategoryForDomain(domain);
      return category === BRAND_CATEGORY_OTHER && !FALLBACK_ALLOWLIST.includes(domain);
    });
    expect(pitfall).toEqual([]);
  });

  it("saas-software resolves at least 10 SaaS brands", () => {
    const saas = snapshot.domains.filter(
      (d) => brandCategoryForDomain(d) === "SaaS & software",
    );
    expect(saas.length).toBeGreaterThanOrEqual(10);
  });

  it("categorized domains never resolve outside the registry's values", () => {
    const registryValues = new Set(Object.values(BRAND_CATEGORIES));
    for (const domain of snapshot.domains) {
      const category = brandCategoryForDomain(domain);
      expect(registryValues.has(category)).toBe(true);
    }
  });
});
