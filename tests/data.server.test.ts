import { describe, expect, it } from "vitest";

import { CREATIVE_TEXT_EXTRACTOR_VERSION } from "~/lib/creative-text.server";
import { createLandingPageSnapshot, upsertAd } from "~/lib/data.server";

function createMockDb() {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];

  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true };
              },
              async all<T>() {
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    },
  };
}

describe("createLandingPageSnapshot", () => {
  it("persists structured landing-page fields and landing-page analysis provenance", async () => {
    const mock = createMockDb();

    await createLandingPageSnapshot(
      { DB: mock.db } as never,
      {
        rawUrl: "https://example.com/glow",
        canonicalUrl: "https://example.com/glow",
        rawHeadline: "Glow Serum Sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "fnv1a-headline",
        ctaText: "Shop now",
        priceText: "Starting at ₹499",
        formPresent: true,
        captureMethod: "landing_page_fetch",
        capturedAt: "2026-03-30T00:00:00.000Z",
        artifactKey: null,
        metadata: {
          fetchStatus: 200,
        },
      },
    );

    const snapshotInsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO landing_page_snapshot"),
    );
    expect(snapshotInsert?.bindings).toContain("Shop now");
    expect(snapshotInsert?.bindings).toContain("Starting at ₹499");
    expect(snapshotInsert?.bindings).toContain(1);

    const analysisInserts = mock.statements.filter((statement) =>
      statement.sql.includes("INSERT INTO analysis_field"),
    );
    expect(analysisInserts.length).toBe(3);
    expect(analysisInserts.every((statement) => statement.bindings.includes("landing_page"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("cta_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("price_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("form_present"))).toBe(true);
    expect(analysisInserts.every((statement) => statement.bindings.includes("lp-signals-v1"))).toBe(true);
  });
});

describe("upsertAd", () => {
  it("persists creative OCR analysis fields when present on the ad", async () => {
    const mock = createMockDb();

    await upsertAd(
      { DB: mock.db } as never,
      {
        metaAdId: "meta-boat-1",
        advertiser: "boAt",
        body: "Bass bhi, battery bhi.",
        previewHeadline: "Bass bhi. Battery bhi.",
        previewSubhead: "Launch pricing",
        hook: "Bass bhi. Battery bhi.",
        offer: "Launch pricing",
        cta: "Buy now",
        format: "video",
        languageLabel: "Hinglish",
        destinationType: "website",
        landingPageUrl: "https://boat.example.com/rockerz-neckband",
        adSnapshotUrl: "https://facebook.example.com/ad-snapshot",
        countries: ["India"],
        platforms: ["Instagram"],
        firstSeenAt: null,
        lastSeenAt: null,
        active: true,
        researchSummary: "Summary",
        source: "demo",
        analysisFields: [],
        creativeText: "60 Hours Playback\nOnly ₹999",
        creativeTextCaptureMethod: "ad_snapshot_fetch",
        creativeTextMetadata: {
          fetchStatus: 200,
        },
      },
    );

    const analysisInserts = mock.statements.filter((statement) =>
      statement.sql.includes("INSERT INTO analysis_field"),
    );
    const adInsert = mock.statements.find((statement) =>
      statement.sql.includes("INSERT INTO ad"),
    );

    expect(adInsert?.sql).toContain("creative_text");
    expect(adInsert?.sql).toContain("creative_text_capture_method");
    expect(adInsert?.sql).toContain("creative_text_metadata_json");
    expect(adInsert?.bindings).toContain("60 Hours Playback\nOnly ₹999");
    expect(adInsert?.bindings).toContain("ad_snapshot_fetch");
    expect(
      adInsert?.bindings.some(
        (binding) =>
          typeof binding === "string" && binding.includes("\"fetchStatus\":200"),
      ),
    ).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("ocr_text"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes("ad_snapshot_fetch"))).toBe(true);
    expect(analysisInserts.some((statement) => statement.bindings.includes(CREATIVE_TEXT_EXTRACTOR_VERSION))).toBe(true);
  });
});
