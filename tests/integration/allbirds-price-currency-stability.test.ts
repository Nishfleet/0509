import { describe, expect, it } from "vitest";

import {
  extractLandingPageSignals,
  pickDeclaredCurrency,
} from "~/lib/landing-page-signals.server";
import { buildOfferLedger } from "~/lib/offer-timeline";

/**
 * Issue #2861 — the public /timeline/allbirds.com ledger showed the offer
 * price alternating £50 → $100 → £50 → $100 daily, flagged "material" each
 * time. The stored captures (still publicly fetchable at
 * /artifacts/page-text/landing-pages%2F2026-09-0{5,6,7,8}%2F*.html and
 * 2026-09-11) show why:
 *
 * - Every render declares the SAME shop currency: `"currencyCode":"USD"`,
 *   `"currency":"USD"`, `currency = {"active":"USD"}`, `data-currency="USD"`.
 * - The £ renders carry ONE extra localized string — a UK-geo announcement
 *   bar slide "Free shipping and returns on orders over £50." — which sits
 *   BEFORE every real price in flattened text order. First-in-text matching
 *   picked it, so the stored price_text flipped with the render's geo.
 *
 * The fixtures below mirror that structure: a geo-localized announcement
 * bar ahead of the USD product prices, with the identical USD currency
 * declarations in the head/scripts. The extractor must resolve the
 * currency from the page's own declaration — deterministic per page
 * version — instead of whichever marker happens to render first.
 */

const ALLBIRDS_HEAD_SCRIPTS = `
  <script type="application/json">
    {"shopId":11044168,"countryCode":"US","currencyCode":"USD","merchantName":"Allbirds"}
  </script>
  <script>
    var currency = {"active":"USD","rate":"1.0"};
    window.shopCurrency = 'USD';
  </script>
  <script type="application/json">
    {"shop":{"name":"Allbirds","paymentSettings":{"currencyCode":"USD"},
     "storefrontUrl":"https://www.allbirds.com"}}
  </script>`;

const ALLBIRDS_PRODUCT_PRICES = `
  <main>
    <h1>The World's Most Comfortable Shoes</h1>
    <section class="product-card"><span class="price">$100</span></section>
    <section class="product-card"><span class="price">$105</span></section>
    <section class="product-card"><span class="price">$140</span></section>
    <section class="product-card"><span class="price">$14</span></section>
  </main>`;

/** Mirrors the 5/7/11-Sept captures: UK-geo announcement bar, USD shop. */
const ALLBIRDS_UK_GEO_RENDER = `<!doctype html><html><head>
  ${ALLBIRDS_HEAD_SCRIPTS}
</head><body>
  <div class="swiper-slide swiper-slide-active">
    <p class="text-center"> Free shipping and returns on orders over £50. </p>
  </div>
  <nav><a href="/collections/mens">Shop Now</a></nav>
  ${ALLBIRDS_PRODUCT_PRICES}
</body></html>`;

/** Mirrors the 6/8-Sept captures: US announcement bar, same USD shop. */
const ALLBIRDS_US_RENDER = `<!doctype html><html><head>
  ${ALLBIRDS_HEAD_SCRIPTS}
</head><body>
  <div class="swiper-slide swiper-slide-active">
    <p class="text-center"> Free ground shipping on orders over $100 </p>
  </div>
  <nav><a href="/signup">Sign Up</a></nav>
  ${ALLBIRDS_PRODUCT_PRICES}
</body></html>`;

