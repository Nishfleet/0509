import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRAND_CATEGORIES,
  BRAND_CATEGORY_OTHER,
  CURATED_BRAND_CATEGORIES,
  brandCategoryForDomain,
  brandCategoryFromSlug,
  brandCategorySlug,
  groupBrandRecordsByCategory,
} from "~/lib/brand-categories";
import {
  indexableBrandCategoryEntriesFromBrandEntries,
  buildSitemapXml,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";
import type { SitemapEntry } from "~/lib/seo";

describe("brand category slug helpers (issue #2067)", () => {
  it("CURATED_BRAND_CATEGORIES lists the 7 curated categories, excluding More brands", () => {
    expect(CURATED_BRAND_CATEGORIES).not.toContain(BRAND_CATEGORY_OTHER);
    // The registry's distinct values are exactly the curated set + nothing
    // else (every domain maps to a curated category; none maps to "More
    // brands" because BRAND_CATEGORIES has no entry that resolves to it).
    const distinct = Array.from(new Set(Object.values(BRAND_CATEGORIES))).sort();
    expect(CURATED_BRAND_CATEGORIES.slice().sort()).toEqual(distinct);
    expect(CURATED_BRAND_CATEGORIES.length).toBeGreaterThanOrEqual(7);
  });

  it("brandCategorySlug slugifies each curated category to the route URL segment", () => {
    const expected: Record<string, string> = {
      "Sport & footwear": "sport-footwear",
      "E-commerce": "e-commerce",
      "Beauty & personal care": "beauty-personal-care",
      "Optical & eyewear": "optical-eyewear",
      "SaaS & software": "saas-software",
      "Wearables & health": "wearables-health",
      "Wallet & accessories": "wallet-accessories",
    };
    for (const [category, slug] of Object.entries(expected)) {
      expect(brandCategorySlug(category)).toBe(slug);
    }
  });

  it("brandCategoryFromSlug round-trips every curated category and rejects unknowns", () => {
    for (const category of CURATED_BRAND_CATEGORIES) {
      const slug = brandCategorySlug(category);
      expect(brandCategoryFromSlug(slug)).toBe(category);
    }
    // Unknown slugs resolve to null (the route 404s on these).
    expect(brandCategoryFromSlug("more-brands")).toBeNull();
    expect(brandCategoryFromSlug("unknown")).toBeNull();
    expect(brandCategoryFromSlug("")).toBeNull();
    expect(brandCategoryFromSlug("  ")).toBeNull();
  });

  it("brandCategoryForDomain classifies a known domain and falls back to More brands", () => {
    expect(brandCategoryForDomain("nike.com")).toBe("Sport & footwear");
    expect(brandCategoryForDomain("WWW.NIKE.COM")).toBe("Sport & footwear");
    expect(brandCategoryForDomain("unknown-brand.example")).toBe(BRAND_CATEGORY_OTHER);
  });
});

describe("indexableBrandCategoryEntriesFromBrandEntries (issue #2067)", () => {
  function brandEntry(domain: string, lastmod: string): SitemapEntry {
    return { path: `/ads/${domain}`, lastmod, changefreq: "weekly", priority: "0.6" };
  }

  it("emits one /brands/:slug entry per curated category that has >=1 brand", () => {
    const entries = [
      brandEntry("nike.com", "2026-09-08"),
      brandEntry("adidas.com", "2026-09-07"),
      brandEntry("nykaa.com", "2026-09-09"),
      brandEntry("hubspot.com", "2026-09-06"),
    ];
    const categoryEntries = indexableBrandCategoryEntriesFromBrandEntries(entries);
    const paths = categoryEntries.map((e) => e.path).sort();
    expect(paths).toEqual(
      ["/brands/beauty-personal-care", "/brands/saas-software", "/brands/sport-footwear"].sort(),
    );
    for (const entry of categoryEntries) {
      expect(entry.changefreq).toBe("weekly");
      expect(entry.priority).toBe("0.6");
    }
  });

  it("takes the newest lastmod across the category's brands", () => {
    const entries = [
      brandEntry("nike.com", "2026-09-07"),
      brandEntry("adidas.com", "2026-09-09"),
      brandEntry("allbirds.com", "2026-09-08"),
    ];
    const categoryEntries = indexableBrandCategoryEntriesFromBrandEntries(entries);
    const sport = categoryEntries.find((e) => e.path === "/brands/sport-footwear");
    expect(sport?.lastmod).toBe("2026-09-09");
  });

  it("omits the More brands bucket (unclassified domains never get a category page)", () => {
    const entries = [brandEntry("unknown-brand.example", "2026-09-08")];
    expect(indexableBrandCategoryEntriesFromBrandEntries(entries)).toEqual([]);
  });

  it("omits a curated category with zero indexable brands (mirrors the route 404 guard)", () => {
    // Only Sport & footwear brands; Optical & eyewear has none here.
    const entries = [brandEntry("nike.com", "2026-09-08")];
    const paths = indexableBrandCategoryEntriesFromBrandEntries(entries).map((e) => e.path);
    expect(paths).toContain("/brands/sport-footwear");
    expect(paths).not.toContain("/brands/optical-eyewear");
  });

  it("emits entries in deterministic alphabetical slug order", () => {
    const entries = [
      brandEntry("hubspot.com", "2026-09-06"), // saas-software
      brandEntry("nike.com", "2026-09-08"), // sport-footwear
      brandEntry("nykaa.com", "2026-09-09"), // beauty-personal-care
    ];
    const slugs = indexableBrandCategoryEntriesFromBrandEntries(entries).map((e) => e.path);
    expect(slugs).toEqual([
      "/brands/beauty-personal-care",
      "/brands/saas-software",
      "/brands/sport-footwear",
    ]);
  });

  it("buildSitemapXml includes the category entries between static and brand entries", () => {
    const brand = brandEntry("nike.com", "2026-09-08");
    const categoryEntries = indexableBrandCategoryEntriesFromBrandEntries([brand]);
    const xml = buildSitemapXml([brand], [], categoryEntries);
    expect(xml).toContain("<loc>https://0509.io/brands/sport-footwear</loc>");
    expect(xml).toContain("<loc>https://0509.io/ads/nike.com</loc>");
    expect(xml).toContain("<loc>https://0509.io/brands</loc>");
  });
});
