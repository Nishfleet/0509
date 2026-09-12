import { describe, expect, it } from "vitest";

import {
  BRAND_CATEGORIES,
  BRAND_CATEGORY_OTHER,
  CURATED_BRAND_CATEGORY_SLUGS,
  brandCategoryFromSlug,
  brandCategorySlug,
} from "~/lib/brand-categories";

/** The 9 verify slugs — issues #2067 (shape) and #3126 (registry growth). */
const VERIFY_SLUGS = [
  "sport-footwear",
  "e-commerce",
  "beauty-personal-care",
  "saas-software",
  "fashion-accessories",
  "food-beverage",
  "consumer-electronics",
  "finance-insurance",
  "home-living",
] as const;

const CURATED_LABELS = [
  ...new Set(
    Object.values(BRAND_CATEGORIES).filter(
      (category) => category !== BRAND_CATEGORY_OTHER,
    ),
  ),
];

describe("brandCategorySlug — issue #2067 verify slugs", () => {
  const EXPECTED: Readonly<Record<string, string>> = {
    "Sport & footwear": "sport-footwear",
    "E-commerce": "e-commerce",
    "Beauty & personal care": "beauty-personal-care",
    "SaaS & software": "saas-software",
    "Fashion & accessories": "fashion-accessories",
    "Food & beverage": "food-beverage",
    "Consumer electronics": "consumer-electronics",
    "Finance & insurance": "finance-insurance",
    "Home & living": "home-living",
  };

  it.each(Object.entries(EXPECTED))(
    'derives "%s" -> "%s" (no stray double separator)',
    (label, expected) => {
      expect(brandCategorySlug(label)).toBe(expected);
    },
  );

  it("handles the & run together with spaces so there is no gap", () => {
    // The `&` is consumed in the same non-[a-z0-9] run as its surrounding
    // spaces, never creating a double separator.
    expect(brandCategorySlug("Sport & footwear")).toBe("sport-footwear");
  });
});

describe("brandCategoryFromSlug round-trips", () => {
  it.each(VERIFY_SLUGS)("resolves the curated label back from %s", (slug) => {
    expect(brandCategoryFromSlug(slug)).toBeTruthy();
    expect(brandCategorySlug(brandCategoryFromSlug(slug) as string)).toBe(slug);
  });

  it("round-trips every curated label in the registry", () => {
    for (const label of CURATED_LABELS) {
      const slug = brandCategorySlug(label);
      expect(brandCategoryFromSlug(slug)).toBe(label);
    }
  });
});

describe("CURATED_BRAND_CATEGORY_SLUGS", () => {
  it("equals exactly the 9 verify slugs in order", () => {
    expect([...CURATED_BRAND_CATEGORY_SLUGS]).toEqual([...VERIFY_SLUGS]);
  });

  it("excludes the More brands fallback bucket", () => {
    expect(CURATED_BRAND_CATEGORY_SLUGS).not.toContain(
      brandCategorySlug(BRAND_CATEGORY_OTHER),
    );
    expect(CURATED_BRAND_CATEGORY_SLUGS).not.toContain("more-brands");
  });
});

describe("unknown and placeholder slugs resolve to null", () => {
  it("returns null for the More brands placeholder (has no page)", () => {
    expect(brandCategorySlug(BRAND_CATEGORY_OTHER)).toBe("more-brands");
    expect(brandCategoryFromSlug("more-brands")).toBeNull();
    expect(brandCategoryFromSlug("More brands")).toBeNull();
  });

  it("returns null for arbitrary / invented slugs", () => {
    expect(brandCategoryFromSlug("something-else")).toBeNull();
    expect(brandCategoryFromSlug("")).toBeNull();
    expect(brandCategoryFromSlug("---")).toBeNull();
  });
});

describe("idempotency", () => {
  it("applying brandCategorySlug twice is a no-op", () => {
    for (const slug of VERIFY_SLUGS) {
      expect(brandCategorySlug(brandCategorySlug(slug))).toBe(slug);
    }
    for (const label of CURATED_LABELS) {
      const once = brandCategorySlug(label);
      expect(brandCategorySlug(once)).toBe(once);
    }
  });
});
