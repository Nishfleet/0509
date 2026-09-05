import { describe, expect, it } from "vitest";

import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import { deriveBrandPageLookupForCountry } from "~/lib/brand-page.server";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { AdRecord } from "~/lib/types";

import { appEnv } from "./fixtures";

/**
 * Issue #1428 — public /ads/:domain must attribute a brand's own ads instead of
 * framing them as "from other advertisers".
 *
 * This integration test runs the real route loader against D1 (migrations
 * applied) with cached Meta Library results for the four example brands. It
 * proves the attribution logic end-to-end: folded advertiser-name stems,
 * regional-domain landings, and co-branded/reseller exclusions.
 */

const v2Env = {
  ...appEnv,
  BROWSERLESS_TOKEN: "test-token",
  SEARCH_ROLLOUT_MODE: "v2" as const,
};

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: `ad-${overrides.metaAdId ?? "1"}`,
    advertiser: "Brand",
    body: "Test body",
    previewHeadline: "Test headline",
    previewSubhead: "",
    hook: "Shop now",
    offer: "",
    cta: "Shop",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.example.com/",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function loaderContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

async function callLoader(
  domain: string,
  env: Record<string, unknown>,
): Promise<{ kind: "data"; data: BrandPageLoaderData } | { kind: "response"; response: Response }> {
  const { loader } = await import("~/routes/ads.$domain");
  try {
    const data = await loader({
      context: loaderContext(env),
      params: { domain },
      request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}`),
    } as never);
    return { kind: "data" as const, data };
  } catch (error) {
    return { kind: "response" as const, response: error as Response };
  }
}

async function seedBrandCache(domain: string, ads: AdRecord[]) {
  const provider = "meta_library_browser";
  const lookup = deriveBrandPageLookupForCountry(provider, domain, "all", true);
  const now = new Date();

  await upsertDiscoveryCacheEntry(v2Env as never, {
    cacheKey: lookup.cacheKey,
    provider,
    routeContext: "public_search",
    queryFingerprint: lookup.fingerprint,
    country: lookup.country,
    cursor: null,
    payload: {
      ads,
      nextCursor: null,
      source: provider,
      provider,
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: "Live ad checks are ready.",
      discoveryFailureClass: null,
    } as never,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    browserMsUsed: 1200,
  });
}

describe("/ads/:domain brand-owned attribution (issue #1428)", () => {
  it("counts Sugar Cosmetics ads as brand-owned via folded advertiser-name stem", async () => {
    const domain = "sugarcosmetics.com";
    await seedBrandCache(domain, [
      ad({
        metaAdId: "sugar-own",
        advertiser: "Sugar Cosmetics",
        landingPageUrl: "https://sugarcosmetics.com/lipstick",
      }),
    ]);

    const result = await callLoader(domain, v2Env);
    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data");
    expect(result.data.hasCachedAds).toBe(true);
    expect(result.data.verifiedLinkCount).toBe(1);
    expect(result.data.brandOwnedAdCount).toBe(1);
    expect(result.data.ads.length).toBeGreaterThanOrEqual(1);
  });

  it("counts Bombay Shaving Company ads as brand-owned via folded advertiser-name stem", async () => {
    const domain = "bombayshavingcompany.com";
    await seedBrandCache(domain, [
      ad({
        metaAdId: "bombay-own",
        advertiser: "Bombay Shaving Company",
        landingPageUrl: "https://bombayshavingcompany.com/razor",
      }),
    ]);

    const result = await callLoader(domain, v2Env);
    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data");
    expect(result.data.verifiedLinkCount).toBe(1);
    expect(result.data.brandOwnedAdCount).toBe(1);
  });

  it("counts H&M's own ads but not co-branded resellers (issue #1428 precision)", async () => {
    const domain = "hm.com";
    await seedBrandCache(domain, [
      ad({
        metaAdId: "hm-own",
        advertiser: "H&M",
        advertiserPageId: "111",
        landingPageUrl: "https://hm.com/shirt",
      }),
      ad({
        metaAdId: "hm-cobranded",
        advertiser: "Vrindasurii with H&M",
        advertiserPageId: "222",
        landingPageUrl: "https://hm.com/sari",
      }),
    ]);

    const result = await callLoader(domain, v2Env);
    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data");
    expect(result.data.verifiedLinkCount).toBe(2);
    // The co-branded reseller lands on hm.com but runs under a DIFFERENT Meta
    // Page ID (222 ≠ the brand's own 111), so it is NOT brand-owned (issue
    // #1566 — ownership is by Meta Page ID, not advertiser-name substring).
    expect(result.data.brandOwnedAdCount).toBe(1);
    expect(result.data.partnerCampaignAdIds).toContain("hm-cobranded");
  });

  it("counts Ridge Wallet regional-domain ads even when the page name does not fold to the stem", async () => {
    const domain = "ridgewallet.com";
    await seedBrandCache(domain, [
      ad({
        metaAdId: "ridge-ca",
        advertiser: "The Ridge",
        landingPageUrl: "https://ridgewallet.ca/products/wallet",
      }),
      ad({
        metaAdId: "ridge-com",
        advertiser: "Ridge Wallet",
        landingPageUrl: "https://ridgewallet.com/wallet",
      }),
    ]);

    const result = await callLoader(domain, v2Env);
    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data");
    expect(result.data.verifiedLinkCount).toBe(2);
    expect(result.data.brandOwnedAdCount).toBe(2);
  });
});
