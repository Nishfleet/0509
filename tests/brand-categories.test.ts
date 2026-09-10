import { describe, expect, it } from "vitest";

import {
  BRAND_CATEGORIES,
  BRAND_CATEGORY_OTHER,
  CURATED_CATEGORY_LABELS,
  CURATED_CATEGORY_SLUGS,
  brandCategoryForDomain,
  categoryLabelForSlug,
  categorySlugForLabel,
  groupBrandRecordsByCategory,
} from "~/lib/brand-categories";
import {
  indexableBrandCategoryEntriesFromBrandEntries,
  buildSitemapXml,
} from "~/lib/sitemap.server";
import type { SitemapEntry } from "~/lib/seo";

describe("brand category slug helpers (issue #2067)", () => {
  it("CURATED_CATEGORY_LABELS lists the 7 curated categories, excluding More brands", () => {
    expect(CURATED_CATEGORY_LABELS).not.toContain(BRAND_CATEGORY_OTHER);
    expect(CURATED_CATEGORY_LABELS.length).toBe(7);
  });

  it("CURATED_CATEGORY_SLUGS matches the issue #2067 verify block exactly", () => {
    expect(CURATED_CATEGORY_SLUGS).toEqual([
      "beauty-personal-care",
      "e-commerce",
      "optical-eyewear",
      "saas-software",
      "sport-footwear",
      "wallet-accessories",
      "wearables-health",
    ]);
  });

  it("categorySlugForLabel slugifies each curated category to the route URL segment", () => {
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
      expect(categorySlugForLabel(category)).toBe(slug);
    }
  });

  it("categorySlugForLabel returns null for the More brands bucket and unknowns", () => {
    expect(categorySlugForLabel(BRAND_CATEGORY_OTHER)).toBeNull();
    expect(categorySlugForLabel("Unknown")).toBeNull();
    expect(categorySlugForLabel("")).toBeNull();
  });

  it("categoryLabelForSlug round-trips every curated category and rejects unknowns", () => {
    for (const category of CURATED_CATEGORY_LABELS) {
      const slug = categorySlugForLabel(category);
      expect(categoryLabelForSlug(slug!)).toBe(category);
    }
    // Unknown slugs resolve to null (the route 404s on these).
    expect(categoryLabelForSlug("more-brands")).toBeNull();
    expect(categoryLabelForSlug("unknown")).toBeNull();
    expect(categoryLabelForSlug("")).toBeNull();
    expect(categoryLabelForSlug("  ")).toBeNull();
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

describe("groupBrandRecordsByCategory (issue #2067 reuse)", () => {
  it("groups records by curated category and puts More brands last", () => {
    const groups = groupBrandRecordsByCategory([
      { domain: "nike.com" },
      { domain: "unknown.example" },
      { domain: "nykaa.com" },
    ]);
    const categories = groups.map((g) => g.category);
    expect(categories[categories.length - 1]).toBe(BRAND_CATEGORY_OTHER);
    // Curated categories are alphabetical.
    const curated = categories.slice(0, -1);
    expect(curated).toEqual([...curated].sort());
  });
});
