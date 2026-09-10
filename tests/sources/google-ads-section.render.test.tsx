// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SourceChange, SourceSnapshotRecord } from "~/lib/sources/types";
import { GoogleAdsSection } from "~/components/sources/google-ads";

/**
 * #2189 — GoogleAdsSection render contract.
 *
 * The section renders the latest snapshot inside the seam's SourceSections
 * slot: advertiser names, total creatives, new-since-last-check (from the
 * diff), the format mix, and up to 12 lazy-loaded image previews. It must
 * render nothing (null) when there is no snapshot, and it must not throw on
 * a stored payload that lacks a formatMix field.
 */

function record(payload: Record<string, unknown>, overrides: Partial<SourceSnapshotRecord> = {}): SourceSnapshotRecord {
  return {
    id: "s1",
    watchlistId: "w1",
    sourceId: "google_ads",
    fetchedAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-10T00:00:00.000Z",
    payload,
    ...overrides,
  };
}

function creatives(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown>[] {
  return [
    {
      advertiserId: "AR1",
      advertiserName: "Nike Retail BV",
      creativeId: "CR1",
      format: "text",
      domain: "nike.com",
      firstShownAt: "2026-01-01T00:00:00.000Z",
      lastShownAt: "2026-09-10T00:00:00.000Z",
      previewUrl: null,
      ...overrides,
    },
  ];
}

describe("GoogleAdsSection render", () => {
  it("renders nothing when there is no snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(GoogleAdsSection, { snapshot: null, diff: [] }),
    );
    expect(html).toBe("");
  });

  it("renders advertiser name, count, new-since, format mix and preview images", () => {
    const snapshot = record({
      domain: "nike.com",
      fetchedAt: "2026-09-10T00:00:00.000Z",
      truncated: false,
      creatives: [
        ...creatives({ previewUrl: "https://tpc.googlesyndication.com/archive/simgad/1" }),
        ...creatives({
          creativeId: "CR2",
          advertiserId: "AR2",
          advertiserName: "Nike, Inc.",
          format: "image",
          previewUrl: "https://tpc.googlesyndication.com/archive/simgad/2",
        }),
      ],
      advertiserCount: 2,
      formatMix: { text: 1, image: 1, video: 0, unknown: 0 },
    });
    const diff: SourceChange[] = [
      {
        eventType: "ad_new",
        title: "1 new Google Ads creative",
        summary: "1 added since last check.",
        metadata: { category: "new_creatives", creativeIds: ["CR2"] },
      },
    ];
    const html = renderToStaticMarkup(
      createElement(GoogleAdsSection, { snapshot, diff }),
    );
    expect(html).toContain("2 creatives");
    expect(html).toContain("Nike Retail BV");
    expect(html).toContain("Nike, Inc.");
    expect(html).toContain("1 new since last check");
    expect(html).toContain("text 1");
    expect(html).toContain("image 1");
    // Both image preview URLs render as lazy <img>.
    expect(html).toContain('src="https://tpc.googlesyndication.com/archive/simgad/1"');
    expect(html).toContain('src="https://tpc.googlesyndication.com/archive/simgad/2"');
    expect(html).toContain('loading="lazy"');
  });

  it("renders truncated count and a no-creatives notice for an empty snapshot", () => {
    const truncated = record({
      domain: "nike.com",
      fetchedAt: "2026-09-10T00:00:00.000Z",
      truncated: true,
      creatives: creatives(),
      advertiserCount: 1,
      formatMix: { text: 1, image: 0, video: 0, unknown: 0 },
    });
    const html = renderToStaticMarkup(
      createElement(GoogleAdsSection, { snapshot: truncated, diff: [] }),
    );
    expect(html).toContain("1 creative");
    expect(html).toContain("showing first 200; more exist");

    const empty = record({
      domain: "nike.com",
      fetchedAt: "2026-09-10T00:00:00.000Z",
      truncated: false,
      creatives: [],
      advertiserCount: 0,
      formatMix: { text: 0, image: 0, video: 0, unknown: 0 },
    });
    const emptyHtml = renderToStaticMarkup(
      createElement(GoogleAdsSection, { snapshot: empty, diff: [] }),
    );
    expect(emptyHtml).toContain("No Google Ads creatives found");
  });

  it("does not throw when a stored payload is missing formatMix", () => {
    const snapshot = record({
      domain: "nike.com",
      fetchedAt: "2026-09-10T00:00:00.000Z",
      truncated: false,
      creatives: creatives(),
      advertiserCount: 1,
      // no formatMix key on purpose
    });
    expect(() =>
      renderToStaticMarkup(createElement(GoogleAdsSection, { snapshot, diff: [] })),
    ).not.toThrow();
  });
});