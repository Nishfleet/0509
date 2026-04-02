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
});
