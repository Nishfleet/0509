import { describe, expect, it } from "vitest";

import { publicSeoFileForPathname } from "~/lib/seo";
import { publicSocialCardForRequest } from "~/lib/social-cards.server";
import { rasterizeSocialCardPng } from "~/lib/social-cards-raster.server";

// @ts-ignore — Vite inlines the .png as a base64 data URI with ?inline; the
// workerd test pool has no host filesystem, so the committed asset has to
// ride in as a module like the rasterizer's .ttf buffers.
import ogImageDataUri from "../../public/og-image.png?inline";

/**
 * Issue #2089 (and issue #2101 for the cluster cards) — the /ads, /timeline
 * and cluster social cards must be served as PNG
 * bytes (Facebook/X/LinkedIn refuse SVG og:images). The rasterizer is
 * worker-only (@resvg/resvg-wasm's wasm-bindgen glue is not resolvable in the
 * node test environment), so this suite runs in the `workers` project on real
 * workerd, where the wasm can be instantiated.
 *
 * It proves the served content-type is image/png and the bytes are a real
 * 1200x630 PNG raster — the exact property the issue's route-level gate
 * requires (og:image:type must match the served content-type).
 */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("ads/timeline/cluster social card rasterization (issue #2089, issue #2101)", () => {
  it("rasterizes the /ads card SVG to a valid 1200x630 PNG", async () => {
    const card = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/ads/nike.com.png?n=Nike&s=72"),
    );
    expect(card?.kind).toBe("ads");
    expect(card?.body).toContain("Nike");

    const png = await rasterizeSocialCardPng(card!.body);
    // PNG magic bytes.
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(png[i], `PNG magic byte ${i}`).toBe(PNG_MAGIC[i]);
    }
    // IHDR width/height at bytes 16-23 (big-endian).
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const height = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    expect(width).toBe(1200);
    expect(height).toBe(630);
    // A no-text render is <1KB; text + gradient should be >10KB.
    expect(png.length).toBeGreaterThan(10_000);
  });

  it("rasterizes the /timeline card SVG to a valid 1200x630 PNG", async () => {
    const card = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/timeline/nike.com.png?n=Nike"),
    );
    expect(card?.kind).toBe("timeline");
    expect(card?.body).toContain("Nike");

    const png = await rasterizeSocialCardPng(card!.body);
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(png[i], `PNG magic byte ${i}`).toBe(PNG_MAGIC[i]);
    }
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const height = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(png.length).toBeGreaterThan(10_000);
  });

  /**
   * Issue #2101 — the cluster cards (/sneaker-resale, /competitor-monitoring)
   * ride the same rasterization pipeline: the canonical .png URL and the
   * legacy .svg alias both resolve to kind "cluster", which the worker
   * rasterizes to PNG exactly like the ads/timeline cards.
   */
  it("rasterizes the cluster card SVG to a valid 1200x630 PNG", async () => {
    const card = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/sneaker-resale.png"),
    );
    expect(card?.kind).toBe("cluster");
    expect(card?.body).toContain("Sneaker resale ads");

    const png = await rasterizeSocialCardPng(card!.body);
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(png[i], `PNG magic byte ${i}`).toBe(PNG_MAGIC[i]);
    }
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const height = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(png.length).toBeGreaterThan(10_000);
  });

  /**
   * Issue #3098 — the /guides/* cards ride the same rasterization pipeline:
   * `/social-card/guides/<slug>.png` resolves to kind "guide", which the
   * worker rasterizes to PNG exactly like the ads/timeline/cluster cards.
   */
  it("rasterizes the guide card SVG to a valid 1200x630 PNG", async () => {
    const card = publicSocialCardForRequest(
      new Request(
        "https://0509.io/social-card/guides/how-to-track-competitor-ads.png?n=How+to+track+competitor+ads",
      ),
    );
    expect(card?.kind).toBe("guide");
    expect(card?.body).toContain("How to track competitor ads");

    const png = await rasterizeSocialCardPng(card!.body);
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(png[i], `PNG magic byte ${i}`).toBe(PNG_MAGIC[i]);
    }
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const height = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(png.length).toBeGreaterThan(10_000);
  });

  /**
   * Issue #3114 — the fixed hub/marketing surface cards (/compare,
   * /methodology/ad-aggression-score, /brands, /sample-brief, /briefs/weekly)
   * ride the same rasterization pipeline: `/social-card/<slug>.png` resolves
   * to kind "surface", which the worker rasterizes to PNG exactly like the
   * ads/timeline/cluster/guide cards.
   */
  it("rasterizes the surface card SVG to a valid 1200x630 PNG", async () => {
    const card = publicSocialCardForRequest(
      new Request("https://0509.io/social-card/compare.png"),
    );
    expect(card?.kind).toBe("surface");
    expect(card?.body).toContain("Compare Five to Nine vs the alternatives");

    const png = await rasterizeSocialCardPng(card!.body);
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(png[i], `PNG magic byte ${i}`).toBe(PNG_MAGIC[i]);
    }
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const height = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(png.length).toBeGreaterThan(10_000);
  });

  /**
   * Issue #2956 — the checked-in `public/og-image.png` must be byte-identical
   * to a resvg render of `SOCIAL_CARD_SVG` (served at /social-card.svg). The
   * stale-card regression this issue fixed was exactly a drift between the
   * card markup and the committed PNG; resvg-wasm is deterministic for the
   * same wasm + fonts, so the equality gate makes the two artifacts unable to
   * diverge again. A failing run here means: regenerate the PNG from the SVG
   * (the same rasterizer and Inter buffers the worker uses) and commit it.
   */
  it("keeps public/og-image.png byte-identical to the rendered card SVG", async () => {
    const card = publicSeoFileForPathname("/social-card.svg");
    expect(card?.body).toContain("0509.io");

    const png = await rasterizeSocialCardPng(card!.body);
    const base64 = (ogImageDataUri as string).split(";base64,")[1];
    const binary = atob(base64);
    const committed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) committed[i] = binary.charCodeAt(i) & 0xff;
    expect(png).toEqual(committed);
  });
});
