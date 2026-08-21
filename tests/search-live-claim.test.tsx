// @vitest-environment happy-dom

/**
 * /search promise-audit gating (scout 2026-08-09).
 *
 * The anonymous /search idle state used to promise "We read what they are
 * running on Meta right now" unconditionally, while the discovery cache was
 * serving cached inventory. This file pins the new contract from the packet:
 *
 *   1. The idle/pre-search copy never says or implies "right now".
 *   2. Cached, stale, degraded, delayed, and partial results never use
 *      fresh/live language and keep an explicit source/freshness label.
 *   3. Fresh/"live" ("right now") wording is allowed ONLY in a result state
 *      backed by a proven fresh-live Ad Library capture — a cache miss on a
 *      healthy, non-partial provider.
 *
 * The unit half asserts the gating predicate and label directly against
 * fixtures; the route half renders the real /search route (same harness as
 * search-submission-settle and search-language) so the promise is pinned at the
 * level a visitor actually sees.
 */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatSearchFreshnessLabel, isProvenFreshLiveCapture } from "~/lib/search-display";
import type { AdRecord, SearchResponse } from "~/lib/types";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

let loaderData: Record<string, unknown>;
let locationObj: { pathname: string; search: string; hash: string };
let navigationState: {
  state: string;
  location?: { pathname: string; search: string } | null;
};

function mockRouter() {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", {
          ...props,
          href: typeof to === "string" ? to : "",
        }),
      useActionData: () => undefined,
      useLoaderData: () => loaderData,
      useLocation: () => locationObj,
      useNavigate: () => vi.fn(),
      useNavigation: () => navigationState,
      useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: () => ({ session: null }),
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const idleResult: SearchResponse = {
  ads: [],
  nextCursor: null,
  source: "meta_api",
  provider: "meta_api",
  cacheStatus: "none",
  discoveryStatus: "disabled",
  discoverySummary: null,
  discoveryFailureClass: null,
};

const resultAd: AdRecord = {
  metaAdId: "ad-nykaa",
  advertiser: "Nykaa",
  body: "Festive glow sale is live for one week only.",
  previewHeadline: "Festive glow sale",
  previewSubhead: "Fixture source evidence",
  hook: "Festive glow",
  offer: "Up to 40% off selected beauty",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://nykaa.com/festive-glow",
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  lastSeenAt: new Date().toISOString(),
  active: true,
  activeStatusObserved: true,
  researchSummary: "Fixture evidence.",
  source: "meta_library_browser",
  analysisFields: [],
};

function resultFixture(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    ads: [resultAd],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
    discoverySummary: null,
    discoveryFailureClass: null,
    ...overrides,
  };
}

/** A proven fresh-live capture: cache miss on a healthy, non-partial, real provider. */
const freshLiveResult = resultFixture();
/** Fresh cache hit — the "Cached live results" shape the 2026-08-09 canary saw. */
const cachedHitResult = resultFixture({ cacheStatus: "hit" });
/** Stale cache entry while discovery is degraded to cache-only. */
const cachedDegradedResult = resultFixture({
  cacheStatus: "stale",
  discoveryStatus: "cache_only",
  discoverySummary:
    "Live ad checks are temporarily delayed, so we're showing your most recent results.",
});
/** Degraded with no cached ads (miss + degraded), e.g. empty provider cooldown. */
const degradedEmptyResult = resultFixture({
  ads: [],
  cacheStatus: "miss",
  discoveryStatus: "degraded",
});
/** Cold-path warming: the capture runs in the background. */
const warmingResult = resultFixture({
  ads: [],
  cacheStatus: "miss",
  discoveryStatus: "degraded",
  discoveryProgress: "warming",
  discoverySummary: "Commercial discovery is already warming this query.",
});
/** Partial live capture (page 1 ok, later pages failed). */
const partialResult = resultFixture({
  discoveryPartial: true,
  discoverySummary: "Some additional Meta results could not be loaded.",
});

const searchedFilters = {
  query: "nykaa.com",
  country: "all",
  platform: "all",
  creativeType: "all",
  status: "all",
  firstSeenFrom: "",
  lastSeenFrom: "",
};

