import { describe, expect, it } from "vitest";

import {
  extractLandingPageSignals,
  pickDeclaredMarketCountry,
} from "~/lib/landing-page-signals.server";
import {
  buildOfferLedger,
  captureValidityReason,
  type OfferSnapshotInput,
} from "~/lib/offer-timeline";
import { rowToSnapshot } from "~/lib/offer-timeline.server";

/**
 * Issue #2889 — the public /timeline/allbirds.com ledger alternated the CTA
 * "Shop Now" (5/7/11-Sept captures) and "Sign Up" (6/8-Sept captures) in
 * lockstep with the day's geo render. The stored captures show the page's
 * locale ("en-US") and declared currency ("USD") are IDENTICAL across all
 * five renders — #2861's currency anchor and #1996's locale-path gate both
 * see nothing. The only deterministic difference is the page's declared
 * market: `Shopify.country = "GB"` + `"countryCode":"GB"` on the Shop Now
 * renders, `"US"` on both on the Sign Up renders.
 *
 * Fix: extract the declared market at capture time (lp-signals-v8), store it
 * on the snapshot metadata (capture_metadata_json — no D1 schema change),
 * and extend the capture-validity gate (#1996) to suppress a same-URL
 * render-variant pair whose declared markets differ.
 */

/** Mirrors the real captures' head scripts: market flips, currency does not. */
function headScripts(market: "GB" | "US", marketId: string) {
  return `
  <script type="application/json">
    {"shopId":11044168,"countryCode":"${market}","currencyCode":"USD","merchantName":"Allbirds"}
  </script>
  <script>
    var currency = {"active":"USD","rate":"1.0"};
    window.shopCurrency = 'USD';
    Shopify.country = "${market}";
    var marketId = "${marketId}";
  </script>`;
}

/** Mirrors the 5/7/11-Sept captures: GB-declared render, "Shop Now" CTA. */
const ALLBIRDS_GB_RENDER = `<!doctype html><html lang="en-US"><head>
  ${headScripts("GB", "21447016528")}
</head><body>
  <div class="swiper-slide swiper-slide-active">
    <p class="text-center"> Free shipping and returns on orders over £50. </p>
  </div>
  <nav><a href="/collections/mens">Shop Now</a></nav>
  <main><section class="product-card"><span class="price">$100</span></section></main>
</body></html>`;

/** Mirrors the 6/8-Sept captures: US-declared render, "Sign Up" CTA only. */
const ALLBIRDS_US_RENDER = `<!doctype html><html lang="en-US"><head>
  ${headScripts("US", "1434976336")}
</head><body>
  <div class="swiper-slide swiper-slide-active">
    <p class="text-center"> Free ground shipping on orders over $100 </p>
  </div>
  <form><input type="email" name="contact[email]"><button type="submit"> Sign Up </button></form>
  <main><section class="product-card"><span class="price">$100</span></section></main>
</body></html>`;

const CANONICAL = "https://www.allbirds.com/";

function snapshot(
  id: string,
  capturedAt: string,
  declaredMarketCountry: string,
  ctaText: string,
): OfferSnapshotInput {
  return {
    id,
    canonicalUrl: CANONICAL,
    capturedAt,
    headline: "Allbirds: Comfortable, Sustainable Shoes & Apparel",
    ctaText,
    priceText: "$100",
    formPresent: false,
    screenshotKey: "landing-pages/2026-09-05/shot.png",
    pageTextKey: "landing-pages/2026-09-05/page.html",
    captureMethod: "landing_page_fetch",
    declaredMarketCountry,
    evidenceNote: null,
  };
}

