import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HTMLRewriter } from "htmlrewriter";
import { describe, expect, it } from "vitest";

import { mapMeta, type Creative } from "../../../app/lib/ads/platforms/meta";

// The unit project runs in Node, where the Workers HTMLRewriter global is
// absent. The `htmlrewriter` package is that same API for Node; the module
// under test still calls the global, which is what the Worker provides.
(globalThis as { HTMLRewriter?: typeof HTMLRewriter }).HTMLRewriter = HTMLRewriter;

// The packet names this fixture for the 2026-09-21 probe. That probe kept three
// archive ids and no HTML. This file is the application/json script that held
// the creatives on the Ad Library page fetched 2026-09-22T14:25:12Z (headless
// Chrome, q=gymshark, country=GB). The field map reads that script. The rest
// of the page is Facebook shell and is not in this file.
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "meta-gymshark-2026-09-21.html",
);
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "migrations",
  "0003_meta_ads_source.sql",
);

const GYM_IMAGE = "1300454368397649";
const GYM_PROBE = "1847470879199109";
const GYM_VIDEO = "1107916014867006";

function byId(creatives: Creative[], id: string): Creative {
  const found = creatives.find((creative) => creative.platformCreativeId === id);
  expect(found, id).toBeDefined();
  if (!found) {
    throw new Error(`missing creative ${id}`);
  }
  return found;
}

describe("mapMeta", () => {
  it("maps the fetched Gymshark Ad Library page", async () => {
    const html = readFileSync(fixturePath, "utf8");
    const creatives = await mapMeta(html);

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
    const html = `<!doctype html><script type="application/json">${JSON.stringify({
      search_results_connection: {
        edges: [
          {
            node: {
              collated_results: [
                {
                  ad_archive_id: "42",
                  start_date: 1754550000,
                  end_date: null,
                  snapshot: {
                    display_format: "IMAGE",
                    link_url: "https://uk.gymshark.com/",
                    body: { text: "Hello" },
                    images: [{ original_image_url: "https://scontent.xx.fbcdn.net/a.jpg" }],
                  },
                },
              ],
            },
          },
        ],
      },
    })}</script>`;

    const creatives = await mapMeta(html);
    expect(creatives).toEqual([
      {
        platformCreativeId: "42",
        copy: "Hello",
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

  it("does not point the field map or the source row at Graph ads_archive", () => {
    const mapper = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app/lib/ads/platforms/meta.ts"),
      "utf8",
    );
    const migration = readFileSync(migrationPath, "utf8");
    expect(mapper).not.toContain("graph.facebook.com");
    expect(mapper).not.toContain("ads_archive");
    expect(migration).not.toContain("graph.facebook.com");
    expect(migration).toContain("'src_ads_meta'");
    expect(migration).toContain("'ads.meta', 'ads', 'meta', 'ads.meta', 'scraped_page', 1");
    expect(migration).toContain('"status": 403');
    expect(migration).toContain('"call": false');
  });
});
