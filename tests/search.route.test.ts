import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";

import {
  mapCustomerRouteError,
  PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
  PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE,
} from "~/lib/customer-route-error";
import type { AdRecord, SearchResponse } from "~/lib/types";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

// The /search loader returns a plain payload object for most branches, but the
// anonymous fresh-search success branch (issue #1972 phase 1) returns react-router
// `data(...)` so it can Set-Cookie without a JSON Response. Unwrap whichever
// shape came back so assertions on the payload stay shape-stable. Do not
// import DataWithResponseInit — react-router only re-exports it as
// UNSAFE_DataWithResponseInit, which fails tsc.
type SearchLoaderPayload = {
  result?: unknown;
  selectedAd?: unknown;
  relevanceApplied?: unknown;
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

const baseAd: AdRecord = {
  metaAdId: "meta-boat-1",
  advertiser: "boAt",
  body: "Bass bhi, battery bhi.",
  previewHeadline: "Bass bhi. Battery bhi.",
  previewSubhead: "Launch pricing",
  hook: "Bass bhi. Battery bhi.",
  offer: "Launch pricing",
  cta: "Buy now",
  format: "image",
  languageLabel: "Hinglish",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: "https://cdn.example.com/meta-boat-1.png",
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta",
  analysisFields: [],
};

const attachKeywordSearchDomainMatch = vi
  .fn()
  .mockImplementation(async (_env: unknown, result: SearchResponse) => result);

const appSession = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

function mockWorkspaceAuth(session = appSession) {
  return {
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  };
}

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
    requireVerifiedEmailForRetention: vi.fn().mockResolvedValue({ ok: true }),
    emailUnverifiedActionResult: () => ({
      ok: false,
      error: "email_unverified",
      message: "Verify your email",
    }),
    requestEmailVerification: vi.fn().mockResolvedValue({ ok: true }),
    EMAIL_UNVERIFIED_ERROR: "email_unverified",
    EMAIL_UNVERIFIED_MESSAGE: "Verify your email",
  }));
});

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/creative-text.server");
  vi.doUnmock("~/lib/customer-meta.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/email-verification.server");
  vi.doUnmock("~/lib/landing-pages.server");
  vi.doUnmock("~/lib/monitoring.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/search-execution.server");
  vi.doUnmock("~/lib/search-selection.server");
  vi.doUnmock("~/lib/translation.server");
  vi.doUnmock("~/lib/analysis.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search loader", () => {
  it("302s anonymous bare /search to /brands without calling live discovery (issue #2965)", async () => {
    const env = { DB: {} };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

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
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const out = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search"),
    } as never);

    expect(getOptionalSession).toHaveBeenCalledWith(env, expect.any(Request));
    expect(listCollections).not.toHaveBeenCalled();
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
    // Issue #2965: anonymous bare /search is an empty-q page that used to be
    // indexable — it must 302 to the indexable /brands hub instead of
    // rendering the idle shell to crawlers.
    expect(out).toBeInstanceOf(Response);
    const redirect = out as Response;
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/brands");
  });

  it("302s anonymous bare /{locale}/search and .data twins to /brands (issue #2965)", async () => {
    const env = { DB: {} };
    const listCollections = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections,
    }));

    const { loader } = await import("~/routes/search");
    // The locale route re-exports this loader, so anonymous bare locale
    // search must bounce exactly like EN — otherwise /de/search stays a 200
    // indexable empty funnel. The .data variants are what a client-side
    // <Link to="/search"> actually fetches, so they redirect too.
    for (const [request, params] of [
      [new Request("http://localhost/de/search"), { locale: "de" }],
      [new Request("http://localhost/search.data"), {}],
      [new Request("http://localhost/pt-br/search.data"), { locale: "pt-br" }],
    ] as const) {
      const out = await loader({
        context: createContext(env),
        request,
        params,
      } as never);
      expect(out).toBeInstanceOf(Response);
      const res = out as Response;
      expect(res.status, request.url).toBe(302);
      expect(res.headers.get("location"), request.url).toBe("/brands");
    }
    expect(listCollections).not.toHaveBeenCalled();
  });

  it("keeps the idle search UI for a signed-in visitor on bare /search", async () => {
    const env = { DB: {} };
    const listCollections = vi.fn().mockResolvedValue([]);
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search"),
    } as never);

    // The dashboard/set-up-checklist funnels link to bare /search; a signed-
    // in user must still get the search UI, not the /brands bounce.
    expect(result).toMatchObject({
      session: { user: appSession.user },
      result: {
        ads: [],
        discoveryStatus: "disabled",
      },
    });
  });

  it("returns plan=null to the UI when the plan lookup blips for a signed-in user", async () => {
    const env = { DB: {} };
    const getUserPlan = vi.fn().mockRejectedValue(new Error("D1 blip"));

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search"),
    } as never);

    expect(getUserPlan).toHaveBeenCalled();
    // On a transient lookup failure the UI must not render from a guess: no
    // free-plan upsell, no paid-only affordances (plan=null hides both).
    // Rate limiting substitutes starter sizing internally so a paying
    // customer is not throttled to free limits, and real plan gates (saves,
    // watchlists) re-check server-side and fail closed.
    expect(result).toMatchObject({ plan: null });
  });

  it("does not call live discovery before a signed-in user submits a query", async () => {
    const env = { DB: {} };
    const getOptionalSession = vi.fn().mockResolvedValue(appSession);
    const listCollections = vi.fn().mockResolvedValue([]);
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

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
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search"),
    } as never);

    expect(getOptionalSession).toHaveBeenCalledWith(env, expect.any(Request));
    expect(listCollections).toHaveBeenCalledWith(env, appSession.user.id);
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      filters: {
        query: "",
        country: "all",
      },
      result: {
        ads: [],
        nextCursor: null,
        source: "demo",
        cacheStatus: "none",
        discoveryStatus: "disabled",
      },
      selectedAd: null,
    });
  });

  it("runs read-only live discovery for a logged-out visitor with a query", async () => {
    const env = { DB: {} };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const hydratedResult = {
      ...sourceResult,
      cacheStatus: "miss",
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: hydratedResult,
      selectedAd: baseAd,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

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
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?q=nike&country=all"),
    } as never);

    expect(listCollections).not.toHaveBeenCalled();
    expect(enforcePublicSearchRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      undefined,
      expect.any(String),
    );
    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({
          query: "nike",
          country: "all",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        ads: [
          expect.objectContaining({
            domainMatch: expect.objectContaining({
              level: "unverified_provider_candidate",
            }),
          }),
        ],
        searchIntent: "text",
        verifiedCount: 0,
        likelyCount: 0,
        unmatchedCount: 1,
      }),
      null,
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );
    expect(result).toMatchObject({
      session: null,
      result: hydratedResult,
      selectedAd: baseAd,
    });
  });

  it("anonymous warming re-poll does not burn the public-search budget", async () => {
    // Regression (issue #2262): an anonymous visitor runs ONE cold search and
    // the client polls revalidate() every 2s while the discovery cache warms.
    // Each poll reruns the loader with no selected param, so the anonymous
    // gate used to call enforcePublicSearchRateLimit again, inserting a
    // rate_limit_events row per poll. The 21st request (search + 20 polls)
    // self-429ed a single user-initiated search inside its own warming window.
    // The anonymous gate now mirrors the signed-in warm-cache exemption: when
    // a warming/complete cache entry exists for the same search key, the
    // per-browser budget is not charged. This test invokes the loader 21 times
    // with the same f9_anon_search cookie while a warming cache entry exists
    // and asserts none of them 429: the exemption short-circuits the limiter,
    // so the per-browser budget is never charged on a warm re-poll. (The
    // real D1-backed limiter is exercised by the sibling cold-query test.)
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = { DB: harness.db };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const warmingResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "degraded",
      discoveryProgress: "warming",
      discoveryPartial: true,
      discoverySummary: "Showing the first ads while we load more from the Ad Library.",
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(warmingResult);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(true);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: warmingResult,
      selectedAd: null,
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
    });

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
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch: vi.fn(),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const anonCookie = "f9_anon_search=11111111-1111-4111-8111-111111111111";
    const request = () =>
      new Request("http://localhost/search?website=https%3A%2F%2Fnykaa.com", {
        headers: { cookie: anonCookie, "cf-connecting-ip": "203.0.113.77" },
      });

    for (let index = 0; index < 21; index += 1) {
      const result = await unwrapLoaderResult(loader, {
        context: createContext(env),
        request: request(),
      } as never);
      // A 429 would surface as a thrown Response; reaching here means the
      // loader returned a payload, so the warm re-poll did not burn the budget.
      expect(result).toBeDefined();
    }

    // The warm-cache exemption was exercised on every poll.
    expect(hasWarmSearchCacheEntry).toHaveBeenCalled();
    harness.close();
  });

  it("21 distinct cold queries from the same browser still 429 on the 21st", async () => {
    // The warm-cache exemption must not weaken genuine abuse protection: a
    // browser issuing 21 DISTINCT cold queries (no warm cache entry) still
    // exhausts its per-browser public-search budget and 429s on the 21st.
    const harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0012_rate_limit_events.sql");
    const env = { DB: harness.db };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const coldResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(coldResult);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(false);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: coldResult,
      selectedAd: null,
      selectionEnrichmentPending: false,
      landingPageCaptureFailure: null,
    });

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
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch: vi.fn(),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const anonCookie = "f9_anon_search=22222222-2222-4222-8222-222222222222";
    const request = (query: string) =>
      new Request(`http://localhost/search?website=${encodeURIComponent(query)}`, {
        headers: { cookie: anonCookie, "cf-connecting-ip": "203.0.113.78" },
      });

    // 20 distinct cold queries pass.
    for (let index = 0; index < 20; index += 1) {
      const result = await unwrapLoaderResult(loader, {
        context: createContext(env),
        request: request(`https://brand-${index}.com`),
      } as never);
      expect(result).toBeDefined();
    }

    // The 21st distinct cold query from the same browser 429s.
    await expect(
      unwrapLoaderResult(loader, {
        context: createContext(env),
        request: request("https://brand-21.com"),
      } as never),
    ).rejects.toMatchObject({ status: 429 });
    harness.close();
  });

  it("does not commit the visitor geo country into an anonymous search", async () => {
    // Regression: a visitor in Germany who never picked a country must get
    // the global ("all countries") search. Geo-defaulting `country` into the
    // anonymous search silently scoped results to a market nobody chose and
    // baked `country=Germany` into the result links.
    const env = { DB: {} };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const sourceResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: null,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

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
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa", {
        headers: { "cf-ipcountry": "DE" },
      }),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        filters: expect.objectContaining({
          query: "nykaa",
          country: "all",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(result).toMatchObject({
      session: null,
      filters: expect.objectContaining({ country: "all" }),
    });
  });

  it("keeps an explicitly chosen country on an anonymous search", async () => {
    // Picking a country in the refine picker is a deliberate narrowing and
    // must still scope the anonymous search — only the implicit geo default
    // is withheld.
    const env = { DB: {} };
    const sourceResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: null,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
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
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&country=Germany", {
        headers: { "cf-ipcountry": "DE" },
      }),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        filters: expect.objectContaining({
          query: "nykaa",
          country: "Germany",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(result).toMatchObject({
      filters: expect.objectContaining({ country: "Germany" }),
    });
  });

  it("keeps the visitor-geo country default for signed-in searches without an explicit country", async () => {
    // Signed-in visitors keep the geo preselection (refine picker and
    // onboarding use it); only anonymous searches must not silently commit it.
    const env = { DB: {} };
    const sourceResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: null,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa", {
        headers: { "cf-ipcountry": "DE" },
      }),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        filters: expect.objectContaining({
          query: "nykaa",
          country: "Germany",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(result).toMatchObject({
      filters: expect.objectContaining({ country: "Germany" }),
    });
  });

  it("runs read-only live discovery for a logged-out visitor via the q= shared-link alias", async () => {
    const env = { DB: {} };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const hydratedResult = {
      ...sourceResult,
      cacheStatus: "miss",
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: hydratedResult,
      selectedAd: baseAd,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

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
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?q=nykaa"),
    } as never);

    expect(listCollections).not.toHaveBeenCalled();
    expect(enforcePublicSearchRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      undefined,
      expect.any(String),
    );
    // The q= alias must run the same advertiser query as the canonical
    // query= deep link — the shared link actually executes, never idles.
    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({
          query: "nykaa",
          country: "all",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        ads: [
          expect.objectContaining({
            domainMatch: expect.objectContaining({
              level: "unverified_provider_candidate",
            }),
          }),
        ],
        searchIntent: "text",
        verifiedCount: 0,
        likelyCount: 0,
        unmatchedCount: 1,
      }),
      null,
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );
    expect(result).toMatchObject({
      session: null,
      filters: expect.objectContaining({ query: "nykaa" }),
      result: hydratedResult,
      selectedAd: baseAd,
    });
  });

  it("stays on the idle page when a q= link carries no searchable term", async () => {
    const env = { DB: {} };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

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
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?q="),
    } as never);

    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      inputError: null,
      filters: expect.objectContaining({ query: "" }),
      result: {
        ads: [],
        discoveryStatus: "disabled",
      },
    });
  });

  it("infers the ad search from a valid website when the query is blank", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: baseAd,
    });

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?website=https://www.samplebrand.com"),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({
          query: "samplebrand.com",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(result).toMatchObject({
      inputError: null,
      competitorWebsite: {
        normalizedUrl: "https://samplebrand.com",
        searchTerm: "samplebrand.com",
      },
    });
  });

  it("shows an incomplete-website error instead of silently searching", async () => {
    const env = { DB: {} };
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?website=samplebrand&query=samplebrand"),
    } as never);

    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      inputError: "That website looks incomplete. Add the full domain, like brand.com.",
      result: {
        discoveryStatus: "disabled",
      },
    });
  });

  it("runs live discovery after a signed-in user submits a query", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const hydratedResult = {
      ...sourceResult,
      cacheStatus: "miss",
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: hydratedResult,
      selectedAd: null,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({
          query: "nykaa",
          country: "all",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(enforcePublicSearchRateLimit).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(
      env,
      sourceResult,
      null,
      { enrichSelected: true, hydratePersisted: true },
    );
    expect(result.result).toBe(hydratedResult);
  });

  it("charges the search-selection bucket instead of the search limit for a warm-cache selection", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: baseAd,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforceAuthenticatedSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforceSearchSelectionRateLimit = vi.fn().mockResolvedValue(null);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(true);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit,
      enforceSearchSelectionRateLimit,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&selected=meta-boat-1"),
    } as never);

    expect(hasWarmSearchCacheEntry).toHaveBeenCalledTimes(1);
    expect(hasWarmSearchCacheEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        env,
        cursor: null,
        customerMetaAdLibraryToken: null,
        parsed: expect.objectContaining({
          filters: expect.objectContaining({ query: "nykaa" }),
        }),
      }),
    );
    expect(enforceAuthenticatedSearchRateLimit).not.toHaveBeenCalled();
    expect(enforcePublicSearchRateLimit).not.toHaveBeenCalled();
    expect(enforceSearchSelectionRateLimit).toHaveBeenCalledTimes(1);
    expect(enforceSearchSelectionRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      "user-1",
      undefined,
    );
    expect(searchAdsViaSourceResolver).toHaveBeenCalledTimes(1);
    expect(result.selectedAd).toBe(baseAd);
  });

  it("refuses a warm-cache selection once the search-selection bucket is exhausted", async () => {
    const env = { DB: {} };
    const rateLimitedResponse = new Response("Too many requests", { status: 429 });
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();
    const enforceAuthenticatedSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforceSearchSelectionRateLimit = vi.fn().mockResolvedValue(rateLimitedResponse);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit,
      enforceSearchSelectionRateLimit,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(true),
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    await expect(
      loader({
        context: createContext(env),
        request: new Request("http://localhost/search?query=nykaa&selected=meta-boat-1"),
      } as never),
    ).rejects.toBe(rateLimitedResponse);

    expect(enforceSearchSelectionRateLimit).toHaveBeenCalledTimes(1);
    expect(enforceAuthenticatedSearchRateLimit).not.toHaveBeenCalled();
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
  });

  it("still charges the account search limit when selecting with a cold cache", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const enforceAuthenticatedSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforceSearchSelectionRateLimit = vi.fn().mockResolvedValue(null);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(false);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit,
      enforceSearchSelectionRateLimit,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: baseAd,
      }),
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&selected=meta-boat-1"),
    } as never);

    expect(hasWarmSearchCacheEntry).toHaveBeenCalledTimes(1);
    expect(enforceSearchSelectionRateLimit).not.toHaveBeenCalled();
    expect(enforceAuthenticatedSearchRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      "user-1",
      undefined,
      // Plan lookup fails open to "starter" here: this harness env has no real
      // D1, and a transient lookup blip must never impose free limits.
      "starter",
    );
  });

  it("skips the daily live-search budget when the discovery cache is warm (FIX-10)", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const enforceAuthenticatedSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforceSearchSelectionRateLimit = vi.fn().mockResolvedValue(null);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(true);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit,
      enforceSearchSelectionRateLimit,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn().mockResolvedValue({
        result: sourceResult,
        searchScope: "exact",
        displayDomain: null,
        relevanceApplied: false,
      }),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: null,
      }),
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never);

    expect(hasWarmSearchCacheEntry).toHaveBeenCalledTimes(1);
    expect(enforceSearchSelectionRateLimit).not.toHaveBeenCalled();
    expect(enforceAuthenticatedSearchRateLimit).not.toHaveBeenCalled();
  });

  it("charges the daily live-search budget on a cold signed-in search", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const enforceAuthenticatedSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforceSearchSelectionRateLimit = vi.fn().mockResolvedValue(null);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(false);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit,
      enforceSearchSelectionRateLimit,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn().mockResolvedValue({
        result: sourceResult,
        searchScope: "exact",
        displayDomain: null,
        relevanceApplied: false,
      }),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: null,
      }),
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never);

    expect(hasWarmSearchCacheEntry).toHaveBeenCalledTimes(1);
    expect(enforceSearchSelectionRateLimit).not.toHaveBeenCalled();
    expect(enforceAuthenticatedSearchRateLimit).toHaveBeenCalledTimes(1);
  });

  it("does not charge the public search limit when an anonymous selection is served from cache", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforcePublicSearchSelectionRateLimit = vi.fn().mockResolvedValue(null);
    const enforceSearchSelectionRateLimit = vi.fn().mockResolvedValue(null);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(true);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: baseAd,
    });

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
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
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforcePublicSearchSelectionRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&selected=meta-boat-1"),
    } as never);

    expect(hasWarmSearchCacheEntry).toHaveBeenCalledTimes(1);
    expect(enforcePublicSearchSelectionRateLimit).toHaveBeenCalledTimes(1);
    expect(enforcePublicSearchSelectionRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      undefined,
    );
    expect(enforcePublicSearchRateLimit).not.toHaveBeenCalled();
    expect(enforceSearchSelectionRateLimit).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(
      env,
      sourceResult,
      "meta-boat-1",
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );
  });

  it("stops anonymous cached selections with a labeled 429 that keeps Retry-After", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const rateLimitedResponse = new Response(
      JSON.stringify({
        error: "rate_limited",
        message: "Too many requests. Please try again shortly.",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "600",
        },
      },
    );
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);
    const enforcePublicSearchSelectionRateLimit = vi.fn().mockResolvedValue(rateLimitedResponse);
    const enforceSearchSelectionRateLimit = vi.fn().mockResolvedValue(null);
    const hasWarmSearchCacheEntry = vi.fn().mockResolvedValue(true);
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
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
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforcePublicSearchSelectionRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit,
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance: vi.fn(),
      hasWarmSearchCacheEntry,
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const blocked = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&selected=meta-boat-1"),
    } as never).catch((error: unknown) => error);

    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(429);
    expect((blocked as Response).headers.get("retry-after")).toBe("600");
    await expect((blocked as Response).json()).resolves.toMatchObject({
      error: "rate_limited",
      message: PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE,
    });
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
  });

  it("stops anonymous public searches with a labeled 429 that keeps Retry-After and shows a truthful recovery message", async () => {
    const env = { DB: {} };
    // Deterministically drive the public limiter: a blocked anonymous search
    // must surface as an explicit in-product 429 document — never a generic
    // "Request failed" page — preserving the limiter's Retry-After signal.
    const rateLimitedResponse = new Response(
      JSON.stringify({
        error: "rate_limited",
        message: "Too many requests. Please try again shortly.",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "600",
        },
      },
    );
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(rateLimitedResponse);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
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
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const blocked = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never).catch((error: unknown) => error);

    // Status and the limiter's recovery signal survive onto the document.
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(429);
    expect((blocked as Response).headers.get("retry-after")).toBe("600");

    // Labeled visible state: the thrown body names the limit and the recovery
    // path (this is what the 429 error surface renders verbatim), instead of
    // the bare "Too many requests" limiter text or the generic fallthrough.
    await expect((blocked as Response).json()).resolves.toMatchObject({
      error: "rate_limited",
      message: PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
    });

    // The 429 mapping renders a labeled rate-limit surface, never the generic
    // "Request failed" catch-all that shipped with the original defect.
    const mapped = mapCustomerRouteError(blocked);
    expect(mapped.title).toBe("Too many searches");
    expect(mapped.message).toBe(PUBLIC_SEARCH_RATE_LIMIT_MESSAGE);
    expect(mapped.retryable).toBe(true);

    expect(enforcePublicSearchRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      undefined,
      expect.any(String),
    );
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
  });

  it("puts a free-account continue path on the anonymous 429 and sets the browser cookie when it was missing", async () => {
    const env = { DB: {} };
    const rateLimitedResponse = new Response(
      JSON.stringify({ error: "rate_limited" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "600",
        },
      },
    );
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({ listCollections: vi.fn() }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(rateLimitedResponse),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn(),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn(),
    }));

    const { loader } = await import("~/routes/search");
    const blocked = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never).catch((error: unknown) => error);

    expect(blocked).toBeInstanceOf(Response);
    const response = blocked as Response;
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: "rate_limited",
      continuePath: "/auth/signup?redirectTo=%2Fsearch%3Fquery%3Dnykaa",
    });
    expect(response.headers.get("Set-Cookie") ?? "").toMatch(/f9_anon_search=/);
  });

  it("reuses an existing anonymous /search cookie instead of minting a new id", async () => {
    const env = { DB: {} };
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);
    const sourceResult = {
      ads: [baseAd],
      searchIntent: "text" as const,
      verifiedCount: 0,
      likelyCount: 0,
      unmatchedCount: 1,
    };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({ listCollections: vi.fn() }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: baseAd,
      }),
    }));

    const existingId = "11111111-1111-4111-8111-111111111111";
    const { loader } = await import("~/routes/search");
    const out = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa", {
        headers: { cookie: `f9_anon_search=${existingId}` },
      }),
    } as never);

    expect(enforcePublicSearchRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      undefined,
      existingId,
    );
    // Existing cookie: no new Set-Cookie on the success payload.
    expect(out instanceof Response).toBe(false);
  });

  it("mints f9_anon_search on a fresh anonymous success via data(), not a JSON Response", async () => {
    const env = { DB: {} };
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);
    const sourceResult = {
      ads: [baseAd],
      searchIntent: "text" as const,
      verifiedCount: 0,
      likelyCount: 0,
      unmatchedCount: 1,
    };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({ listCollections: vi.fn() }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: baseAd,
      }),
    }));

    const { loader } = await import("~/routes/search");
    const out = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never);

    expect(out instanceof Response).toBe(false);
    expect((out as { type?: string }).type).toBe("DataWithResponseInit");
    const setCookie = new Headers(
      (out as { init?: ResponseInit | null }).init?.headers,
    ).get("Set-Cookie");
    expect(setCookie ?? "").toMatch(/f9_anon_search=/);
    expect((out as { data: { session: unknown; inputError: unknown } }).data).toMatchObject({
      inputError: null,
      session: null,
    });
  });

  it("marks the anonymous search cookie Secure", async () => {
    // Issue #2474: f9_anon_search carries the per-browser public-search budget
    // key. Without `Secure` a browser sends it on any plaintext http://0509.io
    // request (pre-HSTS or a client with no HSTS cache), where an on-path
    // observer can read or replay it and burn that browser's 20-per-10min
    // budget. Production only ever sets it on HTTPS, and browsers allow
    // `Secure` on localhost, so the attribute costs nothing.
    const env = { DB: {} };
    const sourceResult = {
      ads: [baseAd],
      searchIntent: "text" as const,
      verifiedCount: 0,
      likelyCount: 0,
      unmatchedCount: 1,
    };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({ listCollections: vi.fn() }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: sourceResult,
        selectedAd: baseAd,
      }),
    }));

    const { loader } = await import("~/routes/search");
    const out = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa"),
    } as never);

    expect(out instanceof Response).toBe(false);
    const setCookie = new Headers(
      (out as { init?: ResponseInit | null }).init?.headers,
    ).get("Set-Cookie");
    expect(setCookie ?? "").toMatch(/f9_anon_search=/);
    expect(setCookie ?? "").toMatch(/\bSecure\b/);
  });

  it("forwards the limiter's Retry-After onto the 429 document response", async () => {
    // React Router only carries cookies from a thrown loader response onto
    // the final document unless the boundary route re-exports the header;
    // this is the exact signal the original defect dropped on the wire.
    const { headers } = await import("~/routes/search");
    expect(
      headers({
        errorHeaders: new Headers({ "retry-after": "600" }),
      } as never),
    ).toEqual({ "Retry-After": "600" });
    expect(
      headers({
        errorHeaders: new Headers({
          "retry-after": "600",
          "set-cookie": "f9_anon_search=11111111-1111-4111-8111-111111111111; Path=/",
        }),
      } as never),
    ).toMatchObject({
      "Retry-After": "600",
      "Set-Cookie": expect.stringContaining("f9_anon_search="),
    });
    // A JSON Content-Type on loaderHeaders must never be copied onto the HTML
    // document. Set-Cookie may be. data() does not set Content-Type; this keeps
    // the document filter honest if a JSON Response ever returns on this path.
    expect(
      headers({
        loaderHeaders: new Headers({
          "content-type": "application/json; charset=utf-8",
          "set-cookie": "f9_anon_search=11111111-1111-4111-8111-111111111111; Path=/",
        }),
      } as never),
    ).toEqual({
      "Set-Cookie": "f9_anon_search=11111111-1111-4111-8111-111111111111; Path=/",
    });
    // No error headers → no header surgery on ordinary documents.
    expect(headers({} as never)).toEqual({});
  });

  it("renders rate-limit error state with exact retry time, preserved query, and disabled Try again button until the window clears", async () => {
    // Issue #1344: the anonymous /search 429 state must not be a dead end.
    // It should show the exact retry time, preserve q/country in the HTML,
    // and keep the Try again button disabled until the rate-limit window clears.

    const mockError = {
      data: {
        error: "rate_limited",
        message: PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
        retryAfter: 600,
      },
      status: 429,
      statusText: "Too Many Requests",
    };

    const React = await import("react");
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      return {
        ...actual,
        useLocation: () => ({
          pathname: "/search",
          search: "?q=nykaa&country=all",
        }),
        Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      };
    });
    vi.doMock("~/components/dashboard-shell", () => ({
      DashboardShell: ({ children }: { children: React.ReactNode }) =>
        React.createElement("main", null, children),
    }));

    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { PublicSearchRateLimitError } = await import(
      "~/components/public-route-state"
    );

    const html = renderToStaticMarkup(
      createElement(PublicSearchRateLimitError, { error: mockError }),
    );

    // Policy copy and exact retry time are present
    expect(html).toMatch(/20 searches per 10 minutes/i);
    expect(html).toMatch(/Try again at/i);
    expect(html).toMatch(/\d{2}:\d{2} remaining/);

    // The Try again button is disabled while the countdown runs
    expect(html).toMatch(/Try again in \d{2}:\d{2}/i);
    expect(html).toMatch(/disabled/);

    // Original q and country are preserved in the rendered HTML
    expect(html).toMatch(/name="q"[^>]*value="nykaa"/);
    expect(html).toMatch(/name="country"[^>]*value="all"/);
    expect(html).toMatch(/data-f9-search-query="nykaa"/);
    expect(html).toMatch(/data-f9-search-country="all"/);

    // A sign-in path that returns to the original search is provided
    expect(html).toMatch(/auth\/login\?redirectTo=/);
    // First-time evaluators get a free-account continue path that does not
    // require a pre-existing account before any first value.
    expect(html).toMatch(/Continue in a signed-in account \(free\)/);
    expect(html).toMatch(/auth\/signup\?redirectTo=/);
    expect(html).toMatch(/data-testid="rate-limit-continue"/);

    vi.doUnmock("react-router");
    vi.doUnmock("~/components/dashboard-shell");
  });

  it("does not spend live discovery on anonymous HEAD searches", async () => {
    const env = { DB: {} };
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
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
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa", {
        method: "HEAD",
      }),
    } as never);

    expect(enforcePublicSearchRateLimit).not.toHaveBeenCalled();
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      session: null,
      result: {
        ads: [],
        discoveryStatus: "disabled",
      },
    });
  });

  it("turns a competitor website into an advertiser search", async () => {
    const env = { DB: {} };
    const sourceResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: null,
    });
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(appSession),
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
      listCollections: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/lib/customer-meta.server", () => ({
      getCustomerMetaAdLibraryToken: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?website=https://www.nykaa.com"),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({
          query: "nykaa.com",
          country: "all",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(enforcePublicSearchRateLimit).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(
      env,
      sourceResult,
      null,
      { enrichSelected: true, hydratePersisted: true },
    );
    expect(result).toMatchObject({
      filters: expect.objectContaining({
        query: "nykaa.com",
      }),
      competitorWebsite: {
        raw: "https://www.nykaa.com",
        normalizedUrl: "https://nykaa.com",
        host: "nykaa.com",
        displayName: "Nykaa",
        searchTerm: "nykaa.com",
      },
    });
  });

  it("runs domain relevance in shadow mode while preserving the legacy response", async () => {
    const env = { DB: {}, SEARCH_ROLLOUT_MODE: "shadow" };
    const legacyResult: SearchResponse = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const executeSearchWithRelevance = vi.fn().mockResolvedValue({
      result: legacyResult,
      query: { mode: "advertiser", filters: { query: "nykaa" } },
      searchScope: "exact",
      displayDomain: "nykaa.com",
      relevanceApplied: false,
    });
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: legacyResult,
      selectedAd: baseAd,
    });

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
    }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/search-execution.server", () => ({
      executeSearchWithRelevance,
      hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(false),
      attachKeywordSearchDomainMatch,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { formatResultsPanelTitle, loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?website=https://www.nykaa.com"),
    } as never);

    expect(executeSearchWithRelevance).toHaveBeenCalledWith(
      expect.objectContaining({
        env,
        scope: "exact",
        hydratePersisted: false,
        competitorWebsite: expect.objectContaining({ host: "nykaa.com" }),
      }),
    );
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(
      env,
      legacyResult,
      null,
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );
    // The success branch now returns data(...) (issue #1972 phase 1) so it can
    // Set-Cookie the anonymous /search id without a JSON Response.
    expect(result.result).toEqual(legacyResult);
    expect(result.relevanceApplied).toBe(false);
    expect(formatResultsPanelTitle(legacyResult, {
      displayDomain: "nykaa.com",
      isDomainSearch: true,
      isBroaderScope: false,
      relevanceApplied: false,
    })).toBe("1 ad found");
  });

  it("scopes the results panel title to the searched country", async () => {
    const legacyResult: SearchResponse = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
      verifiedCount: 1,
    };

    const { formatResultsPanelTitle } = await import("~/routes/search");

    // The verdict title names the market that actually ran, so the same
    // competitor cannot read as contradictory across country filters.
    expect(formatResultsPanelTitle(legacyResult, {
      displayDomain: "nykaa.com",
      isDomainSearch: true,
      isBroaderScope: false,
      relevanceApplied: false,
      country: "India",
    })).toBe("1 ad found in India");
    expect(formatResultsPanelTitle(legacyResult, {
      displayDomain: "nykaa.com",
      isDomainSearch: true,
      isBroaderScope: false,
      relevanceApplied: false,
      country: "all",
    })).toBe("1 ad found");
    expect(formatResultsPanelTitle(legacyResult, {
      displayDomain: "nykaa.com",
      isDomainSearch: true,
      isBroaderScope: false,
      relevanceApplied: true,
      country: "India",
    })).toBe("1 verified ad linked to nykaa.com in India");
  });

  it("canonicalizes ISO-2 and alias country inputs in the results panel title", async () => {
    // The resolver already accepts ISO-2 codes and aliases (usa, uk, uae),
    // so the customer-facing phrase must match the market the search
    // actually ran in, not the raw URL input.
    const legacyResult: SearchResponse = {
      ads: [baseAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };

    const { formatResultsPanelTitle } = await import("~/routes/search");

    expect(formatResultsPanelTitle(legacyResult, {
      displayDomain: "nykaa.com",
      isDomainSearch: true,
      isBroaderScope: false,
      relevanceApplied: false,
      country: "IN",
    })).toBe("1 ad found in India");
    expect(formatResultsPanelTitle(legacyResult, {
      displayDomain: "nykaa.com",
      isDomainSearch: true,
      isBroaderScope: false,
      relevanceApplied: false,
      country: "usa",
    })).toBe("1 ad found in United States");
  });

  it("keeps demo results panel titles unscoped even when a country filter is set", async () => {
    // Demo/sample matches deliberately ignore the country filter (the
    // resolver matches every demo ad against every market), so labelling
    // a demo verdict "in United States" for India-authored samples would
    // falsely imply country-specific evidence.
    const demoResult: SearchResponse = {
      ads: [baseAd],
      nextCursor: null,
      source: "demo",
      provider: "demo",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
      verifiedCount: 1,
    };

    const { formatResultsPanelTitle } = await import("~/routes/search");

    expect(formatResultsPanelTitle(demoResult, {
      displayDomain: "nykaa.com",
      isDomainSearch: true,
      isBroaderScope: false,
      relevanceApplied: true,
      country: "United States",
    })).toBe("1 verified ad linked to nykaa.com");
  });

  it("allows only tokened canary probes to force fresh live discovery", async () => {
    const env = { DB: {}, CANARY_BYPASS_TOKEN: "secret-token" };
    const sourceResult = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
    };
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue(sourceResult);
    const prepareSearchResultSelection = vi.fn().mockResolvedValue({
      result: sourceResult,
      selectedAd: null,
    });
    const listCollections = vi.fn();
    const enforcePublicSearchRateLimit = vi.fn().mockResolvedValue(null);

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
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
      enforcePublicSearchRateLimit,
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver,
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection,
    }));

    const { loader } = await import("~/routes/search");
    await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&fresh=live"),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        filters: expect.objectContaining({
          query: "nykaa",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    expect(enforcePublicSearchRateLimit).toHaveBeenCalledTimes(1);
    searchAdsViaSourceResolver.mockClear();
    prepareSearchResultSelection.mockClear();

    await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&fresh=live", {
        headers: {
          "x-0509-canary-token": "wrong-token",
        },
      }),
    } as never);

    expect(enforcePublicSearchRateLimit).toHaveBeenCalledTimes(2);
    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        filters: expect.objectContaining({
          query: "nykaa",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: false, executionContext: null },
    );
    searchAdsViaSourceResolver.mockClear();
    prepareSearchResultSelection.mockClear();

    await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?query=nykaa&fresh=live", {
        headers: {
          "x-0509-canary-token": "secret-token",
        },
      }),
    } as never);

    expect(listCollections).not.toHaveBeenCalled();
    expect(enforcePublicSearchRateLimit).toHaveBeenCalledTimes(2);
    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        filters: expect.objectContaining({
          query: "nykaa",
        }),
      }),
      null,
      { purpose: "public_search", forceLive: true, executionContext: null },
    );
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(
      env,
      sourceResult,
      null,
      { enrichSelected: true, hydratePersisted: false, allowRenderedFallback: false },
    );
  });
});

