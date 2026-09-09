import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLlmsFullBrandBlocks,
  buildLlmsFullText,
  LLMS_FULL_BRAND_LIMIT,
  loadLlmsFullBrandBlocks,
  metaAdLibrarySourceUrl,
  type LlmsFullBrandBlock,
} from "~/lib/llms-full.server";
import type { LandingPageSnapshotRow } from "~/lib/offer-timeline.server";

const queryAll = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryAll,
  queryOne: vi.fn(),
  execute: vi.fn(),
  ensureDb: vi.fn(),
}));

afterEach(() => {
  queryAll.mockReset();
});

/**
 * A proof-complete snapshot row for a brand domain. Mirrors the shape
 * `loadOfferTimeline` reads, with both artifact keys present so the proof
 * gate (issue #1284) keeps it.
 */
function snapshotRow(input: {
  id: string;
  canonicalUrl: string;
  headline: string;
  ctaText?: string | null;
  priceText?: string | null;
  formPresent?: number | null;
  capturedAt: string;
  htmlKey: string;
  screenshotKey: string;
  isAdDestination?: number | null;
}): LandingPageSnapshotRow {
  return {
    id: input.id,
    canonical_url: input.canonicalUrl,
    raw_headline: input.headline,
    cta_text: input.ctaText ?? null,
    price_text: input.priceText ?? null,
    form_present: input.formPresent ?? 1,
    artifact_key: input.htmlKey,
    metadata_json: JSON.stringify({
      screenshotArtifactKey: input.screenshotKey,
      htmlArtifactKey: input.htmlKey,
    }),
    capture_method: "landing_page_fetch",
    captured_at: input.capturedAt,
    is_ad_destination: input.isAdDestination ?? 0,
  };
}

const DAY1 = "2026-09-01";
const DAY2 = "2026-09-07";
const HTML1 = "landing-pages/2026-09-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";
const SHOT1 = "landing-pages/2026-09-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const HTML2 = "landing-pages/2026-09-07/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html";
const SHOT2 = "landing-pages/2026-09-07/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg";

describe("metaAdLibrarySourceUrl", () => {
  it("builds a keyword-unordered Ad Library search URL for the domain", () => {
    const url = metaAdLibrarySourceUrl("nike.com");
    expect(url).toContain("https://www.facebook.com/ads/library/");
    expect(url).toContain("search_type=keyword_unordered");
    expect(url).toContain("q=nike.com");
  });
});

describe("buildLlmsFullBrandBlocks", () => {
  it("groups proof-complete rows into a per-brand ledger with dated states", () => {
    const rows: LandingPageSnapshotRow[] = [
      snapshotRow({
        id: "s1",
        canonicalUrl: "https://nike.com/shop",
        headline: "Air Max",
        ctaText: "Shop now",
        priceText: "$149",
        capturedAt: `${DAY1}T10:00:00.000Z`,
        htmlKey: HTML1,
        screenshotKey: SHOT1,
      }),
      snapshotRow({
        id: "s2",
        canonicalUrl: "https://www.nike.com/shop",
        headline: "Air Max Pro",
        ctaText: "Buy",
        priceText: "$179",
        capturedAt: `${DAY2}T10:00:00.000Z`,
        htmlKey: HTML2,
        screenshotKey: SHOT2,
      }),
    ];

    const blocks = buildLlmsFullBrandBlocks(rows);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.domain).toBe("nike.com");
    expect(block.asOf).toBe(DAY2);
    expect(block.timelineUrl).toBe("https://0509.io/timeline/nike.com");
    expect(block.adLibrarySourceUrl).toContain("q=nike.com");
    expect(block.entries).toHaveLength(2);
    // First dated state has no transition; second carries the headline change.
    expect(block.entries[0]!.transition).toBeNull();
    expect(block.entries[1]!.transition?.headline).toEqual({
      before: "Air Max",
      after: "Air Max Pro",
    });
  });

  it("omits a brand whose only rows are proof-less (issue #1284)", () => {
    const rows: LandingPageSnapshotRow[] = [
      {
        ...snapshotRow({
          id: "s1",
          canonicalUrl: "https://seeded.com/",
          headline: "Seeded",
          capturedAt: `${DAY1}T10:00:00.000Z`,
          htmlKey: HTML1,
          screenshotKey: SHOT1,
        }),
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true }),
      },
    ];
    expect(buildLlmsFullBrandBlocks(rows)).toEqual([]);
  });

  it("omits a brand whose only rows are ad-destinations (issue #1729)", () => {
    const rows: LandingPageSnapshotRow[] = [
      snapshotRow({
        id: "s1",
        canonicalUrl: "https://calendly.com/affiliate",
        headline: "Book",
        capturedAt: `${DAY1}T10:00:00.000Z`,
        htmlKey: HTML1,
        screenshotKey: SHOT1,
        isAdDestination: 1,
      }),
    ];
    expect(buildLlmsFullBrandBlocks(rows)).toEqual([]);
  });

  it("drops rows whose canonical URL does not losslessly map to a domain", () => {
    const rows: LandingPageSnapshotRow[] = [
      snapshotRow({
        id: "s1",
        canonicalUrl: "not-a-url",
        headline: "Bad",
        capturedAt: `${DAY1}T10:00:00.000Z`,
        htmlKey: HTML1,
        screenshotKey: SHOT1,
      }),
    ];
    expect(buildLlmsFullBrandBlocks(rows)).toEqual([]);
  });

  it("caps the number of brand blocks at LLMS_FULL_BRAND_LIMIT", () => {
    const rows: LandingPageSnapshotRow[] = [];
    for (let i = 0; i < LLMS_FULL_BRAND_LIMIT + 5; i += 1) {
      rows.push(
        snapshotRow({
          id: `s${i}`,
          canonicalUrl: `https://brand${i}.com/p`,
          headline: `Brand ${i}`,
          capturedAt: `${DAY1}T10:00:00.000Z`,
          htmlKey: `landing-pages/2026-09-01/${i.toString().padStart(32, "0")}.html`,
          screenshotKey: `landing-pages/2026-09-01/${i.toString().padStart(32, "0")}.jpeg`,
        }),
      );
    }
    expect(buildLlmsFullBrandBlocks(rows)).toHaveLength(LLMS_FULL_BRAND_LIMIT);
  });
});

