import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LinkedinAdsSection } from "~/components/sources/linkedin-ads";
import type { SourceChange, SourceSnapshotRecord } from "~/lib/sources/types";

/**
 * Section coverage for #2193 do:4. The Section is a seam slot: it must render
 * advertiser / total ads / new-since-last-check / up to 12 previews from a
 * stored payload, render nothing on a missing or malformed payload, and never
 * emit a non-https creative url.
 */
function ad(id: string, creative: string | null = `https://media.licdn.com/dms/image/ad${id}/creative`) {
  return {
    id,
    advertiser: "Notion",
    text: `ad copy ${id}`,
    creativeImageUrl: creative,
    detailUrl: `https://www.linkedin.com/ad-library/detail/${id}`,
  };
}

function record(payload: unknown): SourceSnapshotRecord {
  return {
    id: "snap-1",
    watchlistId: "wl-1",
    sourceId: "linkedin",
    fetchedAt: "2026-09-09T00:00:00Z",
    createdAt: "2026-09-09T00:00:00Z",
    payload: payload as SourceSnapshotRecord["payload"],
  };
}

function newChange(): SourceChange {
  return { eventType: "ad_new", title: "new", summary: "new", metadata: {} };
}

function payload(ads: ReturnType<typeof ad>[], over: Record<string, unknown> = {}) {
  return { accountOwner: "Notion", totalAds: ads.length, ambiguous: false, ads, ...over };
}

describe("LinkedinAdsSection", () => {
  it("renders nothing without a snapshot", () => {
    expect(renderToStaticMarkup(<LinkedinAdsSection snapshot={null} diff={[]} />)).toBe("");
  });

  it("renders nothing when the stored payload is not a LinkedIn payload", () => {
    expect(
      renderToStaticMarkup(<LinkedinAdsSection snapshot={record({ nonsense: true })} diff={[]} />),
    ).toBe("");
  });

  it("renders advertiser, total ads, the new count and the detail links", () => {
    const html = renderToStaticMarkup(
      <LinkedinAdsSection
        snapshot={record(payload([ad("1001"), ad("1002")]))}
        diff={[newChange()]}
      />,
    );
    expect(html).toContain("Notion");
    expect(html).toContain("Total ads in the library: 2");
    expect(html).toContain("1 new since last check");
    expect(html).toContain("https://www.linkedin.com/ad-library/detail/1001");
    expect(html).toContain("https://media.licdn.com/dms/image/ad1001/creative");
  });

  it("caps previews at 12", () => {
    const ads = Array.from({ length: 15 }, (_, i) => ad(String(2000 + i)));
    const html = renderToStaticMarkup(
      <LinkedinAdsSection snapshot={record(payload(ads))} diff={[]} />,
    );
    expect(html.match(/f9-ads-card"/g)).toHaveLength(12);
  });

  it("renders the zero-ad state instead of nothing", () => {
    const html = renderToStaticMarkup(
      <LinkedinAdsSection snapshot={record(payload([]))} diff={[]} />,
    );
    expect(html).toContain("No LinkedIn ads found for Notion.");
  });

  it("never emits a non-https creative url", () => {
    const html = renderToStaticMarkup(
      <LinkedinAdsSection
        snapshot={record(payload([ad("1001", "http://tracker.example/pixel.gif")]))}
        diff={[]}
      />,
    );
    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain("<img");
  });

  it("skips ads a stored payload cannot render (no detail link)", () => {
    const broken = { ...ad("1001"), detailUrl: "" };
    const html = renderToStaticMarkup(
      <LinkedinAdsSection snapshot={record(payload([broken]))} diff={[]} />,
    );
    expect(html).toContain("No LinkedIn ads found for Notion.");
  });
});