describe("search actions", () => {
  it.each(["save-query", "create-watchlist"])(
    "refuses to %s when the query is blank",
    async (intent) => {
      const env = { DB: {} };
      const checkPlanLimit = vi.fn();
      const createSavedQuery = vi.fn();
      const createWatchlist = vi.fn();

      vi.doMock("~/lib/auth.server", () => mockWorkspaceAuth());
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
      vi.doMock("~/lib/plan.server", () => ({
        getUserPlan: vi.fn().mockResolvedValue("starter"),
        checkPlanLimit,
      }));
      vi.doMock("~/lib/data.server", () => ({
        addAdToCollection: vi.fn(),
        createSavedQuery,
        createWatchlist,
      }));

      const { action } = await import("~/routes/search");
      const formData = new FormData();
      formData.set("intent", intent);
      formData.set("mode", "advertiser");
      formData.set("query", "");
      formData.set("country", "India");
      formData.set("platform", "all");
      formData.set("creativeType", "all");
      formData.set("status", "all");
      formData.set("name", "Blank query");

      const result = await action({
        context: createContext(env),
        request: new Request("http://localhost/search", {
          method: "POST",
          body: formData,
        }),
      } as never);

      expect(result).toEqual({
        ok: false,
        message: "Enter a competitor website before saving or tracking it.",
      });
      expect(checkPlanLimit).not.toHaveBeenCalled();
      expect(createSavedQuery).not.toHaveBeenCalled();
      expect(createWatchlist).not.toHaveBeenCalled();
    },
  );

  it("creates a competitor watchlist from a website and redirects to tracking", async () => {
    const env = { DB: {} };
    const checkPlanLimit = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 10,
      current: 0,
    });
    const createSavedQuery = vi.fn();
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: {
        id: "watch-1",
      },
      current: 1,
      limit: 10,
    });
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/auth.server", () => mockWorkspaceAuth());
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
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit,
    }));
    vi.doMock("~/lib/data.server", () => ({
      addAdToCollection: vi.fn(),
      completeUserOnboarding,
      createSavedQuery,
      createWatchlistWithinLimit,
    }));
    vi.doMock("~/lib/first-watchlist-scan.server", () => ({
      queueFirstWatchlistScan: vi.fn().mockResolvedValue(true),
    }));

    const { action } = await import("~/routes/search");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("mode", "advertiser");
    formData.set("query", "");
    formData.set("competitorWebsite", "https://www.nykaa.com");
    formData.set("country", "India");
    formData.set("platform", "all");
    formData.set("creativeType", "all");
    formData.set("status", "all");

    let response: Response | null = null;
    try {
      await action({
        context: createContext(env),
        request: new Request("http://localhost/search", {
          method: "POST",
          body: formData,
        }),
      } as never);
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/app/watchlists?watchlist=watch-1");
    expect(checkPlanLimit).toHaveBeenCalledWith(env, "user-1", "watchlists");
    expect(createSavedQuery).not.toHaveBeenCalled();
    expect(completeUserOnboarding).toHaveBeenCalledWith(env, "user-1");
      expect(createWatchlistWithinLimit).toHaveBeenCalledWith(
        env,
        "user-1",
        expect.objectContaining({
          name: "Nykaa watch",
          targetType: "advertiser",
          targetId: "https://nykaa.com",
          targetLabel: "Nykaa",
          trackingRole: "competitor",
        }),
        10,
      );
    });

  it("refuses to track an incomplete website", async () => {
    const env = { DB: {} };
    const checkPlanLimit = vi.fn();
    const createSavedQuery = vi.fn();
    const createWatchlist = vi.fn();

    vi.doMock("~/lib/auth.server", () => mockWorkspaceAuth(appSession));
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
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit,
    }));
    vi.doMock("~/lib/data.server", () => ({
      addAdToCollection: vi.fn(),
      createSavedQuery,
      createWatchlist,
    }));

    const { action } = await import("~/routes/search");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("mode", "advertiser");
    formData.set("query", "samplebrand");
    formData.set("competitorWebsite", "samplebrand");
    formData.set("country", "India");
    formData.set("platform", "all");
    formData.set("creativeType", "all");
    formData.set("status", "all");

    const result = await action({
      context: createContext(env),
      request: new Request("http://localhost/search", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      ok: false,
      message: "That website looks incomplete. Add the full domain, like brand.com.",
    });
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(createSavedQuery).not.toHaveBeenCalled();
    expect(createWatchlist).not.toHaveBeenCalled();
  });

  it("creates a self-tracking watchlist from a website", async () => {
    const env = { DB: {} };
    const checkPlanLimit = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 10,
      current: 0,
    });
    const createWatchlistWithinLimit = vi.fn().mockResolvedValue({
      status: "created",
      watchlist: {
        id: "watch-self",
      },
      current: 1,
      limit: 10,
    });
    const completeUserOnboarding = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/auth.server", () => mockWorkspaceAuth(appSession));
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
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      checkPlanLimit,
    }));
    vi.doMock("~/lib/data.server", () => ({
      addAdToCollection: vi.fn(),
      completeUserOnboarding,
      createSavedQuery: vi.fn(),
      createWatchlistWithinLimit,
    }));
    vi.doMock("~/lib/first-watchlist-scan.server", () => ({
      queueFirstWatchlistScan: vi.fn().mockResolvedValue(true),
    }));

    const { action } = await import("~/routes/search");
    const formData = new FormData();
    formData.set("intent", "create-watchlist");
    formData.set("trackingRole", "self");
    formData.set("mode", "advertiser");
    formData.set("query", "");
    formData.set("competitorWebsite", "samplebrand.com");
    formData.set("country", "India");
    formData.set("platform", "all");
    formData.set("creativeType", "all");
    formData.set("status", "all");

    let response: Response | null = null;
    try {
      await action({
        context: createContext(env),
        request: new Request("http://localhost/search", {
          method: "POST",
          body: formData,
        }),
      } as never);
    } catch (error) {
      response = error as Response;
    }

    expect(response?.headers.get("Location")).toBe("/app/watchlists?watchlist=watch-self");
    expect(createWatchlistWithinLimit).toHaveBeenCalledWith(
      env,
      "user-1",
      expect.objectContaining({
        name: "Samplebrand watch",
        targetId: "https://samplebrand.com",
        targetLabel: "Samplebrand",
        trackingRole: "self",
      }),
      10,
    );
  });
});

