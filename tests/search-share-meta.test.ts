import { describe, expect, it } from "vitest";

import { searchShareMeta } from "~/lib/seo";

// Issue #2039: a resolved single-competitor /search result must share the
// competitor's branded social card (and name the brand), while an unresolved
// /search keeps the site-wide generic card. Pure unit test — no D1, no worker,
// no migration.
describe("searchShareMeta", () => {
  it("resolves a valid single-competitor website to the encoded branded card", () => {
    const out = searchShareMeta({
      website: "nykaa.com",
      host: "nykaa.com",
      displayName: "Nykaa",
    });

    expect(out).not.toBeNull();
    // Same encoded card the /ads/nykaa.com surface shares, not og-image.png.
    expect(out!.ogImageUrl).toBe(
      "https://0509.io/social-card/ads/nykaa.com.png?n=Nykaa",
    );
    expect(out!.title).toContain("Nykaa Meta ads");
    expect(out!.description).toContain("Nykaa");
    expect(out!.ogImageAlt).toContain("Nykaa");
  });

  it("stamps a finite score param onto the card URL when one is provided", () => {
    const out = searchShareMeta({
      website: "nykaa.com",
      host: "nykaa.com",
      displayName: "Nykaa",
      score: 72,
    });

    expect(out!.ogImageUrl).toContain("s=72");
    expect(out!.ogImageUrl).toContain("https://0509.io/social-card/ads/nykaa.com.png");
  });

  it("keeps the generic card when no single competitor is resolved (empty website / keyword)", () => {
    // The "multi-match keyword, no winner" case produces the same nulled
    // competitorWebsite the loader yields for any bare `?query=`: a keyword
    // never populates `host`/`displayName`, so the brand card must not be
    // forced onto it.
    expect(
      searchShareMeta({ website: "", host: null, displayName: null }),
    ).toBeNull();
  });

  it("keeps the generic card when the website input is invalid (no displayName)", () => {
    expect(
      searchShareMeta({ website: "not a url", host: null, displayName: null }),
    ).toBeNull();
  });
});
