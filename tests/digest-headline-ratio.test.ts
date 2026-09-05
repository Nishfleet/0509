import { describe, expect, it } from "vitest";

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
});
