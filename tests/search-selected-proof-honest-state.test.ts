import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";

import { PUBLIC_SEARCH_TRANSIENT_DEGRADED_MESSAGE } from "~/lib/customer-route-error";

// Issue #3400 — the money path's selected= proof leg (the #2810 contract):
// the leg answers 200 with either the proof or the honest no-proof degraded
// state, never a 500. The 2026-09-13T18:45Z money-path walk caught the
// mobile leg answering 500 on the result step while the desktop leg of the
// same walk answered 200 for the identical URL, and the fault is transient,
// not deterministically reproducible (200 x5 by 19:01Z; 22/22 non-500 in
// the 2026-09-14 worker window). These tests exercise the guard at the two
// seams where the leg used to escape to the route ErrorBoundary:
//
// 1. the live-search leg itself (the anonymous cold first search — the
//    18:45Z walk's mobile session), and
// 2. the evidence hydration/selection seam, where withTransientRetry
//    (#2001) exhausts its bounded attempts and rethrows.
//
// Both must resolve to the same honest degraded payload the limiter and
// warming paths already standardise. A returned payload renders as a 200;
// only a thrown loader error becomes the ErrorBoundary document (the 500
// this leg must never answer).

// The /search loader returns a plain payload object for most branches, but
// the anonymous fresh-search success branch (issue #1972 phase 1) returns
// react-router `data(...)` so it can Set-Cookie without a JSON Response.
// Unwrap whichever shape came back so assertions on the payload stay
// shape-stable. (Same helper shape as tests/search.route.test.ts — the
// helpers there are module-private, so this file carries its own copy.)
type SearchLoaderPayload = {
  result?: unknown;
  selectedAd?: unknown;
  selectedAdCapture?: unknown;
  resultCaptureAgeLabel?: unknown;
  selectionEnrichmentPending?: unknown;
  landingPageCaptureFailure?: unknown;
  session?: unknown;
  inputError?: unknown;
};

function isDataWithResponseInit(
  value: unknown,
): value is { type: string; data: SearchLoaderPayload } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "DataWithResponseInit" &&
    "data" in value
  );
}

async function unwrapLoaderResult(
  loaderFn: (args: LoaderFunctionArgs) => Promise<unknown>,
  args: LoaderFunctionArgs,
): Promise<SearchLoaderPayload> {
  const out = await loaderFn(args);
  if (out instanceof Response) {
    return (await out.json()) as SearchLoaderPayload;
  }
  if (isDataWithResponseInit(out)) return out.data;
  return out as SearchLoaderPayload;
}

// The exact anonymous money-path URL from issue #3400: the selected= proof
// leg of the /search -> result step (mode/filters as the walk fired them).
const MONEY_PATH_SELECTED_URL =
  "http://localhost/search?mode=advertiser&query=nike&country=all&platform=all&creativeType=all&status=all&trackingRole=competitor&selected=1702938977100376";

// The honest degraded copy the leg answers with — the single source of
// truth lives in customer-route-error.ts and the #3400 tests pin it.
const HONEST_DEGRADED_INPUT_ERROR = PUBLIC_SEARCH_TRANSIENT_DEGRADED_MESSAGE;

function createContext(env: unknown) {
  return {
    cloudflare: {
      env,
    },
  };
}

