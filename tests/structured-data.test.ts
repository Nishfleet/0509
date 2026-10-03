import { describe, it, expect } from "vitest";
import {
  organizationJsonLd,
  websiteJsonLd,
  softwareApplicationJsonLd,
  faqPageJsonLd,
  breadcrumbJsonLd,
  jsonLdGraph,
} from "../app/lib/structured-data";
import { PLANS } from "../app/lib/billing/plans";

describe("structured-data JSON-LD builders", () => {
  const ORG_ID = "https://0509.io/#organization";

  it("organizationJsonLd emits stable @id and websiteJsonLd references it as publisher", () => {
    expect(organizationJsonLd()["@id"]).toBe(ORG_ID);
    expect(websiteJsonLd().publisher).toEqual({ "@id": ORG_ID });
  });

  it("softwareApplicationJsonLd returns provided features and one Offer per plan with EUR pricing", () => {
    const features = ["a", "b"] as const;
    const result = softwareApplicationJsonLd(features);

    expect(result.featureList).toEqual(["a", "b"]);
    expect(result.offers).toHaveLength(PLANS.length);

    for (let i = 0; i < PLANS.length; i++) {
      const plan = PLANS[i];
      const offer = result.offers[i];

      expect(offer["@type"]).toBe("Offer");
      expect(offer.name).toBe(plan.name);
      expect(offer.price).toBe(plan.monthlyPriceEur.toFixed(2));
      expect(offer.priceCurrency).toBe("EUR");
      expect(offer.priceSpecification).toEqual({
        "@type": "UnitPriceSpecification",
        price: plan.monthlyPriceEur.toFixed(2),
        priceCurrency: "EUR",
        unitCode: "MON",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
      });
      expect(offer.url).toBe("https://0509.io/");
    }
  });

  it("faqPageJsonLd maps entries to Question with acceptedAnswer", () => {
    const entries = [{ question: "Q", answer: "A" }] as const;
    const result = faqPageJsonLd(entries);

    expect(result["@type"]).toBe("FAQPage");
    expect(result.mainEntity).toHaveLength(1);
    expect(result.mainEntity[0]).toEqual({
      "@type": "Question",
      name: "Q",
      acceptedAnswer: { "@type": "Answer", text: "A" },
    });
  });

  it("breadcrumbJsonLd numbers position from 1 and prefixes item with site URL", () => {
    const items = [
      { name: "Home", path: "/" },
      { name: "Pricing", path: "/pricing" },
    ] as const;
    const result = breadcrumbJsonLd(items);

    expect(result["@type"]).toBe("BreadcrumbList");
    expect(result.itemListElement).toHaveLength(2);
    expect(result.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://0509.io/",
    });
    expect(result.itemListElement[1]).toEqual({
      "@type": "ListItem",
      position: 2,
      name: "Pricing",
      item: "https://0509.io/pricing",
    });
  });

  it("jsonLdGraph wraps nodes in @context and @graph", () => {
    const node = { "@type": "Thing", name: "Test" };
    const result = jsonLdGraph([node]);

    expect(result).toEqual({
      "@context": "https://schema.org",
      "@graph": [node],
    });
  });
});
