import { describe, expect, it } from "vitest";

import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import { deriveBrandPageLookupForCountry } from "~/lib/brand-page.server";

import { appEnv } from "./fixtures";

/**
 * Issue #1282 — "no page ships empty".
 *
 * The /ads/:domain loader 301-redirects to /search?q=<domain> when there is
 * no usable cache snapshot, instead of rendering a noindex "We haven't
 * watched {domain} yet" empty shell. This integration test exercises the
 * loader against real D1 (migrations applied) to verify the regression
 * vector: the loader's interaction with the cache snapshot.
 *
 * The mock-binding unit suite (tests/ads-brand-page.route.test.ts) covers the
 * same redirect at the unit level; this suite proves it against the real D1
 * data layer — the sitemap already excluded empty shells, and the route must
 * not serve them either.
 */

/** Env with BROWSERLESS_TOKEN so resolveCommercialDiscoveryProvider returns meta_library_browser. */
const browserEnv = { ...appEnv, BROWSERLESS_TOKEN: "test-token" };

// Unique-per-call domain (underscores are invalid in DNS — use hyphens).
let domainSeq = 0;
function testDomain(prefix: string) {
  domainSeq += 1;
  return `${prefix}-${domainSeq.toString().padStart(4, "0")}.com`;
}

function loaderContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

async function callLoader(domain: string, env: Record<string, unknown>) {
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

describe("/ads/:domain empty-shell redirect against real D1 (issue #1282)", () => {
  it("301-redirects to /search?q=<domain> when no cache entry exists", async () => {
    const domain = testDomain("empty");

    const result = await callLoader(domain, browserEnv);

    expect(result.kind).toBe("response");
    if (result.kind !== "response") throw new Error("expected redirect");
    expect(result.response.status).toBe(301);
    expect(result.response.headers.get("Location")).toBe(
      `/search?q=${encodeURIComponent(domain)}`,
    );
  });

  it("returns populated data (not a redirect) when a fresh cache entry exists", async () => {
    const domain = testDomain("populated");
    const provider = "meta_library_browser";
    // Legacy mode (no SEARCH_ROLLOUT_MODE) → useDomainV2=false.
    const lookup = deriveBrandPageLookupForCountry(provider, domain, "all", false);

    const now = new Date();
    await upsertDiscoveryCacheEntry(browserEnv as never, {
      cacheKey: lookup.cacheKey,
      provider,
      routeContext: "public_search",
      queryFingerprint: lookup.fingerprint,
      country: lookup.country,
      cursor: null,
      payload: {
        ads: [
          {
            metaAdId: `ad-${domain}-1`,
            advertiser: "Test Brand",
            body: "Test ad body",
            previewHeadline: "Test headline",
            previewSubhead: "",
            hook: "Shop Now",
            offer: "20% off",
            cta: "Shop Now",
            format: "image",
            languageLabel: "English",
            destinationType: "website",
            landingPageUrl: `https://${domain}/shop`,
            adSnapshotUrl: null,
            countries: ["all"],
            platforms: ["Instagram"],
            // 30-day first-seen: clears the 14-day aggression-score floor.
            firstSeenAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            lastSeenAt: null,
            active: true,
            researchSummary: "",
            source: "meta_library_browser",
            analysisFields: [],
          },
        ],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "hit",
      },
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      browserMsUsed: 1200,
    });

    const result = await callLoader(domain, browserEnv);

    expect(result.kind).toBe("data");
    if (result.kind !== "data") throw new Error("expected data");
    expect(result.data.hasCachedAds).toBe(true);
    expect(result.data.ads.length).toBeGreaterThanOrEqual(1);
    // A populated page must never serve a noindex empty shell — it either
    // carries noindex for a real reason (stale, emergency brake, no score) or
    // is indexable. Either way, it is NOT the empty-shell noindex.
    expect(result.data.domain).toBe(domain);
  });

  it("never returns a 200 noindex empty shell for any empty-cache domain", async () => {
    // Sweep several domains that have no cache entry — each must redirect,
    // never return data with hasCachedAds=false.
    const domains = [
      testDomain("sweep"),
      testDomain("sweep"),
      testDomain("sweep"),
    ];

    for (const domain of domains) {
      const result = await callLoader(domain, browserEnv);

      // The response must be either populated-with-data OR a 301 redirect —
      // never a 200 noindex empty shell (hasCachedAds=false data).
      if (result.kind === "data") {
        expect(result.data.hasCachedAds, `${domain} must not be an empty shell`).toBe(true);
      } else {
        expect(result.response.status, `${domain} must redirect`).toBe(301);
        expect(result.response.headers.get("Location")).toBe(
          `/search?q=${encodeURIComponent(domain)}`,
        );
      }
    }
  });
});
