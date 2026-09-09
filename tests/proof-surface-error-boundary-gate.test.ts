import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";

/**
 * Regression guard for issue #2097: the /ads/:domain and /timeline/:domain
 * loaders must NEVER let a residual throw bubble to the root ErrorBoundary
 * and SSR the generic "Something went wrong" body under HTTP 200. Each route
 * now wraps its core loader in a body-level gate that converts any uncaught
 * error into an honest 503 ("Temporarily unavailable"). Thrown Responses
 * (404, 301 redirect, 410 retire, 429 rate limit) pass through unchanged.
 *
 * These tests inject a throw into an unguarded compute/parse path of each
 * loader and assert the gate degrades to a 503 Response — never a bare
 * exception that would render the error boundary under 200.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

const baseAd: AdRecord = {
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
  landingPageUrl: "https://www.nykaa.com/glow",
  advertiserPageId: "111",
  adSnapshotUrl: "https://cdn.example.com/meta-nykaa-1.png",
  countries: ["all"],
  platforms: ["Instagram"],
  firstSeenAt: isoAgo(30 * DAY_MS),
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

function cacheEntry() {
  return {
    cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
    provider: "meta_library_browser",
    routeContext: "public_search",
    queryFingerprint: "fnv1a-test",
    country: "all",
    cursor: null,
    payload: {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    },
    fetchedAt: isoAgo(2 * 60 * 60 * 1000),
    expiresAt: isoAgo(60 * 60 * 1000),
    browserMsUsed: 1200,
    createdAt: isoAgo(2 * 60 * 60 * 1000),
    updatedAt: isoAgo(2 * 60 * 60 * 1000),
  };
}

function createContext(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

function timelineEntry(): OfferLedgerEntry {
  return {
    id: "s1",
    capturedAt: "2026-08-01T10:00:00.000Z",
    dateLabel: "1 Aug 2026",
    canonicalUrl: "https://nykaa.com/glow",
    headline: "Glow serum",
    ctaText: "Shop now",
    priceText: "₹499",
    formPresent: true,
    screenshotHref: null,
    pageTextHref: null,
    evidenceNote: null,
    transition: null,
    runExtentLabel: null,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/meta-api.server");
  vi.doUnmock("~/lib/meta-library-browser.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/ads/:domain body-level gate (issue #2097)", () => {
  it("degrades a residual compute throw to a 503, never the generic error boundary under 200", async () => {
    const env = { DB: {} };
    const getDiscoveryCacheEntry = vi.fn().mockResolvedValue(cacheEntry());
    // summarizeDomainCaptureFailures is an unguarded pure-compute call in the
    // loader (loadDomainCaptureFailures is internally guarded, but the
    // summary runs outside any try/catch). A throw here would previously
    // bubble to the root ErrorBoundary as a 200 "Something went wrong".
    const summarizeDomainCaptureFailures = vi
      .fn()
      .mockImplementation(() => {
        throw new Error("summarize crashed on malformed capture metadata");
      });

    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({ getDiscoveryCacheEntry }));
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

    const { loader } = await import("~/routes/ads.$domain");

    let thrown: unknown = null;
    try {
      await loader({
        context: createContext(env),
        params: { domain: "nykaa.com" },
        request: new Request("http://localhost/ads/nykaa.com"),
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    // 503 — the honest "Temporarily unavailable" state, NOT a 200 "Something
    // went wrong" error-boundary body.
    expect(response.status).toBe(503);
    expect(summarizeDomainCaptureFailures).toHaveBeenCalled();
  });

  it("still passes thrown Responses (404 for a bad domain) straight through the gate", async () => {
    const env = { DB: {} };
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(null),
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
      summarizeDomainCaptureFailures: vi.fn(() => null),
      isOfferTimelineShareEnabled: vi.fn(() => true),
    }));

    const { loader } = await import("~/routes/ads.$domain");

    let thrown: unknown = null;
    try {
      await loader({
        context: createContext(env),
        params: { domain: "not a domain" },
        request: new Request("http://localhost/ads/not%20a%20domain"),
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });
});

describe("/timeline/:domain body-level gate (issue #2097)", () => {
  it("degrades a residual throw to a 503, never the generic error boundary under 200", async () => {
    const env = { DB: {} };
    // isOfferTimelineShareEnabled is called in the loader's return object
    // literal, outside any try/catch. A throw here would previously bubble to
    // the root ErrorBoundary as a 200 "Something went wrong".
    const isOfferTimelineShareEnabled = vi
      .fn()
      .mockImplementation(() => {
        throw new Error("share-flag read crashed");
      });

    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/offer-timeline.server", async (importOriginal) => {
      const actual = await importOriginal<
        typeof import("~/lib/offer-timeline.server")
      >();
      return {
        ...actual,
        // Non-empty entries so the loader skips the sitemap/410 retire path
        // and reaches the return object where the throw is injected.
        loadOfferTimeline: vi.fn().mockResolvedValue({
          entries: [timelineEntry()],
          asOfState: null,
        }),
        isOfferTimelineShareEnabled,
      };
    });

    const { loader } = await import("~/routes/timeline.$domain");

    let thrown: unknown = null;
    try {
      await loader({
        context: createContext(env),
        params: { domain: "nykaa.com" },
        request: new Request("https://0509.io/timeline/nykaa.com"),
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(503);
    expect(isOfferTimelineShareEnabled).toHaveBeenCalled();
  });

  it("still passes the 410 retire Response straight through the gate", async () => {
    const env = { DB: {} };
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/offer-timeline.server", async (importOriginal) => {
      const actual = await importOriginal<
        typeof import("~/lib/offer-timeline.server")
      >();
      return {
        ...actual,
        loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
        isOfferTimelineShareEnabled: vi.fn(() => true),
      };
    });
    // Unlisted domain → retire 410 (no sitemap entry for it).
    vi.doMock("~/lib/sitemap.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/sitemap.server")>();
      return {
        ...actual,
        loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([]),
        loadIndexableTimelineEntries: vi.fn().mockResolvedValue([]),
      };
    });

    const { loader } = await import("~/routes/timeline.$domain");

    let thrown: unknown = null;
    try {
      await loader({
        context: createContext(env),
        params: { domain: "unseeded-brand.com" },
        request: new Request("https://0509.io/timeline/unseeded-brand.com"),
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(410);

    vi.doUnmock("~/lib/sitemap.server");
  });
});
