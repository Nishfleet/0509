import { describe, expect, it } from "vitest";

import {
  buildOfferLedger,
  type OfferSnapshotInput,
} from "~/lib/offer-timeline";
import {
  buildChangeHistoryPayload,
  buildDiffOfferPayload,
  buildListSuppressedPayload,
  buildOfferStateAtPayload,
  OFFER_NO_HISTORY_MESSAGE,
} from "~/lib/offer-timeline-agent-tools";

const ORIGIN = "https://0509.io";
const DOMAIN = "nykaa.com";
const SCREENSHOT_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const SCREENSHOT_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpeg";
const SCREENSHOT_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.jpeg";
const HTML_A = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";
const HTML_B = "landing-pages/2026-08-10/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.html";
const HTML_C = "landing-pages/2026-08-20/cccccccccccccccccccccccccccccccc.html";

function snapshot(overrides: Partial<OfferSnapshotInput> & Pick<OfferSnapshotInput, "id" | "capturedAt">): OfferSnapshotInput {
  return {
    canonicalUrl: `https://${DOMAIN}/glow`,
    headline: "Glow serum",
    ctaText: "Shop now",
    priceText: "₹499",
    formPresent: true,
    screenshotKey: SCREENSHOT_A,
    pageTextKey: HTML_A,
    captureMethod: "landing_page_fetch",
    evidenceNote: null,
    ...overrides,
  };
}

/**
 * The three dated snapshot rows the issue's tool-level fixture describes:
 * day1 "Glow serum / Shop now / ₹499", day2 "Festive glow kit / Get the kit /
 * ₹799", day3 "Festive glow kit / Get the kit / ₹599" — the same shape the
 * offer-timeline integration test seeds against real D1.
 */
function threeDatedRows() {
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
      captureMethod: "sitemap_brand_seed",
    }),
  ]);
  return ledger;
}

describe("get_change_history payload", () => {
  it("returns every dated state with change, timestamp, source provider, and evidence links", () => {
    const payload = buildChangeHistoryPayload(DOMAIN, threeDatedRows(), null, ORIGIN);
    expect(payload.tool).toBe("get_change_history");
    expect(payload.status).toBe("ok");
    expect(payload.since).toBeNull();
    expect(payload.entries).toHaveLength(3);
    expect(payload.entries.map((entry) => entry.dateLabel)).toEqual([
      "1 Aug 2026",
      "10 Aug 2026",
      "20 Aug 2026",
    ]);
    expect(payload.entries[0]?.changes).toBeNull();
    expect(payload.entries[1]?.changes).toEqual([
      { field: "headline", before: "Glow serum", after: "Festive glow kit" },
      { field: "ctaText", before: "Shop now", after: "Get the kit" },
      { field: "priceText", before: "₹499", after: "₹799" },
    ]);
    expect(payload.entries[1]?.sourceProvider).toBe("landing_page_fetch");
    expect(payload.entries[2]?.sourceProvider).toBe("sitemap_brand_seed");
    expect(payload.entries[1]?.evidence).toEqual({
      timelineUrl: `${ORIGIN}/timeline/${DOMAIN}?asOf=2026-08-10`,
      screenshotHref: `/artifacts/proof/${encodeURIComponent(SCREENSHOT_B)}`,
      pageTextHref: `/artifacts/page-text/${encodeURIComponent(HTML_B)}`,
    });
  });

  it("filters to states captured on or after a since date", () => {
    const payload = buildChangeHistoryPayload(DOMAIN, threeDatedRows(), "2026-08-10", ORIGIN);
    expect(payload.status).toBe("ok");
    expect(payload.entries.map((entry) => entry.capturedAt.slice(0, 10))).toEqual([
      "2026-08-10",
      "2026-08-20",
    ]);
  });

  it("reports the documented no-history payload for an unknown domain, never an error", () => {
    const payload = buildChangeHistoryPayload("unknown.example", [], null, ORIGIN);
    expect(payload.status).toBe("no_history");
    expect(payload.message).toBe(OFFER_NO_HISTORY_MESSAGE);
    expect(payload.entries).toEqual([]);
  });
});