describe("search loader OCR reuse", () => {
  it("reuses persisted creative text before re-running capture", async () => {
    const env = { META_AD_LIBRARY_TOKEN: "token", DB: {} };
    const hydratedAd: AdRecord = {
      ...baseAd,
      creativeText: "60 Hours Playback\nOnly ₹999",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: {
        source: "stored",
      },
    };
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });
    const hydrateAdsWithPersistedCreatives = vi.fn().mockResolvedValue([hydratedAd]);

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives,
      listAdsByIds: vi.fn().mockResolvedValue([hydratedAd]),
      upsertAd: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      env as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(hydrateAdsWithPersistedCreatives).toHaveBeenCalledWith(env, [baseAd]);
    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(result.selectedAd?.creativeText).toBe("60 Hours Playback\nOnly ₹999");
    expect(result.selectedAd?.creativeTextMetadata).toEqual({
      source: "stored",
    });
  });

  it("translates stored non-English creative text into a translated analysis field", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      translated_text: "60 Hours Playback\nOnly Rs 999",
    });
    const env = {
      META_AD_LIBRARY_TOKEN: "token",
      DB: {},
      AI: {
        run: aiRun,
      },
    };
    const hydratedAd: AdRecord = {
      ...baseAd,
      creativeText: "60 Hours Playback\nSirf ₹999",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: {
        source: "stored",
      },
    };
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });
    const hydrateAdsWithPersistedCreatives = vi.fn().mockResolvedValue([hydratedAd]);
    const upsertAd = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/analysis.server", () => ({
      withStructuredAnalysis: vi.fn((ad: AdRecord) => ad),
    }));
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives,
      listAdsByIds: vi.fn().mockResolvedValue([hydratedAd]),
      upsertAd,
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    const result = await prepareSearchResultSelection(
      env as never,
      {
        ads: [baseAd],
        nextCursor: null,
        source: "meta",
      },
      "meta-boat-1",
    );

    expect(captureCreativeText).not.toHaveBeenCalled();
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(result.selectedAd?.analysisFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: "translated_text",
          fieldValue: "60 Hours Playback\nOnly Rs 999",
          provenanceSource: "ai_summary",
        }),
      ]),
    );
    expect(upsertAd).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        metaAdId: "meta-boat-1",
        analysisFields: expect.arrayContaining([
          expect.objectContaining({
            fieldKey: "translated_text",
            fieldValue: "60 Hours Playback\nOnly Rs 999",
          }),
        ]),
      }),
    );
  });
});

