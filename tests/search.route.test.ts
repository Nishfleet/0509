import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

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

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/creative-text.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/landing-pages.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/search-selection.server");
  vi.doUnmock("~/lib/translation.server");
  vi.doUnmock("~/lib/analysis.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search loader", () => {
  it("does not call live discovery before a visitor submits a query", async () => {
    const env = { DB: {} };
    const getOptionalSession = vi.fn().mockResolvedValue(null);
    const listCollections = vi.fn();
    const searchAdsViaSourceResolver = vi.fn();
    const prepareSearchResultSelection = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession,
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
      filters: {
        query: "",
        country: "India",
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

  it("runs live discovery after a visitor submits a query", async () => {
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

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
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
          country: "India",
        }),
      }),
      null,
      { purpose: "public_search", cachePolicy: "default" },
    );
    expect(prepareSearchResultSelection).toHaveBeenCalledWith(env, sourceResult, null);
    expect(result.result).toBe(hydratedResult);
  });

  it("lets the production canary bypass discovery cache with its signed probe shape", async () => {
    const env = { DB: {}, CANARY_BYPASS_TOKEN: "signed-canary-token" };
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

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
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
      request: new Request("http://localhost/search?query=nykaa&fresh=live", {
        headers: {
          "user-agent": "0509-provider-bakeoff/1.0",
          "x-0509-canary-token": "signed-canary-token",
        },
      }),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({
          query: "nykaa",
        }),
      }),
      null,
      { purpose: "public_search", cachePolicy: "bypass" },
    );
  });

  it("keeps spoofed fresh-live public searches on the default cache policy", async () => {
    const env = { DB: {}, CANARY_BYPASS_TOKEN: "signed-canary-token" };
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

    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => env),
    }));
    vi.doMock("~/lib/data.server", () => ({
      listCollections: vi.fn(),
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
      request: new Request("http://localhost/search?query=nykaa&fresh=live", {
        headers: {
          "user-agent": "0509-provider-bakeoff/1.0",
          "x-0509-canary-token": "signed-canary-token-extra",
        },
      }),
    } as never);

    expect(searchAdsViaSourceResolver).toHaveBeenCalledWith(
      env,
      expect.any(Object),
      null,
      { purpose: "public_search", cachePolicy: "default" },
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

      vi.doMock("~/lib/auth.server", () => ({
        requireSession: vi.fn().mockResolvedValue({
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
        }),
      }));
      vi.doMock("~/lib/context.server", () => ({
        getEnv: vi.fn(() => env),
      }));
      vi.doMock("~/lib/plan.server", () => ({
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
        message: "Run a search before saving or tracking it.",
      });
      expect(checkPlanLimit).not.toHaveBeenCalled();
      expect(createSavedQuery).not.toHaveBeenCalled();
      expect(createWatchlist).not.toHaveBeenCalled();
    },
  );
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
