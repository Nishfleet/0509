import { describe, expect, it } from "vitest";

import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import { deriveBrandPageLookupForCountry } from "~/lib/brand-page.server";
import { publicSitemapFile } from "~/lib/sitemap.server";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { AdRecord } from "~/lib/types";

import { appEnv } from "./fixtures";

/**
 * Issue #1730 — /ads/notion.com and /ads/notion.so are duplicate indexable
 * pages. Notion's real domain is notion.so; notion.com is the natural alias a
 * buyer types. Both served the same two verified Notion ads as two
 * self-canonical, indexable URLs, splitting the brand's verified ads and link
 * equity. The fix extends the #1446 alias canonicalization table with
 * notion.com → notion.so; the rest (redirect when the canonical is populated,
 * sitemap exclusion of the alias) is inherited from the generic mechanism.
 *
 * This is an integration test against real D1 (migrations applied). It asserts
 * the two end-state properties from the issue's acceptance:
 *   1. the alias 301-redirects to the populated canonical;
 *   2. the canonical is the only one of the pair listed in the sitemap.
 */

const v2Env = {
  ...appEnv,
  BROWSERLESS_TOKEN: "test-token",
  SEARCH_ROLLOUT_MODE: "v2" as const,
};

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: `ad-${overrides.metaAdId ?? "1"}`,
    advertiser: "Notion",
    body: "Test body",
    previewHeadline: "Test headline",
    previewSubhead: "",
    hook: "Shop now",
    offer: "",
    cta: "Shop",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.notion.so/product",
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
    // Only a redirect/response is expected from this loader. Rethrow anything
    // else so a real fault surfaces with its true error, not an opaque
    // undefined-status failure.
    if (error instanceof Response) {
      return { kind: "response" as const, response: error };
    }
    throw error;
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

/** A verified Notion ad whose landing host is notion.so (the canonical). */
function canonicalNotionAds(): AdRecord[] {
  return [
    ad({
      metaAdId: "notion-own",
      advertiser: "Notion",
      landingPageUrl: "https://www.notion.so/product",
      domainMatch: {
        level: "registrable_domain",
        reason: "Landing page matches notion.so",
        matchedDomain: "notion.so",
      },
    }),
  ];
}

describe("/ads/:domain alias canonicalization for notion (issue #1730)", () => {
  it("301-redirects the notion.com alias to the populated notion.so canonical", async () => {
    // Seed ONLY the canonical (notion.so) as populated. The alias must 301
    // onto it — it must never render its own competing page.
    await seedBrandCache("notion.so", canonicalNotionAds());

    const result = await callLoader("notion.com", v2Env);

    expect(result.kind).toBe("response");
    if (result.kind !== "response") throw new Error("expected a redirect");
    expect(result.response.status).toBe(301);
    expect(result.response.headers.get("Location")).toBe("/ads/notion.so");
  });

  it("lists only the canonical in the sitemap, never the alias", async () => {
    // Reproduce the genuine duplicate-indexable state from the issue: BOTH
    // notion.com and notion.so are populated and otherwise indexable. The
    // alias row is the one the sitemap must drop (isBrandPageAliasDomain), so
    // seeding it is what actually guards the #1446 criterion-3 regression.
    await seedBrandCache("notion.so", canonicalNotionAds());
    await seedBrandCache("notion.com", canonicalNotionAds());

    const file = await publicSitemapFile(v2Env as never);

    expect(file.body).toContain("/ads/notion.so");
    expect(file.body).not.toContain("/ads/notion.com");
  });
});
