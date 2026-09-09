import { describe, expect, it } from "vitest";

import { itemListJsonLd } from "~/lib/seo";

describe("itemListJsonLd (issue #2067)", () => {
  const items = [
    { name: "Nike", url: "https://0509.io/ads/nike.com" },
    { name: "Adidas", url: "https://0509.io/ads/adidas.com" },
    { name: "H&M", url: "https://0509.io/ads/hm.com" },
  ];

  it("emits a schema.org ItemList with the page's canonical URL", () => {
    const jsonLd = itemListJsonLd({
      name: "E-commerce brands",
      pathname: "/brands/e-commerce/",
      items,
    });

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("ItemList");
    expect(jsonLd.name).toBe("E-commerce brands");
    // canonicalUrl path: trailing slash trimmed, origin prefixed.
    expect(jsonLd.url).toBe("https://0509.io/brands/e-commerce");
  });

  it("numbers ListItems 1..n in the given order with name and item url", () => {
    const { itemListElement } = itemListJsonLd({
      name: "E-commerce brands",
      pathname: "/brands/e-commerce",
      items,
    });

    expect(itemListElement).toHaveLength(3);
    expect(itemListElement.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Nike",
      item: "https://0509.io/ads/nike.com",
    });
    // Item URLs are passed through untouched — the builder never rewrites
    // a canonical /ads/:domain link it was handed.
    expect(itemListElement.map((entry) => entry.item)).toEqual(
      items.map((item) => item.url),
    );
  });

  it("renders an empty curated group as an ItemList with no items", () => {
    const jsonLd = itemListJsonLd({
      name: "Empty category",
      pathname: "/brands/saas-software",
      items: [],
    });

    expect(jsonLd["@type"]).toBe("ItemList");
    expect(jsonLd.itemListElement).toEqual([]);
  });
});
