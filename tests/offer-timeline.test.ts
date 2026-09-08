import { describe, expect, it } from "vitest";

import {
  backfillEvidenceNote,
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
    evidenceNote: null,
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

  it("passes an honest evidence note through for a backfill snapshot with no artifacts", () => {
    const note = backfillEvidenceNote("2026-07-15T09:00:00.000Z");
    expect(note).toContain("no screenshot");
    expect(note).toContain(formatOfferDate("2026-07-15T09:00:00.000Z"));

    const ledger = buildOfferLedger([
      snapshot({
        id: "backfill-1",
        capturedAt: "2026-07-15T09:00:00.000Z",
        headline: "Seeded state",
        screenshotKey: null,
        pageTextKey: null,
        evidenceNote: note,
      }),
    ]);

    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.screenshotHref).toBeNull();
    expect(ledger[0]?.pageTextHref).toBeNull();
    expect(ledger[0]?.evidenceNote).toBe(note);
  });

  it("collapses consecutive identical captures into ONE dated state (calendly 5-in-54s burst)", () => {
    const ledger = buildOfferLedger([
      snapshot({
        id: "c1",
        capturedAt: "2026-08-28T00:01:25.000Z",
        canonicalUrl: "https://calendly.com/adflex360/brand-scaling-call",
        headline: "Brand Scaling Call - Adflex Digital",
        ctaText: "Show more",
        priceText: null,
        formPresent: false,
        screenshotKey: SCREENSHOT_A,
        pageTextKey: HTML_A,
      }),
      snapshot({
        id: "c2",
        capturedAt: "2026-08-28T00:01:40.000Z",
        headline: "Brand Scaling Call - Adflex Digital",
        ctaText: "Show more",
        priceText: null,
        formPresent: false,
      }),
      snapshot({
        id: "c3",
        capturedAt: "2026-08-28T00:01:54.000Z",
        headline: "Brand Scaling Call - Adflex Digital",
        ctaText: "Show more",
        priceText: null,
        formPresent: false,
      }),
      snapshot({
        id: "c4",
        capturedAt: "2026-08-28T00:02:07.000Z",
        headline: "Brand Scaling Call - Adflex Digital",
        ctaText: "Show more",
        priceText: null,
        formPresent: false,
      }),
      snapshot({
        id: "c5",
        capturedAt: "2026-08-28T00:02:19.000Z",
        headline: "Brand Scaling Call - Adflex Digital",
        ctaText: "Show more",
        priceText: null,
        formPresent: false,
      }),
    ]);

    // 5 identical captures collapse to 1 dated state.
    expect(ledger).toHaveLength(1);
    const collapsed = ledger[0]!;
    // Keeps the first capture's date and hrefs.
    expect(collapsed.id).toBe("c1");
    expect(collapsed.capturedAt).toBe("2026-08-28T00:01:25.000Z");
    expect(collapsed.dateLabel).toBe(formatOfferDate("2026-08-28T00:01:25.000Z"));
    expect(collapsed.screenshotHref).toBe(
      `/artifacts/proof/${encodeURIComponent(SCREENSHOT_A)}`,
    );
    expect(collapsed.pageTextHref).toBe(`/artifacts/page-text/${encodeURIComponent(HTML_A)}`);
    // Honest zero-change: no transition, first state on record.
    expect(collapsed.transition).toBeNull();
    // Run extent names the last capture.
    expect(collapsed.runExtentLabel).toBe(
      `unchanged since ${formatOfferDate("2026-08-28T00:02:19.000Z")}`,
    );
  });

  it("collapses identical captures that share the same second (adspyder 3 same-second)", () => {
    const ledger = buildOfferLedger([
      snapshot({
        id: "a1",
        capturedAt: "2026-09-01T09:00:41.000Z",
        headline: "Adspyder",
        ctaText: "Start free trial",
        formPresent: true,
        screenshotKey: SCREENSHOT_A,
        pageTextKey: HTML_A,
      }),
      snapshot({
        id: "a2",
        capturedAt: "2026-09-01T09:00:41.000Z",
        headline: "Adspyder",
        ctaText: "Start free trial",
        formPresent: true,
      }),
      snapshot({
        id: "a3",
        capturedAt: "2026-09-01T09:00:41.000Z",
        headline: "Adspyder",
        ctaText: "Start free trial",
        formPresent: true,
      }),
      snapshot({
        id: "a4",
        capturedAt: "2026-09-01T09:00:42.000Z",
        headline: "Adspyder",
        ctaText: "Start free trial",
        formPresent: true,
      }),
    ]);

    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.runExtentLabel).toBe(
      `unchanged since ${formatOfferDate("2026-09-01T09:00:42.000Z")}`,
    );
  });

  it("preserves a real before/after transition across an identical burst before a change", () => {
    const ledger = buildOfferLedger([
      snapshot({
        id: "b1",
        capturedAt: "2026-08-28T00:00:10.000Z",
        headline: "Old headline",
        ctaText: "Learn more",
        formPresent: false,
        screenshotKey: SCREENSHOT_A,
        pageTextKey: HTML_A,
      }),
      snapshot({
        id: "b2",
        capturedAt: "2026-08-28T00:01:00.000Z",
        headline: "Brand Scaling Call - Adflex Digital",
        ctaText: "Show more",
        formPresent: false,
        screenshotKey: SCREENSHOT_B,
        pageTextKey: HTML_B,
      }),
      snapshot({
        id: "b3",
        capturedAt: "2026-08-28T00:02:19.000Z",
        headline: "Brand Scaling Call - Adflex Digital",
        ctaText: "Show more",
        formPresent: false,
      }),
    ]);

    // b2/b3 are identical and collapse; b1 is distinct.
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.id).toBe("b1");
    expect(ledger[0]?.runExtentLabel).toBeNull();
    expect(ledger[1]?.id).toBe("b2");
    expect(ledger[1]?.runExtentLabel).toBe(
      `unchanged since ${formatOfferDate("2026-08-28T00:02:19.000Z")}`,
    );
    // The real field change still renders as a before/after transition.
    expect(ledger[1]?.transition).toEqual({
      headline: { before: "Old headline", after: "Brand Scaling Call - Adflex Digital" },
      ctaText: { before: "Learn more", after: "Show more" },
      priceText: null,
      formPresent: null,
    });
  });

  it("keeps a mid-sequence change visible as two states and a transition (mixed burst-then-change)", () => {
    const ledger = buildOfferLedger([
      snapshot({
        id: "m1",
        capturedAt: "2026-08-28T00:01:25.000Z",
        headline: "Launch price",
        ctaText: "Buy now",
        priceText: "₹199",
        formPresent: true,
        screenshotKey: SCREENSHOT_A,
        pageTextKey: HTML_A,
      }),
      snapshot({
        id: "m2",
        capturedAt: "2026-08-28T00:01:40.000Z",
        headline: "Launch price",
        ctaText: "Buy now",
        priceText: "₹199",
        formPresent: true,
      }),
      snapshot({
        id: "m3",
        capturedAt: "2026-08-28T00:01:54.000Z",
        headline: "Launch price",
        ctaText: "Buy now",
        priceText: "₹299",
        formPresent: true,
        screenshotKey: SCREENSHOT_B,
        pageTextKey: HTML_B,
      }),
    ]);

    // m1/m2 identical collapse to one; m3 changes the price.
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.id).toBe("m1");
    expect(ledger[0]?.runExtentLabel).toBe(
      `unchanged since ${formatOfferDate("2026-08-28T00:01:40.000Z")}`,
    );
    expect(ledger[1]?.id).toBe("m3");
    expect(ledger[1]?.runExtentLabel).toBeNull();
    expect(ledger[1]?.transition?.priceText).toEqual({ before: "₹199", after: "₹299" });
  });

  it("renders singleton dated states with no run-extent label", () => {
    const ledger = buildOfferLedger([
      snapshot({ id: "s1", capturedAt: "2026-08-01T10:00:00.000Z", headline: "A" }),
      snapshot({ id: "s2", capturedAt: "2026-08-10T10:00:00.000Z", headline: "B" }),
    ]);
    expect(ledger.map((entry) => entry.runExtentLabel)).toEqual([null, null]);
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
