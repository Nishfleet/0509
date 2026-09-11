import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdCreative } from "~/components/ads/ad-creative";
import { isFbcdnCreativeUrl } from "~/lib/creative-edge-cache-url";

/**
 * Issue #2730 — lock the fbcdn-proxy contract on `AdCreative`.
 *
 * A stored fbcdn creative must reach the browser ONLY as the same-origin
 * `/creative/:id` edge URL: the raw URL carries an expiring `oe=` signature,
 * hands Meta a referrer, and bypasses every cache we control (issue #2401).
 * These tests pin that contract — including the two raw-URL gaps the #2401
 * review left open: `http://*.fbcdn.net` and apex `https://fbcdn.net` used to
 * fail `isEdgeCacheableCreativeUrl`'s https+subdomain check and fall straight
 * through to a raw `<img src>`.
 */

const FB_URL =
  "https://scontent-bos5-1.xx.fbcdn.net/v/t39/creative.jpg?oh=abc&oe=6AA7C003";

type Ad = Parameters<typeof AdCreative>[0]["ad"];

const baseAd: Pick<Ad, "advertiser" | "format" | "previewHeadline" | "hook"> = {
  advertiser: "Example Advertiser",
  format: "image",
  previewHeadline: "A stored headline",
  hook: "A stored hook",
};

function renderCreative(ad: Ad): string {
  return renderToStaticMarkup(createElement(AdCreative, { ad, savedLabel: null }));
}

describe("AdCreative fbcdn contract (#2730)", () => {
  it("emits /creative/<metaAdId> for a stored https fbcdn creative — never the raw URL", () => {
    const html = renderCreative({
      ...baseAd,
      creativeImageUrl: FB_URL,
      metaAdId: "ad_1",
    });

    expect(html).toContain('src="/creative/ad_1"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("fbcdn");
  });

  it.each([
    ["http fbcdn", "http://scontent-bos5-1.xx.fbcdn.net/v/t39/creative.jpg?oe=6AA7C003"],
    ["apex fbcdn", "https://fbcdn.net/v/t39/creative.jpg?oe=6AA7C003"],
    ["scheme-relative fbcdn", "//scontent-bos5-1.xx.fbcdn.net/v/t39/creative.jpg?oe=6AA7C003"],
  ])("renders the mock — no raw <img src> — for a stored %s URL", (_label, creativeImageUrl) => {
    const html = renderCreative({ ...baseAd, creativeImageUrl, metaAdId: "ad_1" });

    expect(html).not.toContain("fbcdn");
    expect(html).not.toContain("<img");
    expect(html).toContain("f9-ads-thumb-mock");
  });

  it("renders the mock and no <img> when an fbcdn creative has no usable metaAdId", () => {
    for (const metaAdId of [null, undefined, "", "../escape", "a/b"]) {
      const html = renderCreative({ ...baseAd, creativeImageUrl: FB_URL, metaAdId });

      expect(html).not.toContain("<img");
      expect(html).not.toContain("fbcdn");
      expect(html).toContain("f9-ads-thumb-mock");
    }
  });

  it("still renders a non-fbcdn stored URL as-is — the gate is not an open-proxy blocklist", () => {
    const html = renderCreative({
      ...baseAd,
      creativeImageUrl: "https://cdn.example.com/x.jpg",
      metaAdId: "ad_1",
    });

    expect(html).toContain('src="https://cdn.example.com/x.jpg"');
  });
});

describe("isFbcdnCreativeUrl", () => {
  it("matches apex and subdomain fbcdn hosts over http, https, and scheme-relative", () => {
    expect(isFbcdnCreativeUrl(FB_URL)).toBe(true);
    expect(isFbcdnCreativeUrl("http://x.fbcdn.net/x.jpg")).toBe(true);
    expect(isFbcdnCreativeUrl("https://fbcdn.net/x.jpg")).toBe(true);
    expect(isFbcdnCreativeUrl("//x.fbcdn.net/x.jpg")).toBe(true);
    expect(isFbcdnCreativeUrl("HTTPS://X.FBCDN.NET/X.JPG")).toBe(true);
  });

  it("rejects lookalike hosts, non-fbcdn URLs, and same-origin paths", () => {
    expect(isFbcdnCreativeUrl("https://evil-fbcdn.net/x.jpg")).toBe(false);
    expect(isFbcdnCreativeUrl("https://fbcdn.net.attacker.test/x.jpg")).toBe(false);
    expect(isFbcdnCreativeUrl("https://cdn.example.com/fbcdn.jpg")).toBe(false);
    expect(isFbcdnCreativeUrl("/creative/ad_1")).toBe(false);
    expect(isFbcdnCreativeUrl("not a url")).toBe(false);
    expect(isFbcdnCreativeUrl(null)).toBe(false);
    expect(isFbcdnCreativeUrl("")).toBe(false);
  });
});
