import { describe, expect, it } from "vitest";

import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import { deriveBrandPageLookupForCountry } from "~/lib/brand-page.server";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { AdRecord } from "~/lib/types";

import { appEnv } from "./fixtures";

/**
 * Issue #1566 — brand-owned attribution must be decided by the advertiser's
 * IDENTITY (Meta Page ID) or by the exact normalized domain the ad lands on,
 * never by a substring of the advertiser's name.
 *
 * This integration test runs the real route loader against D1 (migrations
 * applied) with cached Meta Library results for the three collision classes
 * from the issue:
 *   - notion.so — a content-creator partnership campaign ("Juan Dussán with
 *     Notion") and a look-alike publisher ("Notion Press Publishing") must NOT
 *     count as the Notion workspace business.
 *   - oura.com / ouraring.com — the same brand on two domains; only the Oura
 *     Ring business is brand-owned on both pages.
 *   - goat.com vs thegoatco.au — different brands with overlapping name
 *     tokens; only the matched domain's brand is brand-owned.
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

describe("/ads/:domain brand-owned attribution by Meta Page ID (issue #1566)", () => {
  it("notion.so counts only the Notion workspace business, not the 'Juan Dussán with Notion' partner campaign", async () => {
    const domain = "notion.so";
    await seedBrandCache(domain, [
      ad({
        metaAdId: "notion-own",
        advertiser: "Notion",
        advertiserPageId: "100",
        landingPageUrl: "https://www.notion.so/product",
        domainMatch: {
          level: "registrable_domain",
          reason: "Landing page matches notion.so",
          matchedDomain: "notion.so",
        },
      }),
      ad({
        metaAdId: "notion-partner",
        advertiser: "Juan Dussán with Notion",
        advertiserPageId: "200",
        landingPageUrl: "https://www.notion.com/templates/collections/build-your-2026-with-top-notion-templates-for-work",
        domainMatch: {
          level: "verified_alias",
          reason: "Landing page matches a related site for notion.so",
          matchedDomain: "notion.com",
        },
      }),
      ad({
        metaAdId: "notion-press",
        advertiser: "Notion Press Publishing",
        advertiserPageId: "300",
        landingPageUrl: "https://notionpress.com/books",
        domainMatch: {
          level: "verified_alias",
          reason: "Landing page matches a related site for notion.so",
          matchedDomain: "notionpress.com",
        },
      }),
    ]);

    const result = await callLoader(domain, v2Env);
    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data");
    expect(result.data.verifiedLinkCount).toBe(3);
    // Only the actual Notion workspace business is brand-owned. The partner
    // campaign and the look-alike publisher run under different Meta Page IDs.
    expect(result.data.brandOwnedAdCount).toBe(1);
    expect(result.data.partnerCampaignAdIds).toContain("notion-partner");
    expect(result.data.partnerCampaignAdIds).toContain("notion-press");
  });

  it("oura.com and ouraring.com both count only the Oura Ring business as brand-owned", async () => {
    const ouraBusiness = ad({
      metaAdId: "oura-own",
      advertiser: "Oura",
      advertiserPageId: "500",
      landingPageUrl: "https://ouraring.com/",
      domainMatch: {
        level: "verified_entity",
        reason: "Advertiser is linked to oura.com",
        matchedDomain: "oura.com",
      },
    });
    const ouraAffiliate = ad({
      metaAdId: "oura-affiliate",
      advertiser: "Oura Ring Reviews",
      advertiserPageId: "600",
      landingPageUrl: "https://ouraring.com/reviews",
      domainMatch: {
        level: "verified_alias",
        reason: "Landing page matches a related site for oura.com",
        matchedDomain: "ouraring.com",
      },
    });

    await seedBrandCache("oura.com", [ouraBusiness, ouraAffiliate]);
    const oura = await callLoader("oura.com", v2Env);
    expect(oura.kind).toBe("data");
    if (oura.kind !== "data") throw new Error("expected data");
    expect(oura.data.verifiedLinkCount).toBe(2);
    expect(oura.data.brandOwnedAdCount).toBe(1);
    expect(oura.data.partnerCampaignAdIds).toContain("oura-affiliate");

    await seedBrandCache("ouraring.com", [ouraBusiness, ouraAffiliate]);
    const ouraring = await callLoader("ouraring.com", v2Env);
    expect(ouraring.kind).toBe("data");
    if (ouraring.kind !== "data") throw new Error("expected data");
    expect(ouraring.data.verifiedLinkCount).toBe(2);
    expect(ouraring.data.brandOwnedAdCount).toBe(1);
    expect(ouraring.data.partnerCampaignAdIds).toContain("oura-affiliate");
  });

  it("goat.com and thegoatco.au each count only their own brand, despite overlapping name tokens", async () => {
    const goat = ad({
      metaAdId: "goat-own",
      advertiser: "GOAT",
      advertiserPageId: "700",
      landingPageUrl: "https://www.goat.com/",
      domainMatch: {
        level: "exact_hostname",
        reason: "Landing page matches goat.com",
        matchedDomain: "goat.com",
      },
    });
    const theGoatCo = ad({
      metaAdId: "thegoatco-own",
      advertiser: "The Goat Co",
      advertiserPageId: "800",
      landingPageUrl: "https://thegoatco.au/",
      domainMatch: {
        level: "exact_hostname",
        reason: "Landing page matches thegoatco.au",
        matchedDomain: "thegoatco.au",
      },
    });

    await seedBrandCache("goat.com", [goat, theGoatCo]);
    const goatPage = await callLoader("goat.com", v2Env);
    expect(goatPage.kind).toBe("data");
    if (goatPage.kind !== "data") throw new Error("expected data");
    expect(goatPage.data.verifiedLinkCount).toBe(2);
    // Only GOAT is brand-owned on goat.com; The Goat Co is a different brand.
    expect(goatPage.data.brandOwnedAdCount).toBe(1);
    expect(goatPage.data.partnerCampaignAdIds).toContain("thegoatco-own");

    await seedBrandCache("thegoatco.au", [goat, theGoatCo]);
    const theGoatCoPage = await callLoader("thegoatco.au", v2Env);
    expect(theGoatCoPage.kind).toBe("data");
    if (theGoatCoPage.kind !== "data") throw new Error("expected data");
    expect(theGoatCoPage.data.verifiedLinkCount).toBe(2);
    // Only The Goat Co is brand-owned on thegoatco.au; GOAT is a different brand.
    expect(theGoatCoPage.data.brandOwnedAdCount).toBe(1);
    expect(theGoatCoPage.data.partnerCampaignAdIds).toContain("goat-own");
  });
});
