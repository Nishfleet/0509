import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SitemapEntry } from "~/lib/seo";

// Fixtures backing the loader's dynamic imports. `loadIndexableBrandPageEntries`
// returns the sitemap's indexable /ads/:domain set; the loader derives the
// category's links from it (mirroring the hub) and enriches each brand's Ad
// Aggression Score from the cache snapshot.
let brandEntries: SitemapEntry[];
const loadBrandPageCacheSnapshot = vi.fn();
const computeBrandPageAggressionScore = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  brandEntries = [
    { path: "/ads/nykaa.com", lastmod: "2026-08-21", adCount: 12 },
    { path: "/ads/sugarcosmetics.com", lastmod: "2026-08-20", adCount: 8 },
    { path: "/ads/nike.com", lastmod: "2026-08-19", adCount: 5 },
    // An unclassified domain — falls into the "More brands" bucket, never a
    // curated category, so it must not appear on any category page.
    { path: "/ads/myexamplebrand.com", lastmod: "2026-08-18", adCount: 3 },
  ];
  loadBrandPageCacheSnapshot.mockResolvedValue({ ads: [{ id: "ad-1" }] });
  computeBrandPageAggressionScore.mockReturnValue({ score: 42 });

  vi.doMock("~/lib/context.server", () => ({ getEnv: () => ({ DB: {} }) }));
  vi.doMock("~/lib/sitemap.server", () => ({
    loadIndexableBrandPageEntries: () => Promise.resolve(brandEntries),
  }));
  vi.doMock("~/lib/brand-page.server", () => ({
    loadBrandPageCacheSnapshot,
    computeBrandPageAggressionScore,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadCategory(slug: string) {
  const { loader } = await import("~/routes/brands.$category");
  return loader({
    context: {},
    params: { category: slug },
  } as never);
}

/** Assert the loader rejects with a 404 Response. */
async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status: 404 });
}

describe("/brands/:category loader (issue #2067)", () => {
  it("404s an unknown slug that is not a curated category", async () => {
    await expectNotFound(loadCategory("not-a-category"));
  });

  it("404s the 'More brands' fallback bucket — it has no landing page", async () => {
    // "more-brands" is the slug of BRAND_CATEGORY_OTHER, which is excluded
    // from CURATED_BRAND_CATEGORY_SLUGS, so it must resolve to null and 404.
    await expectNotFound(loadCategory("more-brands"));
  });

  it("404s an empty curated category rather than shipping an empty landing page (mirror #1988)", async () => {
    // "e-commerce" is curated but no brand entry in the fixture is an
    // e-commerce domain, so the category is empty and must 404.
    await expectNotFound(loadCategory("e-commerce"));
  });

  it("lists exactly the brands in a curated category with ad count + score, and derives lastMod from the newest brand", async () => {
    const data = await loadCategory("beauty-personal-care");

    expect(data.label).toBe("Beauty & personal care");
    expect(data.slug).toBe("beauty-personal-care");
    // nykaa.com + sugarcosmetics.com are Beauty & personal care; nike.com
    // (Sport & footwear) and myexamplebrand.com (unclassified) are excluded.
    expect(data.brands.map((b) => b.domain).sort()).toEqual([
      "nykaa.com",
      "sugarcosmetics.com",
    ]);
    expect(data.brands.find((b) => b.domain === "nykaa.com")).toMatchObject({
      path: "/ads/nykaa.com",
      name: "Nykaa",
      adCount: 12,
      score: 42,
    });
    expect(data.brands.find((b) => b.domain === "sugarcosmetics.com")).toMatchObject({
      adCount: 8,
      score: 42,
    });
    // lastMod = newest brand lastmod across the category (nykaa 2026-08-21).
    expect(data.lastMod).toBe("2026-08-21");
  });

  it("404s when the brand source throws — never a 500 or an unhandled throw (issue #2600)", async () => {
    // A D1 / sitemap hiccup makes loadIndexableBrandPageEntries reject; the
    // loader must degrade to an empty entry list so the empty-curated-
    // category guard 404s. The rejection must be a 404 Response — not a 500
    // and not a raw error escaping to the caller — and no brand list data is
    // ever produced (no fabricated or partial page).
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: () =>
        Promise.reject(new Error("D1 hiccup")),
    }));

    const { loader } = await import("~/routes/brands.$category");
    const rejection = await loader({
      context: {},
      params: { category: "beauty-personal-care" },
    } as never).then(
      () => {
        throw new Error("loader resolved — expected a 404 Response");
      },
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(Response);
    expect((rejection as Response).status).toBe(404);
    expect((rejection as Response).status).not.toBe(500);
  });

  it("degrades a failed score read to an honest deferred null, never a 500", async () => {
    computeBrandPageAggressionScore.mockReturnValue(null);
    loadBrandPageCacheSnapshot.mockResolvedValue(null);

    const data = await loadCategory("beauty-personal-care");
    for (const brand of data.brands) {
      expect(brand.score).toBeNull();
    }
  });

  it("bounded score enrichment: reads a snapshot per category brand, never more", async () => {
    // A curated category's brand set is bounded (<= ~5 brands); the loader
    // reads one cache-only snapshot per brand and caps at
    // BRAND_CATEGORY_MAX_SCORE_LOOKUPS. The beauty category holds the full
    // 5 curated beauty domains, so all 5 get a score lookup — no unbounded
    // per-brand D1 read.
    brandEntries = [
      { path: "/ads/nykaa.com", lastmod: "2026-08-21" },
      { path: "/ads/sugarcosmetics.com", lastmod: "2026-08-20" },
      { path: "/ads/mcaffeine.com", lastmod: "2026-08-19" },
      { path: "/ads/bombayshavingcompany.com", lastmod: "2026-08-18" },
      { path: "/ads/mamaearth.com", lastmod: "2026-08-17" },
    ];

    const data = await loadCategory("beauty-personal-care");
    expect(data.brands).toHaveLength(5);
    expect(loadBrandPageCacheSnapshot).toHaveBeenCalledTimes(5);
  });
});