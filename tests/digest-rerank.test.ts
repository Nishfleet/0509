import { describe, expect, it } from "vitest";

import {
  adChurnFootnoteLine,
  isAdChurnEventType,
  isLandingPageHeadlineEventType,
  rerankDigestBrief,
  whyThisMattersScore,
  type DigestRerankItem,
} from "~/lib/digest-rerank";

function item(
  eventType: string,
  priorityScore: number,
  eventId = `ev-${eventType}-${priorityScore}`,
): DigestRerankItem {
  return { eventType, metadata: { priorityScore, eventId } };
}

describe("digest-rerank — event type classification", () => {
  it("treats ad_new and ad_inactive as creative churn", () => {
    expect(isAdChurnEventType("ad_new")).toBe(true);
    expect(isAdChurnEventType("ad_inactive")).toBe(true);
    expect(isAdChurnEventType("landing_page_offer_changed")).toBe(false);
    expect(isAdChurnEventType(undefined)).toBe(false);
  });

  it("treats the five landing_page_* types as headline candidates", () => {
    expect(isLandingPageHeadlineEventType("landing_page_offer_changed")).toBe(true);
    expect(isLandingPageHeadlineEventType("landing_page_cta_changed")).toBe(true);
    expect(isLandingPageHeadlineEventType("landing_page_url_changed")).toBe(true);
    expect(isLandingPageHeadlineEventType("landing_page_headline_changed")).toBe(true);
    expect(isLandingPageHeadlineEventType("landing_page_form_changed")).toBe(true);
    expect(isLandingPageHeadlineEventType("ad_new")).toBe(false);
    expect(isLandingPageHeadlineEventType(undefined)).toBe(false);
  });
});

describe("digest-rerank — why-this-matters score", () => {
  it("weights offer/price changes above every other commercial-field change", () => {
    const offer = whyThisMattersScore(item("landing_page_offer_changed", 50));
    const cta = whyThisMattersScore(item("landing_page_cta_changed", 50));
    const destination = whyThisMattersScore(item("landing_page_url_changed", 50));
    const headline = whyThisMattersScore(item("landing_page_headline_changed", 50));
    const form = whyThisMattersScore(item("landing_page_form_changed", 50));

    expect(offer).toBeGreaterThan(cta);
    expect(cta).toBeGreaterThan(destination);
    expect(destination).toBeGreaterThan(headline);
    expect(headline).toBeGreaterThan(form);
  });

  it("lets a high-importance offer change beat a low-importance offer change", () => {
    expect(whyThisMattersScore(item("landing_page_offer_changed", 95))).toBeGreaterThan(
      whyThisMattersScore(item("landing_page_offer_changed", 55)),
    );
  });

  it("never lets creative churn outrank a commercial-field change", () => {
    // A max-score ad_new (creative churn) must score below a min-score offer
    // change — type dominates, so churn never becomes the brief's lead.
    expect(whyThisMattersScore(item("landing_page_offer_changed", 0))).toBeGreaterThan(
      whyThisMattersScore(item("ad_new", 100)),
    );
  });

  it("scores creative churn and unknown types at the priority floor", () => {
    expect(whyThisMattersScore(item("ad_new", 76))).toBe(76);
    expect(whyThisMattersScore(item("ad_inactive", 60))).toBe(60);
    expect(whyThisMattersScore(item("website_page_changed", 40))).toBe(40);
  });
});

describe("digest-rerank — brief split", () => {
  it("collapses ad_new/ad_inactive into a counted summary and never headlines them", () => {
    const items = [
      item("ad_new", 90, "ad-1"),
      item("ad_new", 88, "ad-2"),
      item("ad_inactive", 60, "ad-3"),
      item("landing_page_offer_changed", 80, "offer-1"),
      item("landing_page_cta_changed", 70, "cta-1"),
    ];

    const rerank = rerankDigestBrief(items);

    expect(rerank.headlineItems.map((i) => i.metadata?.eventId)).toEqual([
      "offer-1",
      "cta-1",
    ]);
    expect(rerank.adChurnSummary).toEqual({ newCount: 2, retiredCount: 1, total: 3 });
    expect(rerank.otherItems).toHaveLength(0);
  });

  it("orders headline items by why-this-matters score with a stable tiebreak", () => {
    const items = [
      item("landing_page_form_changed", 90, "form-1"),
      item("landing_page_cta_changed", 50, "cta-1"),
      item("landing_page_offer_changed", 30, "offer-1"),
      item("landing_page_headline_changed", 95, "headline-1"),
    ];

    const rerank = rerankDigestBrief(items);

    // offer (lowest priorityScore) still leads because type dominates; then
    // cta, headline, form by type weight.
    expect(rerank.headlineItems.map((i) => i.metadata?.eventId)).toEqual([
      "offer-1",
      "cta-1",
      "headline-1",
      "form-1",
    ]);
  });

  it("keeps non-churn, non-headline items in otherItems, score-ordered", () => {
    const items = [
      item("website_page_changed", 40, "page-1"),
      item("website_page_changed", 70, "page-2"),
      item("landing_page_offer_changed", 80, "offer-1"),
      item("ad_new", 90, "ad-1"),
    ];

    const rerank = rerankDigestBrief(items);

    expect(rerank.headlineItems.map((i) => i.metadata?.eventId)).toEqual(["offer-1"]);
    expect(rerank.otherItems.map((i) => i.metadata?.eventId)).toEqual(["page-2", "page-1"]);
    expect(rerank.adChurnSummary.total).toBe(1);
  });

  it("returns empty headline and zero churn for an all-quiet set", () => {
    const rerank = rerankDigestBrief([]);
    expect(rerank.headlineItems).toEqual([]);
    expect(rerank.otherItems).toEqual([]);
    expect(rerank.adChurnSummary).toEqual({ newCount: 0, retiredCount: 0, total: 0 });
  });
});

describe("digest-rerank — churn footnote line", () => {
  it("formats new and retired counts into the counted line", () => {
    expect(
      adChurnFootnoteLine({ newCount: 3, retiredCount: 2, total: 5 }),
    ).toBe("3 new creatives, 2 retired — open the wall to see them.");
  });

  it("uses the singular creative when exactly one new ad", () => {
    expect(
      adChurnFootnoteLine({ newCount: 1, retiredCount: 0, total: 1 }),
    ).toBe("1 new creative — open the wall to see them.");
  });

  it("omits the new-creatives clause when only retirements happened", () => {
    expect(
      adChurnFootnoteLine({ newCount: 0, retiredCount: 4, total: 4 }),
    ).toBe("4 retired — open the wall to see them.");
  });

  it("returns null when there is no churn so callers render nothing", () => {
    expect(adChurnFootnoteLine({ newCount: 0, retiredCount: 0, total: 0 })).toBeNull();
  });
});
