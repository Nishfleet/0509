import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mapCustomerRouteError,
  PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
  PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE,
} from "~/lib/customer-route-error";
import type { AdRecord, SearchResponse } from "~/lib/types";

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
  it("shows the idle public search page without calling live discovery", async () => {
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
    const result = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search"),
    } as never);

    expect(getOptionalSession).toHaveBeenCalledWith(env, expect.any(Request));
    expect(listCollections).not.toHaveBeenCalled();
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
    const result = await loader({
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
    const result = await loader({
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
    const result = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?q=nike&country=all"),
    } as never);

    expect(listCollections).not.toHaveBeenCalled();
    expect(enforcePublicSearchRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      undefined,
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
    const result = await loader({
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
    const result = await loader({
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
    const result = await loader({
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
    const result = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?q=nykaa"),
    } as never);

    expect(listCollections).not.toHaveBeenCalled();
    expect(enforcePublicSearchRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      undefined,
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
    const result = await loader({
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
    const result = await loader({
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
    const result = await loader({
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
    const result = await loader({
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
    const result = await loader({
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
    );
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
    expect(prepareSearchResultSelection).not.toHaveBeenCalled();
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
    // No error headers → no header surgery on ordinary documents.
    expect(headers({} as never)).toEqual({});
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
    const result = await loader({
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
    const result = await loader({
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
    const result = await loader({
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
    expect(result.result).toBe(legacyResult);
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
    vi.doMock("~/lib/monitoring.server", () => ({
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
    vi.doMock("~/lib/monitoring.server", () => ({
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
});
