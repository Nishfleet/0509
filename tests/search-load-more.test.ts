import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, SearchResponse } from "~/lib/types";

type MockProps = { children?: ReactNode } & Record<string, unknown>;

const ad: AdRecord = {
  metaAdId: "ad-1",
  advertiser: "Example",
  body: "A useful offer.",
  previewHeadline: "A useful offer",
  previewSubhead: "",
  hook: "A useful offer",
  offer: "Launch pricing",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta",
  analysisFields: [],
};

function result(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    ads: [ad],
    nextCursor: "cursor-2",
    source: "meta",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
    discoverySummary: null,
    discoveryFailureClass: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search load-more accessibility", () => {
  it("appends unique pages, preserves selection, and resets only when the search identity changes", async () => {
    const {
      buildSearchAccumulationKey,
      createSearchAccumulationState,
      mergeSearchAccumulationState,
    } = await import("~/routes/search");
    const firstKey = buildSearchAccumulationKey({
      fingerprint: "fp-1",
      mode: "advertiser",
      searchScope: "exact",
      competitorWebsite: { normalizedUrl: "https://example.com" },
    });
    const secondKey = buildSearchAccumulationKey({
      fingerprint: "fp-2",
      mode: "advertiser",
      searchScope: "exact",
      competitorWebsite: { normalizedUrl: "https://other.example" },
    });
    expect(secondKey).not.toBe(firstKey);

    const first = createSearchAccumulationState(firstKey, result(), ad);
    const secondAd = { ...ad, metaAdId: "ad-2", previewHeadline: "Second" };
    const duplicateUpdate = { ...ad, previewHeadline: "Updated first" };
    const merged = mergeSearchAccumulationState(
      first,
      result({ ads: [duplicateUpdate, secondAd], nextCursor: "cursor-3" }),
      { requestedCursor: "cursor-2", selectedAd: null },
    );

    expect(merged.result.ads.map((item) => item.metaAdId)).toEqual(["ad-1", "ad-2"]);
    expect(merged.result.ads[0]?.previewHeadline).toBe("Updated first");
    expect(merged.selectedAd?.metaAdId).toBe("ad-1");
    expect(merged.addedCount).toBe(1);
    expect(merged.result.nextCursor).toBe("cursor-3");
    expect(merged.retryCursor).toBeNull();

    const reset = createSearchAccumulationState(secondKey, result({ ads: [secondAd] }), secondAd);
    expect(reset.result.ads.map((item) => item.metaAdId)).toEqual(["ad-2"]);
  });

  it("keeps earlier cards and the same cursor when a later page is delayed", async () => {
    const { createSearchAccumulationState, mergeSearchAccumulationState } = await import("~/routes/search");
    const first = createSearchAccumulationState("search-1", result(), ad);
    const delayed = mergeSearchAccumulationState(
      first,
      result({
        ads: [],
        nextCursor: null,
        discoveryStatus: "degraded",
        discoverySummary: "Fresh checks are delayed.",
      }),
      { requestedCursor: "cursor-2", selectedAd: null },
    );

    expect(delayed.result.ads).toEqual([ad]);
    expect(delayed.result.nextCursor).toBe("cursor-2");
    expect(delayed.retryCursor).toBe("cursor-2");
    expect(delayed.selectedAd).toEqual(ad);
  });

  it("announces loading, result counts, completion, and delayed checks without raw errors", async () => {
    const {
      formatSearchResultsAnnouncement,
      hasRecentSearchDelay,
      resolveRecoveredSearchKey,
    } = await import("~/routes/search");

    expect(formatSearchResultsAnnouncement(result(), { isLoading: true })).toBe(
      "Loading more search results…",
    );
    expect(formatSearchResultsAnnouncement(result())).toBe("1 search result loaded. More results are available.");
    expect(
      formatSearchResultsAnnouncement(result({ ads: [], nextCursor: null, discoveryStatus: "degraded" })),
    ).toBe("No results loaded. Fresh checks are delayed, so coverage may be incomplete.");
    expect(formatSearchResultsAnnouncement(result({ nextCursor: null }), { recovered: true })).toBe(
      "1 search result loaded. No more results. Search checks have recovered.",
    );
    expect(formatSearchResultsAnnouncement(result({ ads: [], nextCursor: null }))).toBe(
      "No search results found. Search complete.",
    );
    expect(formatSearchResultsAnnouncement(result({ ads: [], nextCursor: null }))).not.toMatch(
      /Error|Failed|D1|binding/i,
    );
    expect(formatSearchResultsAnnouncement(result({ ads: [ad, { ...ad, metaAdId: "ad-2" }] }), {
      addedCount: 1,
    })).toBe("1 more result loaded. 2 total search results. More results are available.");
    expect(formatSearchResultsAnnouncement(result(), { retryCursor: "cursor-2" })).toBe(
      "1 search result remains available. Fresh checks for more results are delayed. Retry when ready.",
    );

    const recoveredKey = resolveRecoveredSearchKey({
      currentDiscoveryStatus: "healthy",
      currentRecoveryKey: null,
      previousDiscoveryStatus: "degraded",
      searchKey: "nykaa",
    });
    expect(recoveredKey).toBe("nykaa");
    expect(resolveRecoveredSearchKey({
      currentDiscoveryStatus: "healthy",
      currentRecoveryKey: recoveredKey,
      previousDiscoveryStatus: "healthy",
      searchKey: "nykaa",
    })).toBe("nykaa");
    expect(resolveRecoveredSearchKey({
      currentDiscoveryStatus: "healthy",
      currentRecoveryKey: recoveredKey,
      previousDiscoveryStatus: "healthy",
      searchKey: "other",
    })).toBeNull();
    expect(resolveRecoveredSearchKey({
      currentDiscoveryStatus: "degraded",
      currentRecoveryKey: recoveredKey,
      previousDiscoveryStatus: "healthy",
      searchKey: "other",
    })).toBeNull();
    const now = Date.parse("2026-07-16T05:30:00.000Z");
    expect(hasRecentSearchDelay(JSON.stringify({ delayed: true, observedAt: now - 1_000 }), now)).toBe(true);
    expect(hasRecentSearchDelay(JSON.stringify({ delayed: false, observedAt: now - 1_000 }), now)).toBe(false);
    expect(hasRecentSearchDelay(JSON.stringify({ delayed: true, observedAt: now - 6 * 60 * 1_000 }), now)).toBe(false);
    expect(hasRecentSearchDelay(JSON.stringify({ delayed: true, observedAt: now + 1 }), now)).toBe(false);
    expect(hasRecentSearchDelay("not-json", now)).toBe(false);
  });

  it("renders load-more as a keyboard-submit form with a busy disabled button", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: MockProps) => React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockProps & { to?: string }) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useActionData: vi.fn().mockReturnValue(undefined),
        useLoaderData: vi.fn().mockReturnValue({
          mode: "advertiser",
          filters: {
            query: "example.com",
            country: "all",
            platform: "all",
            creativeType: "all",
            status: "all",
            firstSeenFrom: "",
            lastSeenFrom: "",
          },
          fingerprint: "fp-1",
          result: result(),
          selectedAd: null,
          collections: [],
          session: null,
          competitorWebsite: {
            raw: "https://example.com",
            normalizedUrl: "https://example.com",
            host: "example.com",
            displayName: "Example",
            error: null,
          },
          trackingRole: "competitor",
          searchScope: "exact",
          displayDomain: "example.com",
          relevanceApplied: true,
          inputError: null,
          showOpsNav: false,
          showPresenceNav: false,
        }),
        useLocation: vi.fn().mockReturnValue({ pathname: "/search", search: "", hash: "" }),
        useNavigation: vi.fn().mockReturnValue({
          state: "loading",
          location: { pathname: "/search", search: "?after=cursor-2" },
          formData: new FormData(),
        }),
        useRouteLoaderData: vi.fn().mockReturnValue({ session: null }),
      };
    });
    vi.doMock("~/components/dashboard-shell", () => ({
      DashboardShell: ({ children }: MockProps) => children,
    }));
    vi.doMock("~/components/ad-longevity-pill", () => ({ AdLongevityPill: () => null }));
    vi.doMock("~/components/ad-thumb", () => ({ AdThumb: () => null }));
    vi.doMock("~/components/search-answer-panel", () => ({ SearchAnswerPanel: () => null }));

    const { default: SearchRoute } = await import("~/routes/search");
    const markup = renderToStaticMarkup(createElement(SearchRoute));

    expect(markup).toContain('aria-label="Load more search results"');
    expect(markup).toContain('action="/search"');
    expect(markup).toContain('name="after" value="cursor-2"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Loading…");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Loading more search results…");
    expect(markup).not.toMatch(/D1 database|Missing D1|Workflow execution failed/);
  });
});
