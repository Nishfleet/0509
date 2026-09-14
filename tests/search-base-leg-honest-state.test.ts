import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";

import { PUBLIC_SEARCH_TRANSIENT_DEGRADED_MESSAGE } from "~/lib/customer-route-error";

// Issue #3456 — the money path's base /search?q= leg (the #2810 contract):
// the leg answers 200 with rendered results or the honest degraded state,
// never a 500. Three independent 500 windows were caught on this leg, each
// recovering within minutes: the 2026-09-14T00:45Z money-path walk (desktop
// session on /search?q=nike&country=all → HTTP 500 while the mobile session
// on the identical URL answered 200 seconds earlier), the 2026-09-14T06:20–
// 06:27Z recall run (hubspot.com and allbirds.com → the 19,994-byte
// "Unexpected Server Error" shell while gymshark/ridge/notion/oura → 200),
// and the 06:33Z paced re-run confirmed the intermittent shape (200x2 each).
// The base leg shares the #3400 leg-wide guard (merged via #3467): every
// seam BEFORE the guard fails safe already (cache probe, both anonymous
// limiters, plan lookup), and the guard wraps the whole execution region —
// so a thrown upstream/cache failure degrades to the same honest
// idle+inputError 200 the limiter and warming paths standardise. These
// tests drive the base-leg seams that used to escape to the route
// ErrorBoundary:
//
// 1. the live-search call itself (the anonymous cold first search — the
//    upstream Meta fetch throw / 429 / cache-D1 hiccup class the walk and
//    recall run caught),
// 2. the keyword domain-match tiering that only the bare `q=` leg runs
//    (a base-leg-only seam — `website=` searches skip it), and
// 3. the evidence hydration/selection seam, where withTransientRetry
//    (#2001) exhausts its bounded attempts and rethrows.
//
// All three must resolve to the same honest degraded payload. A returned
// payload renders as a 200; only a thrown loader error becomes the
// ErrorBoundary document (the 500 this leg must never answer).

// The /search loader returns a plain payload object for most branches, but
// the anonymous fresh-search success branch (issue #1972 phase 1) and the
// #3400 degraded branch return react-router `data(...)` so they can set
// response headers. Unwrap whichever shape came back so assertions on the
// payload stay shape-stable. (Same helper shape as
// tests/search-selected-proof-honest-state.test.ts.)
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

// The exact anonymous money-path URL from issue #3456: the base `q=` leg
// that answered the "Unexpected Server Error" shell for hubspot.com in the
// 2026-09-14T06:20–06:27Z recall run (`q` is the shared-link alias for the
// canonical `query` param — normalize.ts maps it identically).
const MONEY_PATH_BASE_URL =
  "http://localhost/search?q=hubspot.com&country=all";

// The honest degraded copy the leg answers with — the single source of
// truth lives in customer-route-error.ts and the honest-state tests pin it.
const HONEST_DEGRADED_INPUT_ERROR = PUBLIC_SEARCH_TRANSIENT_DEGRADED_MESSAGE;

function createContext(env: unknown) {
  return {
    cloudflare: {
      env,
    },
  };
}