describe("search selected-proof leg: honest degraded state, never a 500 (issue #3400)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/funnel-measurement.server");
    vi.doUnmock("~/lib/rate-limit.server");
    vi.doUnmock("~/lib/search-execution.server");
    vi.doUnmock("~/lib/search-selection.server");
    vi.doUnmock("~/lib/workspace.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function mockAnonymousSearchLegModules(env: unknown) {
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const emitFunnelSearchSubmit = vi.fn();
    const emitFunnelSearchResult = vi.fn();
    const emitFunnelSearchError = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession,
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections,
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    // The money-path URL carries ?selected=, so the loader probes the
    // discovery cache to decide whether the selection is served warm
    // (which limiter applies). The 18:45Z walk leg was a cold first
    // search: no warm entry, the public-search budget path.
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(false),
      attachKeywordSearchDomainMatch: vi.fn(
        async (_env: unknown, result: unknown) => result,
      ),
    }));
    vi.doMock("~/lib/funnel-measurement.server", () => ({
      emitFunnelSearchSubmit,
      emitFunnelSearchResult,
      emitFunnelSearchError,
      funnelErrorKindFromUnknown: vi.fn(() => "unknown"),
    }));

    return {
      emitFunnelSearchResult,
      emitFunnelSearchError,
    };
  }

  it("live-search leg transient throw answers the honest degraded 200, not an ErrorBoundary 500", async () => {
    const env = { DB: {} };
    const { emitFunnelSearchResult, emitFunnelSearchError } =
      mockAnonymousSearchLegModules(env);

    // The 18:45Z-class failure: the anonymous cold first search's live
    // source resolution throws transiently (the desktop leg of the same
    // walk had answered 200 seconds later). Mocked where the fault fires.
    const searchAdsViaSourceResolver = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "D1_ERROR: transient upstream hiccup (money-path walk 2026-09-13T18:45Z class)",
        ),
      );
    // The selection module is imported but never reached on this path.
    const prepareSearchResultSelection = vi.fn();
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    // Resolving (not throwing) IS the 200-vs-500 proof: a thrown loader
    // error would reject here and render the route ErrorBoundary as the
    // 500 this leg must never answer.
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request(MONEY_PATH_SELECTED_URL),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      session: null,
      inputError: HONEST_DEGRADED_INPUT_ERROR,
      selectedAd: null,
      selectedAdCapture: undefined,
      resultCaptureAgeLabel: null,
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
      result: expect.objectContaining({ ads: [] }),
    });
    // Single coarse failure record from the inner search catch — no
    // double emission, and the success-path result emission never ran.
    expect(emitFunnelSearchError).toHaveBeenCalledTimes(1);
    expect(emitFunnelSearchResult).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
  });

  it("selection seam transient exhaustion (withTransientRetry rethrow) answers the same honest 200", async () => {
    const env = { DB: {} };
    const { emitFunnelSearchResult, emitFunnelSearchError } =
      mockAnonymousSearchLegModules(env);

    // The live search SUCCEEDED (the 18:45Z walk's desktop leg class);
    // the evidence hydration/selection behind it is what exhausts the
    // #2001 bounded transient retry and rethrows — the 500 seam.
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
      result: {
        ads: [],
        nextCursor: null,
        source: "meta",
        cacheStatus: "miss",
        discoveryStatus: "complete",
      },
      query: {
        mode: "advertiser",
        filters: { query: "nike", country: "all" },
      },
      searchScope: "exact",
      displayDomain: "nike.com",
      relevanceApplied: false,
    });
    const prepareSearchResultSelection = vi
      .fn()
      .mockRejectedValue(
        new Error("D1_ERROR: transient hydration hiccup (#3400 repro)"),
      );
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request(MONEY_PATH_SELECTED_URL),
    } as never);

    // The #2001 bounded transient retry fired before the guard caught:
    // two attempts, then the second attempt's rethrow — which is exactly
    // the throw that used to escape to the route ErrorBoundary as a 500.
    expect(prepareSearchResultSelection).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      session: null,
      inputError: HONEST_DEGRADED_INPUT_ERROR,
      selectedAd: null,
      selectedAdCapture: undefined,
      resultCaptureAgeLabel: null,
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
      result: expect.objectContaining({ ads: [] }),
    });
    // The search succeeded, so no funnel failure record — and the
    // success-path result emission never ran (the throw happened before
    // it). Later-stage failure reporting stays #3129's lane.
    expect(emitFunnelSearchError).not.toHaveBeenCalled();
    expect(emitFunnelSearchResult).not.toHaveBeenCalled();
  });
});
