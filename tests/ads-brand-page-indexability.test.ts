import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";
import { summarizeDomainCaptureFailures } from "~/lib/offer-timeline.server";
import {
  brandPageRowHasVerifiedAds,
  indexableBrandPageEntriesFromRows,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * A verified-linked ad whose first-seen is only 2 days ago — the observed
 * window is below MIN_AGGRESSION_WINDOW_DAYS, so the Ad Aggression Score is
 * deferred (aggression === null) even though the ad carries verified link
 * evidence to the domain. This is the exact issue #1442 shape: a populated
 * page with real ads that the 14-day window used to force invisible to
 * Google.
 */
function verifiedTooRecentAd(): AdRecord {
  return {
    metaAdId: "meta-nykaa-1",
    advertiser: "Nykaa",
    body: "Glow like never before.",
    previewHeadline: "Glow like never before.",
    previewSubhead: "Festive sale",
    hook: "Glow like never before.",
    offer: "Up to 40% off",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://nykaa.com/shop",
    adSnapshotUrl: "https://cdn.example.com/meta-nykaa-1.png",
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(2 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    domainMatch: {
      level: "registrable_domain",
      reason: "Landing page matches nykaa.com",
      matchedDomain: "nykaa.com",
    },
  };
}

/** An unverified text-mention match — no verified link evidence to the domain. */
function unverifiedTextMatchAd(): AdRecord {
  return {
    metaAdId: "meta-text-1",
    advertiser: "BeautyDeals Hub",
    body: "Glow up.",
    previewHeadline: "Glow up.",
    previewSubhead: "Sale",
    hook: "Glow up.",
    offer: "Up to 40% off",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: "https://cdn.example.com/meta-text-1.png",
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(30 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
  };
}

function cacheEntry(payload: unknown) {
  return {
    cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
    provider: "meta_library_browser",
    routeContext: "public_search",
    queryFingerprint: "fnv1a-test",
    country: "all",
    cursor: null,
    payload,
    fetchedAt: isoAgo(2 * 60 * 60 * 1000),
    expiresAt: isoAgo(60 * 60 * 1000),
    browserMsUsed: 1200,
    createdAt: isoAgo(2 * 60 * 60 * 1000),
    updatedAt: isoAgo(2 * 60 * 60 * 1000),
  };
}

function payloadFor(ads: AdRecord[]) {
  return {
    ads,
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
  };
}

function installBrandPageMocks(entry: unknown) {
  const env = { DB: {} };
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry: vi.fn().mockResolvedValue(entry),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
    searchAdsViaSourceResolver: vi.fn(),
    hasFreshDiscoveryCacheEntry: vi.fn(),
  }));
  vi.doMock("~/lib/meta-library-browser.server", () => ({
    searchMetaLibraryByBrowser: vi.fn(),
  }));
  vi.doMock("~/lib/meta-api.server", () => ({ searchAds: vi.fn() }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
    loadDomainCaptureFailures: vi.fn().mockResolvedValue([]),
    summarizeDomainCaptureFailures,
    isOfferTimelineShareEnabled: vi.fn(() => true),
  }));
  return env;
}

async function runLoader(domain: string, env: Record<string, unknown>) {
  const { loader } = await import("~/routes/ads.$domain");
  return loader({
    context: { cloudflare: { env } },
    params: { domain },
    request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}`),
  } as never);
}

function sitemapRow(payload: unknown): SitemapCacheRow {
  return {
    cache_key: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
    provider: "meta_library_browser",
    route_context: "public_search",
    payload_json: JSON.stringify(payload),
    fetched_at: isoAgo(2 * 60 * 60 * 1000),
  };
}

describe("issue #1442 — indexability is decoupled from the 14-day Aggression window", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/meta-library-browser.server");
    vi.doUnmock("~/lib/meta-api.server");
    vi.doUnmock("~/lib/rate-limit.server");
    vi.doUnmock("~/lib/offer-timeline.server");
  });

  it("renders a populated page WITHOUT noindex when every verified ad is under 14 days old", async () => {
    const env = installBrandPageMocks(
      cacheEntry(payloadFor([verifiedTooRecentAd()])),
    );

    const result = await runLoader("nykaa.com", env);

    // The page is populated: real verified-linked ads, so it is NOT thin.
    expect(result.verifiedLinkCount).toBe(1);
    // The score is still deferred below the 14-day floor (issue #1442's
    // trigger) — but that must not cost the page its indexability.
    expect(result.aggression).toBeNull();
    expect(result.observationDays).toBe(2);
    expect(result.noindex).toBe(false);
  });

  it("renders a 0-verified-ads (thin) page noindex — the anti-thin-content guard survives", async () => {
    const env = installBrandPageMocks(
      cacheEntry(payloadFor([unverifiedTextMatchAd()])),
    );

    const result = await runLoader("nykaa.com", env);

    expect(result.verifiedLinkCount).toBe(0);
    expect(result.aggression).toBeNull();
    expect(result.noindex).toBe(true);
  });

  it("includes a populated page in the sitemap even though its score is deferred", () => {
    const row = sitemapRow(payloadFor([verifiedTooRecentAd()]));
    const now = new Date();

    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([
      "/ads/nykaa.com",
    ]);
  });

  it("keeps a 0-verified-ads page out of the sitemap", () => {
    const row = sitemapRow(payloadFor([unverifiedTextMatchAd()]));
    const now = new Date();

    expect(brandPageRowHasVerifiedAds(row, "nykaa.com")).toBe(false);
    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([]);
  });
});