describe("search status copy", () => {
  it("labels missing analysis honestly and flags approximate browser format filters", async () => {
    const {
      formatAdActiveStatus,
      formatCreativeFormatLabel,
      formatHookLabel,
      formatOfferLabel,
      shouldShowApproximateFormatNotice,
    } = await import("~/routes/search");

    expect(formatHookLabel("")).toBe("Hook not detected.");
    expect(formatOfferLabel("")).toBe("No explicit offer detected.");
    expect(formatCreativeFormatLabel("unknown")).toBe("Not detected");
    expect(formatAdActiveStatus({ active: true, activeStatusObserved: false })).toBe(
      "Status not detected",
    );
    expect(formatAdActiveStatus({ active: true })).toBe("Active");
    expect(
      shouldShowApproximateFormatNotice(
        { creativeType: "carousel" },
        {
          source: "meta_library_browser",
          provider: "meta_library_browser",
        },
      ),
    ).toBe(true);
  });

  it("preserves broader scope for result selection and pagination links", async () => {
    const { withSearchScope } = await import("~/routes/search");
    const base = new URLSearchParams("website=nykaa.com&query=nykaa");

    const broader = withSearchScope(base, "broader");
    expect(broader.get("broader")).toBe("1");
    broader.set("selected", "related-ad-2");
    broader.set("after", "cursor-2");
    expect(broader.toString()).toContain("broader=1");

    expect(withSearchScope(broader, "exact").has("broader")).toBe(false);
  });

  it("does not claim alternate Meta results when API fallback failed without ads", async () => {
    const { formatDiscoverySummary } = await import("~/routes/search");

    expect(
      formatDiscoverySummary({
        ads: [],
        nextCursor: null,
        source: "meta",
        cacheStatus: "none",
        discoveryStatus: "degraded",
        discoverySummary: "Meta Ad Library API fallback failed while browser capture is unavailable.",
        discoveryFailureClass: "browser_unavailable",
      }),
    ).toBe("Fresh visual checks are delayed and no alternate results are available.");
  });

  it("does not call a successful empty API fallback unavailable", async () => {
    const { formatDiscoverySummary } = await import("~/routes/search");

    expect(
      formatDiscoverySummary({
        ads: [],
        nextCursor: null,
        source: "meta_api",
        provider: "meta_api",
        cacheStatus: "miss",
        discoveryStatus: "healthy",
        discoverySummary: "Browser capture is unavailable right now; showing API fallback results.",
        discoveryFailureClass: null,
      }),
    ).toBe("Fresh visual checks are delayed; alternate Meta checks found no ads.");
  });

  it("renders the first-request cold-path warming summary as an honest in-progress line", async () => {
    const { formatDiscoverySummary } = await import("~/routes/search");

    expect(
      formatDiscoverySummary({
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "miss",
        discoveryStatus: "degraded",
        discoveryProgress: "warming",
        discoverySummary:
          "Commercial discovery is warming this query. Results should appear shortly.",
        discoveryFailureClass: null,
      }),
    ).toBe("We are checking this competitor now. Results should appear shortly.");
  });

  it("defaults the anonymous /search payload to verified-before-Likely (issue #2289)", async () => {
    // The public preview of a proof-first product must lead with rows it
    // has actually verified, not the "Likely" leads it is not sure belong
    // to the competitor. The anonymous default sort is verified_first, so
    // every verified row sorts above every Likely row in the response
    // payload. Counts and labels are unchanged.
    const env = { DB: {} };
    const likelyAd: AdRecord = {
      ...baseAd,
      metaAdId: "likely-active",
      active: true,
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      domainMatch: {
        level: "likely_brand_name",
        reason: "brand name fits",
        matchedDomain: null,
      },
    };
    const verifiedAd: AdRecord = {
      ...baseAd,
      metaAdId: "verified-inactive",
      active: false,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      domainMatch: {
        level: "exact_hostname",
        reason: "landing page links to brand domain",
        matchedDomain: "nykaa.com",
      },
    };
    const sourceResult = {
      // Source returns the Likely row first (active, recent) — the sort
      // must reorder it below the verified row for anonymous sessions.
      ads: [likelyAd, verifiedAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
      discoveryStatus: "healthy",
      discoverySummary: null,
      discoveryFailureClass: null,
      verifiedCount: 1,
      likelyCount: 1,
      unmatchedCount: 0,
    };
    const hydratedResult = { ...sourceResult, cacheStatus: "miss" };
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/workspace.server", () => ({
      resolveWorkspace: vi.fn(async (_env: unknown, id: string) => ({
        workspaceUserId: id,
        isMember: false,
        ownerName: null,
      })),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({ listCollections: vi.fn() }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
      enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue(sourceResult),
    }));
    vi.doMock("~/lib/search-selection.server", () => ({
      prepareSearchResultSelection: vi.fn().mockResolvedValue({
        result: hydratedResult,
        selectedAd: verifiedAd,
      }),
    }));

    const { loader } = await import("~/routes/search");
    const result = await unwrapLoaderResult(loader, {
      context: createContext(env),
      request: new Request("http://localhost/search?q=nykaa&country=all"),
    } as never);

    expect(result.session).toBeNull();
    expect(result.result).toEqual(hydratedResult);
    // The anonymous default sort (verified_first) puts every verified row
    // above every Likely row, even when the Likely row is active and the
    // verified row is inactive. Counts and labels are unchanged.
    const { ANONYMOUS_DEFAULT_SEARCH_RESULT_SORT, sortAdsForSearchDisplay } =
      await import("~/lib/search-sort");
    expect(ANONYMOUS_DEFAULT_SEARCH_RESULT_SORT).toBe("verified_first");
    const sorted = sortAdsForSearchDisplay(
      (result.result as SearchResponse).ads,
      ANONYMOUS_DEFAULT_SEARCH_RESULT_SORT,
    );
    expect(sorted.map((item) => item.metaAdId)).toEqual([
      "verified-inactive",
      "likely-active",
    ]);
    // Counts and labels are unchanged by the sort.
    expect((result.result as SearchResponse).verifiedCount).toBe(1);
    expect((result.result as SearchResponse).likelyCount).toBe(1);
  });
});
