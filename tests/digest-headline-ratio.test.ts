import { describe, expect, it } from "vitest";

// @ts-expect-error plain .mjs ops script — no type declarations; the parity
// assertions below are the contract.
import {
  buildSampleQuery,
  eventTypesFromCountRows,
  measure as canaryMeasure,
  rollingSignal as canaryRollingSignal,
} from "../scripts/canary-digest-headline-ratio.mjs";
import {
  DIGEST_HEADLINE_GUARD_RATIO,
  DIGEST_HEADLINE_ROLLING_DAYS,
  DIGEST_HEADLINE_TARGET_RATIO,
  headlineRatioSignal,
  measureDigestHeadline,
  type DigestHeadlineMeasurement,
} from "~/lib/digest-headline-ratio";
import type { DigestRerankItem } from "~/lib/digest-rerank";

function item(
  eventType: string,
  eventId = `ev-${eventType}-${Math.random()}`,
): DigestRerankItem {
  return { eventType, metadata: { eventId } };
}

function allLandingPage(
  count: number,
  eventType = "landing_page_offer_changed",
): DigestRerankItem[] {
  return Array.from({ length: count }, (_, i) => item(eventType, `lp-${i}`));
}

function measurement(
  periodStart: string,
  ratio: number,
): DigestHeadlineMeasurement {
  return {
    periodStart,
    headlineItemCount: 10,
    landingPageCount: Math.round(ratio * 10),
    adChurnCount: 0,
    ratio,
  };
}

describe("digest.headline.ratio — measureDigestHeadline", () => {
  it("counts every landing_page_* item as a headline and churn as a collapsed count", () => {
    const m = measureDigestHeadline(
      [
        item("landing_page_offer_changed", "offer-1"),
        item("landing_page_cta_changed", "cta-1"),
        item("landing_page_headline_changed", "headline-1"),
        item("ad_new", "ad-1"),
        item("ad_inactive", "ad-2"),
      ],
      "2026-08-30",
    );

    expect(m.landingPageCount).toBe(3);
    expect(m.headlineItemCount).toBe(3); // churn is collapsed, not headlined
    expect(m.adChurnCount).toBe(2);
    expect(m.ratio).toBe(1);
  });

  it("reports a landing-page-only fixture at the 1.0 headline ratio", () => {
    const m = measureDigestHeadline(allLandingPage(6), "2026-08-30");
    expect(m.landingPageCount).toBe(6);
    expect(m.headlineItemCount).toBe(6);
    expect(m.ratio).toBe(1);
  });

  it("drops the ratio when non-landing-page items leak into the headline stream", () => {
    const m = measureDigestHeadline(
      [
        item("landing_page_offer_changed", "offer-1"),
        item("landing_page_cta_changed", "cta-1"),
        item("website_page_changed", "page-1"),
        item("website_page_changed", "page-2"),
      ],
      "2026-08-30",
    );
    expect(m.landingPageCount).toBe(2);
    expect(m.headlineItemCount).toBe(4);
    expect(m.ratio).toBe(0.5);
  });

  it("never lets creative churn appear in the denominator of the headline ratio", () => {
    const m = measureDigestHeadline(
      [item("ad_new", "ad-1"), item("ad_new", "ad-2"), item("ad_inactive", "ad-3")],
      "2026-08-30",
    );
    expect(m.adChurnCount).toBe(3);
    expect(m.headlineItemCount).toBe(0);
    expect(m.ratio).toBe(0);
  });

  it("reports ratio 0 for an empty period rather than crashing", () => {
    const m = measureDigestHeadline([], "2026-08-30");
    expect(m.headlineItemCount).toBe(0);
    expect(m.ratio).toBe(0);
  });
});

describe("brief.headline.signal — headlineRatioSignal 7-day rolling guard", () => {
  it("meets the 60% target when every sampled day is landing-page-heavy", () => {
    const days = Array.from({ length: DIGEST_HEADLINE_ROLLING_DAYS }, (_, i) =>
      measurement(`2026-08-${String(30 - i).padStart(2, "0")}`, 1),
    );
    const signal = headlineRatioSignal(days);
    expect(signal.sampledDays).toBe(DIGEST_HEADLINE_ROLLING_DAYS);
    expect(signal.rollingRatio).toBe(1);
    expect(signal.targetMet).toBe(true);
    expect(signal.guardFired).toBe(false);
  });

  it("fires the guard when the 7-day rolling ratio drops below 50%", () => {
    const days = Array.from({ length: DIGEST_HEADLINE_ROLLING_DAYS }, (_, i) =>
      measurement(`2026-08-${String(30 - i).padStart(2, "0")}`, 0.4),
    );
    const signal = headlineRatioSignal(days);
    expect(signal.rollingRatio).toBeLessThan(DIGEST_HEADLINE_GUARD_RATIO);
    expect(signal.guardFired).toBe(true);
  });

  it("does not fire the guard at exactly the 50% floor", () => {
    const days = Array.from({ length: DIGEST_HEADLINE_ROLLING_DAYS }, (_, i) =>
      measurement(`2026-08-${String(30 - i).padStart(2, "0")}`, DIGEST_HEADLINE_GUARD_RATIO),
    );
    expect(headlineRatioSignal(days).guardFired).toBe(false);
  });

  it("rolls over only the most recent 7 measured days", () => {
    const old = Array.from({ length: 14 }, (_, i) =>
      measurement(`2026-08-${String(30 - i).padStart(2, "0")}`, 0),
    );
    const recent = Array.from({ length: 7 }, (_, i) =>
      measurement(`2026-09-${String(1 + i).padStart(2, "0")}`, 1),
    );
    const signal = headlineRatioSignal([...old, ...recent]);
    expect(signal.sampledDays).toBe(DIGEST_HEADLINE_ROLLING_DAYS);
    expect(signal.rollingRatio).toBe(1);
    expect(signal.guardFired).toBe(false);
  });

  it("never fires on an empty history — nothing has regressed yet", () => {
    const signal = headlineRatioSignal([]);
    expect(signal.sampledDays).toBe(0);
    expect(signal.guardFired).toBe(false);
  });

  it("keeps days with zero headline-stream items out of the rolling mean", () => {
    // A churn-only day is the common case, not a regression: the brief
    // correctly collapsed every item into the counted footnote. Counting it
    // as ratio 0 would false-fire the guard on real data.
    const churnOnlyDay = measurement("2026-09-01", 0);
    churnOnlyDay.headlineItemCount = 0;
    churnOnlyDay.landingPageCount = 0;
    churnOnlyDay.adChurnCount = 12;
    const healthy = Array.from({ length: DIGEST_HEADLINE_ROLLING_DAYS }, (_, i) =>
      measurement(`2026-09-${String(2 + i).padStart(2, "0")}`, 1),
    );
    const signal = headlineRatioSignal([churnOnlyDay, ...healthy]);
    expect(signal.sampledDays).toBe(DIGEST_HEADLINE_ROLLING_DAYS);
    expect(signal.rollingRatio).toBe(1);
    expect(signal.guardFired).toBe(false);
  });
});