const baseLoaderData: Record<string, unknown> = {
  mode: "advertiser",
  filters: searchedFilters,
  fingerprint: "fp-nykaa",
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: {
    raw: "https://nykaa.com",
    normalizedUrl: "https://nykaa.com",
    host: "nykaa.com",
    displayName: "Nykaa",
    searchTerm: "nykaa.com",
    error: null,
  },
  trackingRole: "competitor",
  inputError: null,
  searchScope: "exact",
  displayDomain: "nykaa.com",
  relevanceApplied: false,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

const idleLoaderData: Record<string, unknown> = {
  ...baseLoaderData,
  filters: { ...searchedFilters, query: "" },
  fingerprint: "",
  result: idleResult,
  competitorWebsite: {
    raw: "",
    normalizedUrl: null,
    host: null,
    displayName: null,
    searchTerm: null,
    error: null,
  },
  displayDomain: null,
  relevanceApplied: false,
};

function queryLoaderData(result: SearchResponse): Record<string, unknown> {
  return {
    ...baseLoaderData,
    result,
    selectedAd: result.ads[0] ?? null,
  };
}

async function renderMarkup() {
  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

beforeEach(() => {
  loaderData = idleLoaderData;
  locationObj = { pathname: "/search", search: "", hash: "" };
  navigationState = { state: "idle", location: null };
  vi.resetModules();
  mockRouter();
});

/* ------------------------------------------------------------------ *
 * Unit: the fresh-live gate and the freshness labels
 * ------------------------------------------------------------------ */

describe("isProvenFreshLiveCapture", () => {
  it("is true ONLY for a proven fresh-live capture", () => {
    const fixtures: Array<[string, SearchResponse, boolean]> = [
      ["fresh live (miss + healthy + real provider)", freshLiveResult, true],
      ["idle (disabled)", idleResult, false],
      ["fresh cache hit", cachedHitResult, false],
      ["stale cache while cache-only", cachedDegradedResult, false],
      ["degraded with no cached ads", degradedEmptyResult, false],
      ["cold-path warming", warmingResult, false],
      ["partial live capture", partialResult, false],
      ["healthy but cache hit", resultFixture({ discoveryStatus: "healthy", cacheStatus: "hit" }), false],
      ["miss but unknown discovery status", resultFixture({ discoveryStatus: undefined }), false],
    ];
    for (const [name, fixture, expected] of fixtures) {
      expect(isProvenFreshLiveCapture(fixture), name).toBe(expected);
    }
  });
});

describe("formatSearchFreshnessLabel", () => {
  it("labels cached, degraded, and partial results honestly, never fresh-live", () => {
    expect(formatSearchFreshnessLabel(idleResult)).toBe("Freshness unavailable");
    expect(formatSearchFreshnessLabel(cachedHitResult)).toBe("Recent cached result");
    expect(formatSearchFreshnessLabel(cachedDegradedResult)).toBe("Fresh check delayed");
    expect(formatSearchFreshnessLabel(degradedEmptyResult)).toBe("Fresh check delayed");
    expect(formatSearchFreshnessLabel(warmingResult)).toBe("Fresh check delayed");
    expect(formatSearchFreshnessLabel(partialResult)).toBe("Fresh partial result");
  });

  it("allows fresh/live wording only on the proven fresh-live fixture", () => {
    expect(formatSearchFreshnessLabel(freshLiveResult)).toBe("Fresh live result");
    // No other state ever renders the live-claim label.
    const others = [
      idleResult,
      cachedHitResult,
      cachedDegradedResult,
      degradedEmptyResult,
      warmingResult,
      partialResult,
    ];
    for (const other of others) {
      expect(formatSearchFreshnessLabel(other)).not.toBe("Fresh live result");
    }
  });
});

/* ------------------------------------------------------------------ *
 * Route: the promise a visitor actually sees
 * ------------------------------------------------------------------ */

describe("public /search promise gating (route render)", () => {
  it("renders the idle state with no unconditional right-now promise", async () => {
    const markup = await renderMarkup();
    expect(markup).toContain("Nothing searched yet");
    expect(markup).not.toContain("right now");
    expect(markup).not.toMatch(/running on Meta right now/i);
  });

  it("renders cached results with an explicit cached freshness label and no live claim", async () => {
    loaderData = queryLoaderData(cachedHitResult);
    const markup = await renderMarkup();
    expect(markup).toContain("Recent cached result");
    expect(markup).not.toContain("Fresh live result");
    expect(markup).not.toContain("right now");
  });

  it("renders cached_degraded results with an explicit label and no live claim", async () => {
    loaderData = queryLoaderData(cachedDegradedResult);
    const markup = await renderMarkup();
    expect(markup).toContain("Fresh check delayed");
    expect(markup).not.toContain("Fresh live result");
    expect(markup).not.toContain("right now");
  });

  it("is the ONLY rendered result state that may use fresh/live language", async () => {
    loaderData = queryLoaderData(freshLiveResult);
    const markup = await renderMarkup();
    expect(markup).toContain("Fresh live result");
    // And it is not the idle promise: the idle copy itself stays honest.
    expect(markup).not.toMatch(/Paste a competitor website and press See ads\. We read what they/);
  });
});
