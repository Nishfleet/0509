import { describe, expect, it } from "vitest";

// Issue #2039: through the actual /search route `meta`, a resolved
// single-competitor loaderData must stamp the competitor's encoded social card
// as og:image and name the brand, while an unresolved loaderData keeps the
// generic card. No D1 / no worker integration — pure route-meta unit test.
describe("/search route meta", () => {
  type MetaEntry = Record<string, unknown> & { property?: string; name?: string };

  it("stamps the branded card for a resolved single-competitor search", async () => {
    const { meta } = await import("~/routes/search");
    const head = (meta as (args?: unknown) => MetaEntry[])({
      loaderData: {
        competitorWebsite: {
          raw: "nykaa.com",
          host: "nykaa.com",
          displayName: "Nykaa",
        },
      },
    });

    const ogImage = head.find((e) => e.property === "og:image");
    const ogTitle = head.find((e) => e.property === "og:title");
    const ogDescription = head.find(
      (e) => e.property === "og:description" || e.name === "description",
    );
    const ogAlt = head.find((e) => e.property === "og:image:alt");

    expect(ogImage?.content).toBe(
      "https://0509.io/social-card/ads/nykaa.com.svg?n=Nykaa",
    );
    expect(ogTitle?.content).toContain("Nykaa Meta ads");
    expect(ogDescription?.content).toContain("Nykaa");
    expect(ogAlt?.content).toContain("Nykaa");
    expect(ogImage?.content).not.toContain("og-image.png");
  });

  it("keeps the generic card for an unresolved search", async () => {
    const { meta } = await import("~/routes/search");
    const head = (meta as (args?: unknown) => MetaEntry[])({
      loaderData: {
        competitorWebsite: {
          raw: "",
          host: null,
          displayName: null,
        },
      },
    });

    const ogImage = head.find((e) => e.property === "og:image");
    const ogTitle = head.find((e) => e.property === "og:title");

    expect(ogImage?.content).toBe("https://0509.io/og-image.png");
    expect(ogTitle?.content).toBe(
      "Search competitor Meta ads free | Five to Nine",
    );
  });
});
