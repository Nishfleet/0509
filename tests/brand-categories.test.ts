import { describe, expect, it } from "vitest";

import {
  BRAND_CATEGORIES,
  BRAND_CATEGORY_OTHER,
  brandCategoryForDomain,
  categoryLabelForSlug,
  categorySlugForLabel,
  curatedCategorySlugs,
} from "~/lib/brand-categories";

/** The exact slugs issue #2067 pins for the 7 curated categories. */
const EXACT_CURATED_SLUGS = [
  "e-commerce",
  "beauty-personal-care",
  "optical-eyewear",
  "saas-software",
  "sport-footwear",
  "wearables-health",
  "wallet-accessories",
] as const;

const REGISTRY_LABELS = [...new Set(Object.values(BRAND_CATEGORIES))];

describe("brand category slugs (issue #2067)", () => {
  it("derives exactly 7 curated categories from the registry, not a parallel list", () => {
    expect(REGISTRY_LABELS).toHaveLength(7);
    expect(curatedCategorySlugs()).toHaveLength(7);
    // The curated set must equal the distinct registry values — derived, so a
    // registry edit stays single-source.
    expect(REGISTRY_LABELS.sort((a, b) => a.localeCompare(b))).toEqual(
      curatedCategorySlugs().map((slug) => categoryLabelForSlug(slug)),
    );
  });

  it("round-trips every curated registry value slug -> label -> slug", () => {
    for (const label of REGISTRY_LABELS) {
      const slug = categorySlugForLabel(label);
      expect(slug).toBeTruthy();
      // Deterministic: the same label always yields the same slug.
      expect(categorySlugForLabel(label)).toBe(slug);
      expect(categoryLabelForSlug(slug)).toBe(label);
    }
  });

  it("produces the exact pinned slugs for the 7 curated categories", () => {
    expect([...curatedCategorySlugs()].sort()).toEqual(
      [...EXACT_CURATED_SLUGS].sort(),
    );
    expect(categoryLabelForSlug("e-commerce")).toBe("E-commerce");
    expect(categoryLabelForSlug("beauty-personal-care")).toBe(
      "Beauty & personal care",
    );
    expect(categoryLabelForSlug("optical-eyewear")).toBe("Optical & eyewear");
    expect(categoryLabelForSlug("saas-software")).toBe("SaaS & software");
    expect(categoryLabelForSlug("sport-footwear")).toBe("Sport & footwear");
    expect(categoryLabelForSlug("wearables-health")).toBe("Wearables & health");
    expect(categoryLabelForSlug("wallet-accessories")).toBe(
      "Wallet & accessories",
    );
  });

  it("excludes the More brands bucket — no slug, no page, by construction", () => {
    // "More brands" is the hub-only fallback bucket, never a BRAND_CATEGORIES
    // value, so it can never enter the curated slug set.
    expect(Object.values(BRAND_CATEGORIES)).not.toContain(BRAND_CATEGORY_OTHER);
    expect(categoryLabelForSlug("more-brands")).toBeNull();
    expect(curatedCategorySlugs()).not.toContain("more-brands");
    // The bucket still groups unknown domains on the hub itself.
    expect(brandCategoryForDomain("unknown-shop.example")).toBe(
      BRAND_CATEGORY_OTHER,
    );
  });

  it("returns null for unknown slugs — a bad /brands/:category URL can 404", () => {
    expect(categoryLabelForSlug("nonexistent")).toBeNull();
    expect(categoryLabelForSlug("")).toBeNull();
    // Labels are not slugs: the lookup is one-way per direction.
    expect(categoryLabelForSlug("E-commerce")).toBeNull();
  });
});
