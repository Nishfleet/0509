/**
 * Issue #2961 — every /ads/:domain and /timeline/:domain URL listed in the
 * sitemaps must ship server-rendered JSON-LD whose `@id` equals the page's
 * <link rel="canonical">. These pages are 80% of the crawled proof surface
 * (BET 5b); previously the WebPage block carried only `url`, no `@id`.
 *
 * Follows the tests/seo/help-faq-schema.test.tsx precedent: a real
 * renderToStaticMarkup render of the route component with the react-router
 * hooks mocked, no binding mocks — the fixture is the same loader_data the
 * live pages render.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "../helpers/mock-react-router";
import type { AdRecord } from "~/lib/types";
import type { OfferLedgerEntry } from "~/lib/offer-timeline";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { OfferTimelineLoaderData } from "~/routes/timeline.$domain";

type AnyFixtureData = BrandPageLoaderData | OfferTimelineLoaderData;

let currentData: AnyFixtureData;

beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loader: () => currentData,
    loaderData: () => undefined,
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [
    ...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

function canonicalHref(markup: string): string {
  const match = markup.match(/rel="canonical" href="([^"]+)"/);
  expect(match, "the rendered page must state a canonical link").not.toBeNull();
  return match![1];
}

/** Assert the metric on one rendered page: JSON-LD present, parses, @id == canonical. */
function assertStructuredData(markup: string): void {
  const blocks = parseLdJsonBlocks(markup);
  expect(blocks.length, "page must ship at least one JSON-LD block").toBeGreaterThan(0);

  const canonical = canonicalHref(markup);
  const onPage = blocks.filter((block) => block["@type"] === "WebPage");
  expect(onPage, "must include one WebPage block").toHaveLength(1);
  expect(onPage[0]?.["@id"]).toBe(canonical);
}

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    body: "Run through summer.",
    previewHeadline: "Run through summer with gear that can take the heat.",
    previewSubhead: "",
    hook: "Shop Now",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/launch",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

/**
 * A sitemap-listed, indexable /ads/:domain page: fresh cached snapshot, at
 * least one verified-linked ad, one stored Offer Timeline entry (the shape
 * the live page and its /timeline sibling render).
 */
function cachedIndexable(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  const ads = Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` }));
  const ledger: OfferLedgerEntry = {
    id: "s1",
    capturedAt: "2026-08-01T10:00:00.000Z",
    dateLabel: "1 Aug 2026",
    canonicalUrl: "https://www.nike.com/",
    headline: "Nike. Just Do It.",
    ctaText: "Shop Now",
    priceText: null,
    formPresent: false,
    screenshotHref: null,
    pageTextHref: null,
    evidenceNote: null,
    transition: null,
    runExtentLabel: null,
  };
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads,
    adCount: ads.length,
    verifiedTestedCount: 0,
    tickerAds: [],
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-08-09T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser: {
      totalCount: 6,
      activeCount: 6,
      longestRunningDays: 126,
      longestRunningHook: "Charge shin guards",
      formats: ["image", "video", "carousel"],
    },
    aggression: {
      score: 78,
      components: { velocity: 22, testing: 19, freshness: 20, persistence: 17 },
      bandId: "all_out",
      bandLabel: "All-out",
      bandInterpretation: "Running an all-out launch and testing push.",
      formulaVersion: 1,
      windowDays: 21,
      adsPerWeek: 6,
      adCount: 6,
      activeCount: 6,
    },
    changeEvents: [],
    observationDays: null,
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    offerTimelineEntries: [ledger],
    timelineIndexable: true,
    captureFailuresSummary: null,
    recentWatchChanges: [],
    sourceSnapshots: [],
    ...overrides,
  };
}

function timelineData(overrides: Partial<OfferTimelineLoaderData> = {}): OfferTimelineLoaderData {
  const ledger: OfferLedgerEntry = {
    id: "s1",
    capturedAt: "2026-08-10T10:00:00.000Z",
    dateLabel: "10 Aug 2026",
    canonicalUrl: "https://shop.nykaa.com/glow",
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
  return {
    domain: "nykaa.com",
    brandName: "Nykaa",
    canonicalPath: "/timeline/nykaa.com",
    sharePath: "/timeline/nykaa.com",
    shareUrl: "https://0509.io/timeline/nykaa.com",
    shareEnabled: true,
    asOf: null,
    asOfState: null,
    entries: [ledger],
    archive: {
      subject: "nykaa.com",
      generatedAt: "2026-09-01T00:00:00.000Z",
      entries: [],
      gaps: [],
      adTenure: [],
      offerHistory: [],
      monthSummary: null,
    },
    sourceEvents: [],
    noindex: false,
    collecting: false,
    ...overrides,
  };
}

describe("ads-timeline structured data (issue #2961 metric)", () => {
  it("/ads/:domain emits server-rendered JSON-LD whose @id equals the canonical", async () => {
    currentData = cachedIndexable();
    const { default: BrandAdsRoute } = await import("~/routes/ads.$domain");
    const markup = renderToStaticMarkup(createElement(BrandAdsRoute));
    expect(markup).toContain("application/ld+json");
    assertStructuredData(markup);
  });

  it("/timeline/:domain emits server-rendered JSON-LD whose @id equals the canonical", async () => {
    currentData = timelineData();
    const { default: OfferTimelineRoute } = await import("~/routes/timeline.$domain");
    const markup = renderToStaticMarkup(createElement(OfferTimelineRoute));
    expect(markup).toContain("application/ld+json");
    assertStructuredData(markup);
  });
});
