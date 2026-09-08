import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search selection persisted translation reuse", () => {
  it("reuses persisted translated_text before re-running Workers AI translation", async () => {
    const storedAd: AdRecord = {
      ...baseAd,
      body: "Current canonical body",
      domainMatch: {
        level: "verified_alias",
        reason: "Old workspace query context",
        matchedDomain: "private-query.example",
      },
      creativeText: "60 Hours Playback\nSirf ₹999",
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata: {
        source: "stored",
      },
      analysisFields: [
        {
          scopeType: "ad",
          fieldKey: "translated_text",
          fieldValue: "60 Hours Playback\nOnly Rs 999",
          provenanceSource: "ai_summary",
          extractorVersion: "translated-text-v1",
          confidence: 0.68,
          metadata: {
            provider: "workers_ai",
            model: "@cf/meta/m2m100-1.2b",
            sourceLanguageCode: "hi",
            sourceLanguageLabel: "Hinglish",
            targetLanguageCode: "en",
          },
        },
      ],
    };
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const aiRun = vi.fn().mockResolvedValue({
      translated_text: "Fresh translation should not run",
    });
    const env = {
      META_AD_LIBRARY_TOKEN: "token",
      AI: {
        run: aiRun,
      },
      DB: {
        async batch() {
          return [];
        },
        prepare(sql: string) {
          return {
            bind(...bindings: unknown[]) {
              statements.push({ sql, bindings });

              return {
                async all<T>() {
                  if (sql.includes("FROM ad")) {
                    return {
                      results: [
                        {
                          id: "meta-boat-1",
                          raw_json: JSON.stringify(storedAd),
                        },
                      ] as T[],
                    };
                  }

                  return { results: [] as T[] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      },
    };

    vi.doMock("~/lib/creative-text.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/creative-text.server")>();

      return {
        ...actual,
        captureCreativeText: vi.fn().mockResolvedValue(null),
      };
    });
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

    expect(aiRun).not.toHaveBeenCalled();
    expect(result.selectedAd?.analysisFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: "translated_text",
          fieldValue: "60 Hours Playback\nOnly Rs 999",
        }),
      ]),
    );
    expect(
      statements.some(({ sql, bindings }) =>
        sql.includes("INSERT INTO ad")
        && bindings.includes("Fresh translation should not run"),
      ),
    ).toBe(false);
  });

  it("preserves richer canonical evidence when a later capture fails", async () => {
    const storedAd: AdRecord = {
      ...baseAd,
      body: "Current canonical body",
      domainMatch: {
        level: "verified_alias",
        reason: "Old workspace query context",
        matchedDomain: "private-query.example",
      },
      landingPageUrl: "https://boat-lifestyle.com/sale",
      landingPage: {
        rawUrl: "https://boat-lifestyle.com/sale",
        canonicalUrl: "https://boat-lifestyle.com/sale",
        rawHeadline: "Stored sale",
        normalizedHeadline: "stored sale",
        normalizedHeadlineHash: "stored-hash",
        captureMethod: "browser_render",
        artifactKey: "proof/stored.png",
        ctaText: "Buy now",
        priceText: "₹999",
        formPresent: false,
        capturedAt: "2026-07-01T00:00:00.000Z",
      },
    };
    const hydratedStaleAd: AdRecord = {
      ...baseAd,
      body: "Stale cache body",
      domainMatch: {
        level: "registrable_domain",
        reason: "Landing page matches boat-lifestyle.com",
        matchedDomain: "boat-lifestyle.com",
      },
      landingPageUrl: storedAd.landingPageUrl,
      landingPage: storedAd.landingPage,
    };
    const upsertAd = vi.fn();
    vi.doMock("~/lib/data.server", () => ({
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([hydratedStaleAd]),
      listAdsByIds: vi.fn().mockResolvedValue([storedAd]),
      upsertAd,
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/translation.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/translation.server")>();
      return { ...actual, translateAdText: vi.fn().mockResolvedValue(null) };
    });

    const { prepareSearchResultSelection } = await import("~/lib/search-selection.server");
    await prepareSearchResultSelection(
      { DB: {} } as never,
      {
        ads: [hydratedStaleAd],
        nextCursor: null,
        source: "meta",
        cacheStatus: "stale",
      },
      baseAd.metaAdId,
    );

    const persisted = upsertAd.mock.calls[0]?.[1] as AdRecord;
    expect(persisted).toEqual(expect.objectContaining({
      landingPage: storedAd.landingPage,
      landingPageUrl: storedAd.landingPageUrl,
      body: "Current canonical body",
    }));
    expect(persisted.domainMatch).toBeUndefined();
  });
});