describe("allbirds.com CTA market stability (issue #2889)", () => {
  it("resolves the declared market from both render variants", () => {
    expect(pickDeclaredMarketCountry(ALLBIRDS_GB_RENDER)).toBe("GB");
    expect(pickDeclaredMarketCountry(ALLBIRDS_US_RENDER)).toBe("US");
  });

  it("extracts the alternating CTAs with their declared market", () => {
    const gb = extractLandingPageSignals(ALLBIRDS_GB_RENDER);
    const us = extractLandingPageSignals(ALLBIRDS_US_RENDER);
    expect(gb.ctaText).toBe("Shop Now");
    expect(gb.declaredMarketCountry).toBe("GB");
    expect(us.ctaText).toBe("Sign Up");
    expect(us.declaredMarketCountry).toBe("US");
  });

  it("declares nothing when the page carries no market signal", () => {
    expect(
      pickDeclaredMarketCountry(
        "<html><body><p>Shop Now</p></body></html>",
      ),
    ).toBeNull();
  });

  it("suppresses a same-URL pair whose declared markets differ", () => {
    expect(
      captureValidityReason(
        {
          canonicalUrl: CANONICAL,
          headline: "h",
          ctaText: "Shop Now",
          declaredMarketCountry: "GB",
        },
        {
          canonicalUrl: CANONICAL,
          headline: "h",
          ctaText: "Sign Up",
          declaredMarketCountry: "US",
        },
      ),
    ).toBe("geo market change");
  });

  it("does not suppress when either side declares no market", () => {
    const snapshot = {
      canonicalUrl: CANONICAL,
      headline: "h",
      ctaText: "Sign Up",
    };
    expect(captureValidityReason(snapshot, snapshot)).toBeNull();
    expect(
      captureValidityReason(snapshot, {
        ...snapshot,
        declaredMarketCountry: "US",
      }),
    ).toBeNull();
  });

  it("does not suppress when both sides declare the same market", () => {
    const base = {
      canonicalUrl: CANONICAL,
      headline: "h",
      ctaText: "Sign Up",
      declaredMarketCountry: "US",
    };
    expect(
      captureValidityReason(base, { ...base, ctaText: "Shop Now" }),
    ).toBeNull();
  });

  it("the alternating capture sequence produces no CTA transition", () => {
    // The observed live sequence: 5 Sept GB, 6 Sept US, 7 Sept GB,
    // 8 Sept US, 11 Sept GB — all the same canonical URL.
    const snapshots = [
      snapshot("s05", "2026-09-05T08:00:00.000Z", "GB", "Shop Now"),
      snapshot("s06", "2026-09-06T08:00:00.000Z", "US", "Sign Up"),
      snapshot("s07", "2026-09-07T08:00:00.000Z", "GB", "Shop Now"),
      snapshot("s08", "2026-09-08T08:00:00.000Z", "US", "Sign Up"),
      snapshot("s11", "2026-09-11T08:00:00.000Z", "GB", "Shop Now"),
    ];
    const entries = buildOfferLedger(snapshots);
    // Only the GB states survive as unsuppressed; every US render-variant is
    // suppressed with the market reason and carries no transition.
    expect(entries.map((entry) => entry.suppressedReason)).toEqual([
      null,
      "geo market change",
      null,
      "geo market change",
      null,
    ]);
    for (const entry of entries) {
      expect(entry.transition?.ctaText ?? null).toBeNull();
    }
  });

  it("rowToSnapshot carries the declared market out of stored metadata", () => {
    const gb = rowToSnapshot({
      id: "s05",
      canonical_url: CANONICAL,
      raw_headline: "Allbirds",
      cta_text: "Shop Now",
      price_text: "$100",
      form_present: 0,
      artifact_key: "landing-pages/2026-09-05/9ee0cbb6.html",
      metadata_json: JSON.stringify({
        declaredMarketCountry: "GB",
        screenshotArtifactKey: "2026-09-05/shot.png",
        htmlArtifactKey: "landing-pages/2026-09-05/page.html",
      }),
      capture_method: "landing_page_fetch",
      captured_at: "2026-09-05T08:00:00.000Z",
      is_ad_destination: 0,
    });
    expect(gb.declaredMarketCountry).toBe("GB");

    const legacy = rowToSnapshot({
      id: "s-old",
      canonical_url: CANONICAL,
      raw_headline: "Allbirds",
      cta_text: "Shop Now",
      price_text: "$100",
      form_present: 0,
      artifact_key: null,
      metadata_json: JSON.stringify({ extractorVersion: "lp-signals-v6" }),
      capture_method: "landing_page_fetch",
      captured_at: "2026-08-01T08:00:00.000Z",
      is_ad_destination: 0,
    });
    expect(legacy.declaredMarketCountry).toBeNull();
  });
});