describe("get_offer_state_at payload", () => {
  it("returns the latest stored state on or before the requested date", () => {
    const payload = buildOfferStateAtPayload(DOMAIN, threeDatedRows(), "2026-08-15", ORIGIN);
    expect(payload.tool).toBe("get_offer_state_at");
    expect(payload.status).toBe("ok");
    expect(payload.state?.capturedAt).toBe("2026-08-10T10:00:00.000Z");
    expect(payload.state?.headline).toBe("Festive glow kit");
    expect(payload.state?.priceText).toBe("₹799");
    expect(payload.state?.evidence.timelineUrl).toBe(`${ORIGIN}/timeline/${DOMAIN}?asOf=2026-08-10`);
  });

  it("accepts an exact capture date", () => {
    const payload = buildOfferStateAtPayload(DOMAIN, threeDatedRows(), "2026-08-10", ORIGIN);
    expect(payload.state?.capturedAt).toBe("2026-08-10T10:00:00.000Z");
  });

  it("reports no_state_on_date before the first capture and no_history with no rows", () => {
    const early = buildOfferStateAtPayload(DOMAIN, threeDatedRows(), "2026-07-01", ORIGIN);
    expect(early.status).toBe("no_state_on_date");
    expect(early.state).toBeNull();
    expect(early.message).toContain("no stored capture on or before 2026-07-01");

    const empty = buildOfferStateAtPayload(DOMAIN, [], "2026-07-01", ORIGIN);
    expect(empty.status).toBe("no_history");
    expect(empty.message).toBe(OFFER_NO_HISTORY_MESSAGE);
  });
});

describe("diff_offer payload", () => {
  it("returns the before/after states and only the fields that changed, with evidence links", () => {
    const payload = buildDiffOfferPayload(DOMAIN, threeDatedRows(), "2026-08-01", "2026-08-20", ORIGIN);
    expect(payload.tool).toBe("diff_offer");
    expect(payload.status).toBe("ok");
    expect(payload.before?.capturedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(payload.after?.capturedAt).toBe("2026-08-20T10:00:00.000Z");
    expect(payload.changes).toEqual([
      { field: "headline", before: "Glow serum", after: "Festive glow kit" },
      { field: "ctaText", before: "Shop now", after: "Get the kit" },
      { field: "priceText", before: "₹499", after: "₹599" },
    ]);
    expect(payload.before?.evidence.timelineUrl).toBe(`${ORIGIN}/timeline/${DOMAIN}?asOf=2026-08-01`);
    expect(payload.after?.evidence.timelineUrl).toBe(`${ORIGIN}/timeline/${DOMAIN}?asOf=2026-08-20`);
    expect(payload.after?.evidence.pageTextHref).toBe(`/artifacts/page-text/${encodeURIComponent(HTML_C)}`);
  });

  it("orders by date and returns an empty change list when both dates resolve to the same state", () => {
    const payload = buildDiffOfferPayload(DOMAIN, threeDatedRows(), "2026-08-20", "2026-08-01", ORIGIN);
    expect(payload.status).toBe("ok");
    expect(payload.before?.capturedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(payload.after?.capturedAt).toBe("2026-08-20T10:00:00.000Z");

    const same = buildDiffOfferPayload(DOMAIN, threeDatedRows(), "2026-08-10", "2026-08-12", ORIGIN);
    expect(same.status).toBe("ok");
    expect(same.before?.capturedAt).toBe(same.after?.capturedAt);
    expect(same.changes).toEqual([]);
  });

  it("reports no_history with no rows and no_state_on_date when a date has no capture", () => {
    const empty = buildDiffOfferPayload(DOMAIN, [], "2026-08-01", "2026-08-20", ORIGIN);
    expect(empty.status).toBe("no_history");
    expect(empty.message).toBe(OFFER_NO_HISTORY_MESSAGE);

    const partial = buildDiffOfferPayload(DOMAIN, threeDatedRows(), "2026-07-01", "2026-08-20", ORIGIN);
    expect(partial.status).toBe("no_state_on_date");
    expect(partial.changes).toBeNull();
  });
});

describe("list_suppressed payload", () => {
  it("lists stored rows withheld from the public timeline with their reason", () => {
    const payload = buildListSuppressedPayload(DOMAIN, [
      {
        id: "backfill-1",
        canonicalUrl: `https://${DOMAIN}/glow`,
        capturedAt: "2026-08-01T10:00:00.000Z",
        reason: "seeded backfill row with no screenshot or page-text artifact",
      },
    ]);
    expect(payload.tool).toBe("list_suppressed");
    expect(payload.status).toBe("ok");
    expect(payload.suppressed).toEqual([
      {
        id: "backfill-1",
        canonicalUrl: `https://${DOMAIN}/glow`,
        capturedAt: "2026-08-01T10:00:00.000Z",
        reason: "seeded backfill row with no screenshot or page-text artifact",
      },
    ]);
  });

  it("returns a documented empty payload when no suppressed rows are stored", () => {
    const payload = buildListSuppressedPayload(DOMAIN, []);
    expect(payload.status).toBe("no_history");
    expect(payload.suppressed).toEqual([]);
    expect(payload.message).toContain("no suppressed snapshot rows stored");
  });
});