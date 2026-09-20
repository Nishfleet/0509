// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SourceSections } from "~/components/sources/source-sections";
import type { SourceSnapshotRecord } from "~/lib/sources/types";

/**
 * Issue #2581 — the seam's last clause: a populated `snapshots` map must
 * actually reach each adapter's Section. Renders the real Google Ads
 * section from a stored-payload fixture; the other five entries get no map
 * key and render nothing.
 */

const SNAPSHOT: SourceSnapshotRecord = {
  id: "snap-1",
  watchlistId: "wl-1",
  sourceId: "google_ads",
  fetchedAt: "2026-09-19T00:00:00.000Z",
  createdAt: "2026-09-19T00:00:00.000Z",
  payload: {
    domain: "example.com",
    fetchedAt: "2026-09-19T00:00:00.000Z",
    truncated: false,
    advertiserCount: 1,
    formatMix: { text: 0, image: 1, video: 0, unknown: 0 },
    creatives: [
      {
        advertiserId: "AR123",
        advertiserName: "Example Co",
        creativeId: "cr-1",
        format: "image",
        domain: "example.com",
        firstShownAt: "2026-09-01T00:00:00.000Z",
        lastShownAt: "2026-09-19T00:00:00.000Z",
        previewUrl: null,
      },
    ],
  },
};

describe("SourceSections snapshots map", () => {
  it("renders the adapter section for a keyed snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(SourceSections, {
        competitorId: "wl-1",
        plan: "starter",
        snapshots: { google_ads: { snapshot: SNAPSHOT, diff: [] } },
      }),
    );
    expect(html).toContain("Google Ads creatives");
    expect(html).toContain("Example Co");
    expect(html).toContain("1 creative");
  });

  it("renders nothing when the map holds an explicit null entry", () => {
    const html = renderToStaticMarkup(
      createElement(SourceSections, {
        competitorId: "wl-1",
        plan: "starter",
        snapshots: { google_ads: { snapshot: null, diff: [] } },
      }),
    );
    expect(html).toBe("");
  });
});
