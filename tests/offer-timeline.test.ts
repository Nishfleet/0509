import { describe, expect, it } from "vitest";

import {
  buildOfferLedger,
  canonicalUrlBelongsToDomain,
  formatOfferDate,
  offerStateAsOf,
  parseAsOfDate,
  type OfferSnapshotInput,
} from "~/lib/offer-timeline";

const SCREENSHOT_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const SCREENSHOT_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg";
const SCREENSHOT_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.jpeg";
const HTML_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";
const HTML_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html";
const HTML_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.html";

function snapshot(overrides: Partial<OfferSnapshotInput> & Pick<OfferSnapshotInput, "id" | "capturedAt">): OfferSnapshotInput {
  return {
    canonicalUrl: "https://nykaa.com/glow",
    headline: "Glow serum",
    ctaText: "Shop now",
    priceText: "₹499",
    formPresent: true,
    screenshotKey: SCREENSHOT_A,
    pageTextKey: HTML_A,
    ...overrides,
  };
}

describe("parseAsOfDate", () => {
  it("accepts a real UTC calendar date", () => {
    expect(parseAsOfDate("2026-08-15")).toBe("2026-08-15");
  });

  it("rejects missing, malformed, and impossible dates", () => {
    expect(parseAsOfDate(null)).toBeNull();
    expect(parseAsOfDate("")).toBeNull();
    expect(parseAsOfDate("15-08-2026")).toBeNull();
    expect(parseAsOfDate("2026-02-31")).toBeNull();
  });
});

describe("canonicalUrlBelongsToDomain", () => {
  it("matches the registrable host, www, and subdomains", () => {
    expect(canonicalUrlBelongsToDomain("https://nykaa.com/glow", "nykaa.com")).toBe(true);
    expect(canonicalUrlBelongsToDomain("https://www.nykaa.com/glow", "nykaa.com")).toBe(true);
    expect(canonicalUrlBelongsToDomain("https://shop.nykaa.com/sale", "nykaa.com")).toBe(true);
  });

  it("rejects a different registrable domain", () => {
    expect(canonicalUrlBelongsToDomain("https://notnykaa.com/glow", "nykaa.com")).toBe(false);
    expect(canonicalUrlBelongsToDomain("https://nykaa.com.evil.test/glow", "nykaa.com")).toBe(false);
  });
});

describe("buildOfferLedger", () => {
  it("renders three dated states with before/after on each transition and working artifact links", () => {
    const ledger = buildOfferLedger([
      snapshot({
        id: "s1",
        capturedAt: "2026-08-01T10:00:00.000Z",
        headline: "Glow serum",
        ctaText: "Shop now",
        priceText: "₹499",
      }),
      snapshot({
        id: "s2",
        capturedAt: "2026-08-10T10:00:00.000Z",
        headline: "Festive glow kit",
        ctaText: "Get the kit",
        priceText: "₹799",
        screenshotKey: SCREENSHOT_B,
        pageTextKey: HTML_B,
      }),
      snapshot({
        id: "s3",
        capturedAt: "2026-08-20T10:00:00.000Z",
        headline: "Festive glow kit",
        ctaText: "Get the kit",
        priceText: "₹599",
        screenshotKey: SCREENSHOT_C,
        pageTextKey: HTML_C,
      }),
    ]);

    expect(ledger).toHaveLength(3);
    expect(ledger.map((entry) => entry.dateLabel)).toEqual([
      formatOfferDate("2026-08-01T10:00:00.000Z"),
      formatOfferDate("2026-08-10T10:00:00.000Z"),
      formatOfferDate("2026-08-20T10:00:00.000Z"),
    ]);

    expect(ledger[0]?.transition).toBeNull();
    expect(ledger[0]?.screenshotHref).toBe(`/artifacts/proof/${encodeURIComponent(SCREENSHOT_A)}`);
    expect(ledger[0]?.pageTextHref).toBe(`/artifacts/page-text/${encodeURIComponent(HTML_A)}`);

    expect(ledger[1]?.transition).toEqual({
      headline: { before: "Glow serum", after: "Festive glow kit" },
      ctaText: { before: "Shop now", after: "Get the kit" },
      priceText: { before: "₹499", after: "₹799" },
      formPresent: null,
    });
    expect(ledger[1]?.screenshotHref).toBe(`/artifacts/proof/${encodeURIComponent(SCREENSHOT_B)}`);
    expect(ledger[1]?.pageTextHref).toBe(`/artifacts/page-text/${encodeURIComponent(HTML_B)}`);

    expect(ledger[2]?.transition?.priceText).toEqual({ before: "₹799", after: "₹599" });
    expect(ledger[2]?.transition?.headline).toBeNull();
    expect(ledger[2]?.screenshotHref).toBe(`/artifacts/proof/${encodeURIComponent(SCREENSHOT_C)}`);
  });
});

describe("offerStateAsOf", () => {
  const ledger = buildOfferLedger([
    snapshot({ id: "s1", capturedAt: "2026-08-01T10:00:00.000Z", headline: "A" }),
    snapshot({ id: "s2", capturedAt: "2026-08-10T10:00:00.000Z", headline: "B", screenshotKey: SCREENSHOT_B, pageTextKey: HTML_B }),
    snapshot({ id: "s3", capturedAt: "2026-08-20T10:00:00.000Z", headline: "C", screenshotKey: SCREENSHOT_C, pageTextKey: HTML_C }),
  ]);

  it("returns the latest state on or before the given UTC date", () => {
    expect(offerStateAsOf(ledger, "2026-08-10")?.id).toBe("s2");
    expect(offerStateAsOf(ledger, "2026-08-15")?.headline).toBe("B");
    expect(offerStateAsOf(ledger, "2026-08-20")?.id).toBe("s3");
  });

  it("returns null when nothing had been captured yet", () => {
    expect(offerStateAsOf(ledger, "2026-07-31")).toBeNull();
  });
});