describe("search base q= leg: honest degraded state, never a 500 (issue #3456)", () => {
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
      emitFunnelSearchSubmit,
      emitFunnelSearchResult,
      emitFunnelSearchError,
    };
  }

  it("live-search upstream throw answers the honest degraded 200, not an ErrorBoundary 500", async () => {
    const env = { DB: {} };
    const { emitFunnelSearchSubmit, emitFunnelSearchResult, emitFunnelSearchError } =
      mockAnonymousSearchLegModules(env);

    // The 00:45Z/06:25Z-class failure: the anonymous cold first search's
    // live source resolution throws transiently (upstream Meta fetch
    // failure or 429, cache/D1 hiccup) — the throw that used to escape to
    // the route ErrorBoundary. Mocked where the fault fires.
    const searchAdsViaSourceResolver = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "D1_ERROR: transient upstream hiccup (money-path walk 2026-09-14T00:45Z / recall run 06:25Z class)",
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
    const raw = await loader({
      context: createContext(env),
      request: new Request(MONEY_PATH_BASE_URL),
    } as never);
    // The degraded 200 ships with Cache-Control: no-store so a transient
    // failure is never edge- or browser-cached (issue #3400's contract,
    // shared by this leg).
    expect(
      (raw as { init?: { headers?: Record<string, string> } }).init?.headers?.[
        "Cache-Control"
      ],
    ).toBe("no-store");
    const result = await unwrapLoaderResult(async () => raw, {} as never);

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
    // The base leg is a fresh search (no selected=, no after=): submit
    // fires once, the inner search catch funnel-records the failure once,
    // and the success-path result emission never ran.
    expect(emitFunnelSearchSubmit).toHaveBeenCalledTimes(1);
    expect(emitFunnelSearchError).toHaveBeenCalledTimes(1);
    expect(emitFunnelSearchResult).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
  });

  it("keyword domain-match tiering throw (the base-leg-only seam) answers the same honest 200", async () => {
    const env = { DB: {} };
    const { emitFunnelSearchResult, emitFunnelSearchError } =
      mockAnonymousSearchLegModules(env);

    // The bare `q=` leg's own extra seam: after the live source resolves,
    // the keyword tiering step (attachKeywordSearchDomainMatch — skipped on
    // `website=` searches) throws. Same inner catch, same leg guard, same
    // honest degraded 200.
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta",
      cacheStatus: "miss",
      discoveryStatus: "complete",
    });
    const attachKeywordSearchDomainMatch = vi
      .fn()
      .mockRejectedValue(
        new Error("D1_ERROR: transient tiering hiccup (#3456 base-leg seam)"),
      );
    const prepareSearchResultSelection = vi.fn();
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(false),
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request(MONEY_PATH_BASE_URL),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledTimes(1);
    expect(attachKeywordSearchDomainMatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      session: null,
      inputError: HONEST_DEGRADED_INPUT_ERROR,
      selectedAd: null,
      result: expect.objectContaining({ ads: [] }),
    });
    // The throw sits inside the inner search catch, so the coarse funnel
    // failure record fires once and the success-path emission never ran.
    expect(emitFunnelSearchError).toHaveBeenCalledTimes(1);
    expect(emitFunnelSearchResult).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
  });

  it("selection seam transient exhaustion on the base leg answers the same honest 200", async () => {
    const env = { DB: {} };
    const { emitFunnelSearchResult, emitFunnelSearchError } =
      mockAnonymousSearchLegModules(env);

    // The live search SUCCEEDED; the evidence hydration/selection behind
    // it is what exhausts the #2001 bounded transient retry and rethrows —
    // the same seam #3400 filed on the selected= leg, exercised here on
    // the base leg the recall run caught.
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
      ads: [],
      nextCursor: null,
      source: "meta",
      cacheStatus: "miss",
      discoveryStatus: "complete",
    });
    const prepareSearchResultSelection = vi
      .fn()
      .mockRejectedValue(
        new Error("D1_ERROR: transient hydration hiccup (#3456 repro)"),
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
      request: new Request(MONEY_PATH_BASE_URL),
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

  it("streamTimeout covers the deferred landing capture window — the default 4950ms amputated it into an error slot", async () => {
    // Issue #3456 root seam for the streamed 200-shell: React Router races
    // every pending loader deferred against `streamTimeout` (default
    // 4,950ms) and serializes the loser as a SanitizedError ("Unexpected
    // Server Error") chunk — the ridge.com leg returned HTTP 200 with
    // exactly that error slot in the streamed handoff. The #3014 deferred
    // landing capture is designed for 15-25s (internal bound ~40s), so the
    // export must clear that window or healthy cold captures keep landing
    // the pane's <Await> on the route ErrorBoundary.
    const { streamTimeout } = await import("~/entry.server");
    expect(streamTimeout).toBeGreaterThanOrEqual(60_000);
  });
});