describe("allbirds.com price-currency stability (issue #2861)", () => {
  it("resolves the declared shop currency from both render variants", () => {
    expect(pickDeclaredCurrency(ALLBIRDS_UK_GEO_RENDER)).toBe("USD");
    expect(pickDeclaredCurrency(ALLBIRDS_US_RENDER)).toBe("USD");
  });

  it("extracts the same price across the alternating captures", () => {
    // The observed capture sequence: UK-geo, US, UK-geo, US, UK-geo.
    const captures = [
      ALLBIRDS_UK_GEO_RENDER,
      ALLBIRDS_US_RENDER,
      ALLBIRDS_UK_GEO_RENDER,
      ALLBIRDS_US_RENDER,
      ALLBIRDS_UK_GEO_RENDER,
    ];
    const prices = captures.map(
      (html) =>
        extractLandingPageSignals(html, { documentMode: "rendered" }).priceText,
    );
    // Before the anchor this was £50, $100, £50, $100, £50 — the price
    // currency must not alternate between captures of a page whose
    // declared currency never changed.
    expect(new Set(prices)).toEqual(new Set(["$100"]));
  });

  it("produces a ledger with no price transition for the replayed sequence", () => {
    const snapshots = [
      ALLBIRDS_UK_GEO_RENDER,
      ALLBIRDS_US_RENDER,
      ALLBIRDS_UK_GEO_RENDER,
      ALLBIRDS_US_RENDER,
    ].map((html, index) => {
      const signals = extractLandingPageSignals(html, {
        documentMode: "rendered",
      });
      return {
        id: `capture-${index}`,
        canonicalUrl: "https://www.allbirds.com/",
        capturedAt: `2026-09-0${5 + index}T04:00:00.000Z`,
        headline: "The World's Most Comfortable Shoes",
        ctaText: "Shop Now",
        priceText: signals.priceText,
        formPresent: false,
        screenshotKey: `shot-${index}`,
        pageTextKey: `text-${index}`,
        captureMethod: "browser_render",
        evidenceNote: null,
      };
    });
    const entries = buildOfferLedger(snapshots);
    // Identical commercial fields collapse into one dated state — and even
    // if a sibling field differed, no entry may carry a £→$ price flip.
    expect(entries.every((entry) => entry.priceText === "$100")).toBe(true);
    expect(
      entries.every((entry) => entry.transition?.priceText == null),
    ).toBe(true);
  });

  it("follows the declared currency, not a hard-coded one", () => {
    // A GBP shop keeps its £ price even when a $-marked embed sits earlier.
    const gbpShop = `<html><head>
      <script>{"paymentSettings":{"currencyCode":"GBP"}}</script>
    </head><body>
      <p>US visitors: ships free over $100</p>
      <p class="price">£50</p>
    </body></html>`;
    expect(pickDeclaredCurrency(gbpShop)).toBe("GBP");
    expect(
      extractLandingPageSignals(gbpShop, { documentMode: "rendered" })
        .priceText,
    ).toBe("£50");
  });

  it("changes when the page's declared currency genuinely changes", () => {
    const rebrandedToGbp = ALLBIRDS_US_RENDER.replaceAll("USD", "GBP");
    expect(pickDeclaredCurrency(rebrandedToGbp)).toBe("GBP");
    const signals = extractLandingPageSignals(rebrandedToGbp, {
      documentMode: "rendered",
    });
    // The first $-marked text no longer matches the declared currency; the
    // remaining $ candidates all mismatch, so the historical first match
    // applies — the point is the anchor tracks the page's own declaration.
    expect(pickDeclaredCurrency(ALLBIRDS_US_RENDER)).toBe("USD");
    expect(signals.priceText).not.toBeNull();
  });

  it("keeps the historical first-match behaviour when nothing is declared", () => {
    const silent = `<html><body>
      <p>Free shipping over £50</p>
      <p class="price">$100</p>
    </body></html>`;
    expect(pickDeclaredCurrency(silent)).toBeNull();
    expect(
      extractLandingPageSignals(silent, { documentMode: "rendered" })
        .priceText,
    ).toBe("£50");
  });

  it("ignores stray foreign-currency declarations ahead of the real one (issue #2905)", () => {
    // A commented-out ad-slot embed declares EUR first, and a doubled
    // currency-switcher list (desktop + mobile nav) repeats
    // `data-currency="EUR"` per option — under plurality-with-firstIndex
    // that stray block ties USD 3:3 and wins on position, anchoring the
    // extractor to a currency no candidate carries so pass 2 re-selects
    // the £50 first match. Comments never vote, repeated attribute votes
    // count once per code, and the winner must lead outright: USD wins
    // 2:1 and the extracted price stays on the shop currency.
    const strayForeign = `<!doctype html><html><head>
      <!-- ad slot: currency = "EUR" -->
      <script type="application/json">{"currencyCode":"USD"}</script>
    </head><body>
      <ul class="currency-switcher"><li data-currency="EUR">EUR</li><li data-currency="USD">USD</li></ul>
      <ul class="currency-switcher-mobile"><li data-currency="EUR">EUR</li><li data-currency="USD">USD</li></ul>
      <div class="swiper-slide swiper-slide-active">
        <p class="text-center"> Free shipping and returns on orders over £50. </p>
      </div>
      ${ALLBIRDS_PRODUCT_PRICES}
    </body></html>`;
    expect(pickDeclaredCurrency(strayForeign)).toBe("USD");
    expect(
      extractLandingPageSignals(strayForeign, { documentMode: "rendered" })
        .priceText,
    ).toBe("$100");
  });

  it("resolves a top-vote tie to no anchor so first-match decides (issue #2905)", () => {
    // One EUR declaration against one USD declaration is ambiguous — the
    // vote must not pick whichever happened to render first, it resolves
    // null and the historical first match (£50) applies.
    const ambiguous = `<html><head>
      <script>{"currencyCode":"EUR"}</script>
      <script>var currency = "USD";</script>
    </head><body><p class="price">£50</p></body></html>`;
    expect(pickDeclaredCurrency(ambiguous)).toBeNull();
    expect(
      extractLandingPageSignals(ambiguous, { documentMode: "rendered" })
        .priceText,
    ).toBe("£50");
  });

  it("never blanks a price whose only marker mismatches the declaration", () => {
    // Declared USD, but the lone visible price is £-marked: the anchor
    // finds no USD candidate and must fall back to the £50 first match
    // rather than report no price at all.
    const onlyGbp = `<html><head>
      <script>{"currencyCode":"USD"}</script>
    </head><body><p class="price">£50</p></body></html>`;
    expect(
      extractLandingPageSignals(onlyGbp, { documentMode: "rendered" })
        .priceText,
    ).toBe("£50");
  });
});
