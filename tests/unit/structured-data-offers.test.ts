import { describe, expect, it } from "vitest";

import { PLANS } from "../../app/lib/billing/plans";
import { FAQ } from "../../app/lib/faq";
import {
  faqPageJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "../../app/lib/structured-data";

describe("softwareApplicationJsonLd", () => {
  it("prices one Offer per plan from the plan module", () => {
    const node = softwareApplicationJsonLd();
    expect(node.offers).toHaveLength(PLANS.length);
    node.offers.forEach((offer, index) => {
      expect(offer.name).toBe(PLANS[index]?.name);
      expect(offer.price).toBe(PLANS[index]?.monthlyPriceEur.toFixed(2));
      expect(offer.priceCurrency).toBe("EUR");
    });
    expect(node.offers.map((offer) => offer.price)).toEqual(["10.00", "46.00", "136.00"]);
  });

  it("claims no rating or review", () => {
    const node = softwareApplicationJsonLd();
    expect(node).not.toHaveProperty("aggregateRating");
    expect(node).not.toHaveProperty("review");
  });
});

describe("websiteJsonLd", () => {
  it("names the site and points at the organization", () => {
    expect(websiteJsonLd()).toMatchObject({
      "@type": "WebSite",
      url: "https://0509.io",
      publisher: { "@id": "https://0509.io/#organization" },
    });
  });
});

describe("faqPageJsonLd", () => {
  it("carries every visible question with its answer, word for word", () => {
    const node = faqPageJsonLd(FAQ);
    expect(node.mainEntity).toHaveLength(FAQ.length);
    node.mainEntity.forEach((question, index) => {
      expect(question.name).toBe(FAQ[index]?.question);
      expect(question.acceptedAnswer.text).toBe(FAQ[index]?.answer);
    });
  });

  it("never says free, because there is no free plan (DESIGN.md §5, #3896)", () => {
    for (const entry of FAQ) {
      expect(`${entry.question} ${entry.answer}`).not.toMatch(/\bfree\b/i);
    }
  });
});