describe("buildLlmsFullText", () => {
  it("renders a brand block with a dated offer state, an evidence link, and the Meta Ad Library source", () => {
    const block: LlmsFullBrandBlock = {
      domain: "nike.com",
      timelineUrl: "https://0509.io/timeline/nike.com",
      adLibrarySourceUrl: metaAdLibrarySourceUrl("nike.com"),
      asOf: DAY2,
      entries: [
        {
          id: "s1",
          capturedAt: `${DAY1}T10:00:00.000Z`,
          dateLabel: "1 Sept 2026",
          canonicalUrl: "https://nike.com/shop",
          headline: "Air Max",
          ctaText: "Shop now",
          priceText: "$149",
          formPresent: true,
          screenshotHref: "/artifacts/proof/landing-pages%2F2026-09-01%2Faaaa.jpeg",
          pageTextHref: "/artifacts/page-text/landing-pages%2F2026-09-01%2Faaaa.html",
          captureMethod: "landing_page_fetch",
          evidenceNote: null,
          transition: null,
          suppressedReason: null,
          runExtentLabel: null,
        },
      ],
    };
    const text = buildLlmsFullText([block]);

    // Header always present.
    expect(text).toContain("# Five to Nine — full-text offer/proof feed");
    expect(text).toContain("/llms.txt");
    // Brand domain.
    expect(text).toContain("## nike.com");
    // Dated offer state with the capture date.
    expect(text).toMatch(/2026-09-01/);
    // Evidence link (screenshot or page text) — required by issue #2043.
    expect(text).toMatch(/https:\/\/0509\.io\/artifacts\/(proof|page-text)\//);
    // Meta Ad Library source link.
    expect(text).toContain("facebook.com/ads/library/");
    // Offer fields.
    expect(text).toContain("Air Max");
    expect(text).toContain("$149");
  });

  it("degrades to an honest empty feed when no brand has proof-complete captures", () => {
    const text = buildLlmsFullText([]);
    expect(text).toContain("# Five to Nine — full-text offer/proof feed");
    expect(text).toContain("No tracked brands with proof-complete captures yet.");
    // Never fabricates a row.
    expect(text).not.toMatch(/## /);
  });
});

describe("loadLlmsFullBrandBlocks", () => {
  it("returns an empty array when D1 is absent", async () => {
    const blocks = await loadLlmsFullBrandBlocks({ DB: undefined } as never, 1000);
    expect(blocks).toEqual([]);
  });

  it("degrades to an empty array when the snapshot table is missing", async () => {
    queryAll.mockRejectedValueOnce(
      new Error("D1_ERROR: no such table: landing_page_snapshot"),
    );
    const blocks = await loadLlmsFullBrandBlocks({ DB: {} } as never, 1000);
    expect(blocks).toEqual([]);
  });

  it("rethrows non-missing-table errors", async () => {
    queryAll.mockRejectedValueOnce(new Error("D1_ERROR: something else broke"));
    await expect(
      loadLlmsFullBrandBlocks({ DB: {} } as never, 1000),
    ).rejects.toThrow("something else broke");
  });

  it("reads rows and builds brand blocks", async () => {
    queryAll.mockResolvedValueOnce([
      snapshotRow({
        id: "s1",
        canonicalUrl: "https://nike.com/shop",
        headline: "Air Max",
        priceText: "$149",
        capturedAt: `${DAY1}T10:00:00.000Z`,
        htmlKey: HTML1,
        screenshotKey: SHOT1,
      }),
    ]);
    const blocks = await loadLlmsFullBrandBlocks({ DB: {} } as never, 1000);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.domain).toBe("nike.com");
  });
});
