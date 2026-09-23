import { describe, expect, it } from "vitest";

import { mapMeta, type Creative } from "../../../app/lib/ads/platforms/meta";
import page from "../../fixtures/meta-gymshark-2026-09-23.html?raw";

// One real capture of
// https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GB&q=gymshark&search_type=keyword_unordered&media_type=all
// fetched 2026-09-23 by headless Chromium, 2,019,685 bytes. The page carries
// its ads in an application/json script; the field map reads that script. The
// SHA-256 pins the exact bytes of the capture.
const PAGE_SHA_256 = "31f4bff7ce781ba133d13c7204e5455628e0beae239a9f2d2461387680cdf3a2";

const GYM_IMAGE = "1300454368397649";
const GYM_PROBE = "1847470879199109";
const GYM_VIDEO = "1107916014867006";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function oneAdScript(ads: unknown[]): string {
  return `<!doctype html><script type="application/json">${JSON.stringify({
    search_results_connection: {
      edges: [{ node: { collated_results: ads } }],
    },
  })}</script>`;
}

function goodAd(id: string): Record<string, unknown> {
  return {
    ad_archive_id: id,
    start_date: 1754550000,
    end_date: null,
    snapshot: {
      display_format: "IMAGE",
      link_url: "https://uk.gymshark.com/",
      body: { text: `Hello ${id}` },
      images: [{ original_image_url: "https://scontent.xx.fbcdn.net/a.jpg" }],
    },
  };
}

function byId(creatives: Creative[], id: string): Creative {
  const found = creatives.find((creative) => creative.platformCreativeId === id);
  expect(found, id).toBeDefined();
  if (!found) {
    throw new Error(`missing creative ${id}`);
  }
  return found;
}

describe("mapMeta", () => {
  it("pins the committed capture by hash", async () => {
    await expect(sha256Hex(page)).resolves.toBe(PAGE_SHA_256);
  });

  it("maps the fetched Gymshark Ad Library page", async () => {
    const creatives = await mapMeta(page);

    expect(creatives).toHaveLength(30);
    expect(creatives.map((creative) => creative.platformCreativeId)).toEqual(
      expect.arrayContaining([GYM_IMAGE, GYM_PROBE, GYM_VIDEO]),
    );

    const image = byId(creatives, GYM_IMAGE);
    expect(image).toMatchObject({
      platformCreativeId: GYM_IMAGE,
      copy: "Add to cart 🛒\nHit the gym 🏋️‍♂️\nRepeat 🔁",
      format: "IMAGE",
      firstSeen: "2025-08-07T07:00:00.000Z",
      lastSeen: "2025-09-26T07:00:00.000Z",
      landingUrl: "https://fb.com/canvas_doc/1936955367101511",
    });
    expect(image.mediaUrls).toHaveLength(2);
    for (const url of image.mediaUrls) {
      expect(new URL(url).hostname).toMatch(/fbcdn\.net$/);
    }

    const probe = byId(creatives, GYM_PROBE);
    expect(probe.format).toBe("DPA");
    expect(probe.landingUrl).toBe("https://uk.gymshark.com/collections/must-have/mens");
    expect(probe.firstSeen).toBe("2025-09-13T07:00:00.000Z");
    expect(probe.lastSeen).toBe("2025-10-18T07:00:00.000Z");
    expect(probe.mediaUrls.length).toBeGreaterThan(0);

    const video = byId(creatives, GYM_VIDEO);
    expect(video.format).toBe("VIDEO");
    expect(video.landingUrl).toBe("https://uk.gymshark.com/collections/lift-looks");
    expect(video.mediaUrls.length).toBeGreaterThan(0);

    for (const creative of creatives) {
      expect(creative.platformCreativeId).toMatch(/^\d+$/);
      expect(creative.firstSeen).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("reads a single creative out of one JSON script", async () => {
    const creatives = await mapMeta(oneAdScript([goodAd("42")]));

    expect(creatives).toEqual([
      {
        platformCreativeId: "42",
        copy: "Hello 42",
        mediaUrls: ["https://scontent.xx.fbcdn.net/a.jpg"],
        firstSeen: "2025-08-07T07:00:00.000Z",
        lastSeen: null,
        format: "IMAGE",
        landingUrl: "https://uk.gymshark.com/",
      },
    ]);
  });

  it("returns no creatives when the page has no JSON script", async () => {
    await expect(mapMeta("<html><body>no ads</body></html>")).resolves.toEqual([]);
  });

  it("drops an ad without a start date and keeps every other creative", async () => {
    const noStartDate = goodAd("77");
    delete noStartDate.start_date;

    const creatives = await mapMeta(
      oneAdScript([goodAd("42"), noStartDate, goodAd("43")]),
    );

    expect(creatives.map((creative) => creative.platformCreativeId)).toEqual(["42", "43"]);
  });

  it("drops an ad with no display_format and keeps every other creative", async () => {
    const noFormat = goodAd("77");
    (noFormat.snapshot as Record<string, unknown>).display_format = undefined;

    const creatives = await mapMeta(
      oneAdScript([goodAd("42"), noFormat, goodAd("43")]),
    );

    expect(creatives.map((creative) => creative.platformCreativeId)).toEqual(["42", "43"]);
  });
});