describe("digest.headline.ratio — scheduled canary mirror (scripts/canary-digest-headline-ratio.mjs)", () => {
  // The ops canary is plain .mjs and cannot import the TS rerank module, so it
  // mirrors the classification. These tests pin the mirror against the real
  // builder path so the two cannot silently drift.

  it("classifies a mixed fixture identically to the real rerank", () => {
    const eventTypes = [
      "landing_page_offer_changed",
      "landing_page_cta_changed",
      "landing_page_url_changed",
      "landing_page_headline_changed",
      "landing_page_form_changed",
      "ad_new",
      "ad_new",
      "ad_inactive",
      "website_page_changed",
    ];
    const scriptMeasure = canaryMeasure(eventTypes, "2026-09-05");
    const libMeasure = measureDigestHeadline(
      eventTypes.map((eventType, i) => item(eventType, `ev-${i}`)),
      "2026-09-05",
    );
    expect(scriptMeasure.landingPageCount).toBe(libMeasure.landingPageCount);
    expect(scriptMeasure.headlineItemCount).toBe(libMeasure.headlineItemCount);
    expect(scriptMeasure.adChurnCount).toBe(libMeasure.adChurnCount);
    expect(scriptMeasure.ratio).toBe(libMeasure.ratio);
  });

  it("applies the same rolling-window rule as the lib (vacuous days excluded)", () => {
    const series = [
      { periodStart: "2026-08-30", headlineItemCount: 0, landingPageCount: 0, adChurnCount: 9, ratio: 0 },
      ...Array.from({ length: 7 }, (_, i) => ({
        periodStart: `2026-08-${String(31 - i).padStart(2, "0")}`,
        headlineItemCount: 8,
        landingPageCount: 8,
        adChurnCount: 2,
        ratio: 1,
      })),
    ];
    const scriptSignal = canaryRollingSignal(series);
    const libSignal = headlineRatioSignal(
      series.map((m) => ({
        periodStart: m.periodStart,
        headlineItemCount: m.headlineItemCount,
        landingPageCount: m.landingPageCount,
        adChurnCount: m.adChurnCount,
        ratio: m.ratio,
      })),
    );
    expect(scriptSignal.guardFired).toBe(libSignal.guardFired);
    expect(scriptSignal.rollingRatio).toBeCloseTo(libSignal.rollingRatio, 6);
    expect(scriptSignal.sampledDays).toBe(libSignal.sampledDays);
  });

  it("samples the last window of DELIVERED digest items, not raw watch events", () => {
    const cutoff = "2026-09-04T09:53:00.000Z";
    const query = buildSampleQuery(cutoff);
    // The measurement surface is digest_item (the persisted cohort) gated by a
    // sent delivery_attempt — EXISTS so multi-channel delivery cannot
    // double-count a run's items.
    expect(query).toContain("FROM digest_item");
    expect(query).toContain("delivery_attempt");
    expect(query).toContain("da.status = 'sent'");
    expect(query).toContain("da.lane = 'customer'");
    expect(query).toContain(cutoff);
    expect(query).not.toContain("FROM watch_event");
  });

  it("expands aggregate count rows back into the exact item mix", () => {
    const eventTypes = eventTypesFromCountRows([
      { event_type: "landing_page_cta_changed", n: 3 },
      { event_type: "ad_new", n: 2 },
      { event_type: "landing_page_offer_changed", n: 1 },
      { event_type: "", n: 4 },
      { event_type: "ad_inactive", n: 0 },
    ]);
    expect(eventTypes).toEqual([
      "landing_page_cta_changed",
      "landing_page_cta_changed",
      "landing_page_cta_changed",
      "ad_new",
      "ad_new",
      "landing_page_offer_changed",
    ]);
  });
});
