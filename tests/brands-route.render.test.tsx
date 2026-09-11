import { createElement } from "react";
import { mockReactRouter } from "./helpers/mock-react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The default export reads `useLoaderData`; a mutable fixture lets each test
// render the route with a specific loader payload.
let currentData: { groups: Array<{ category: string; items: Array<{ domain: string; path: string; name: string; timelineIndexable?: boolean }> }>; allCount: number; categoryLinks: Array<{ slug: string; label: string; count: number }> };

beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loader: () => currentData,
    loaderData: () => undefined,
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function render(data: typeof currentData): Promise<string> {
  currentData = data;
  const { default: BrandsHubRoute } = await import("~/routes/brands");
  return renderToStaticMarkup(createElement(BrandsHubRoute));
}

const links = [
  { domain: "nike.com", path: "/ads/nike.com", name: "Nike" },
  { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas" },
  { domain: "asos.com", path: "/ads/asos.com", name: "ASOS" },
  { domain: "hm.com", path: "/ads/hm.com", name: "H&M" },
  { domain: "hubspot.com", path: "/ads/hubspot.com", name: "HubSpot" },
  { domain: "myexamplebrand.com", path: "/ads/myexamplebrand.com", name: "Myexamplebrand" },
];

function grouped() {
  return {
    allCount: links.length,
    groups: [
      { category: "Sport & footwear", items: [links[0], links[1]] },
      { category: "E-commerce", items: [links[2], links[3]] },
      { category: "SaaS & software", items: [links[4]] },
      { category: "More brands", items: [links[5]] },
    ],
    categoryLinks: [
      { slug: "sport-footwear", label: "Sport & footwear", count: 2 },
      { slug: "e-commerce", label: "E-commerce", count: 2 },
      { slug: "saas-software", label: "SaaS & software", count: 1 },
    ],
  };
}

describe("/brands hub — links every indexable /ads/:domain page (issue #1417)", () => {
  it("links EVERY brand page in the indexable set, categorized", async () => {
    const markup = await render(grouped());

    for (const link of links) {
      expect(markup).toContain(`href="${link.path}"`);
      expect(markup).toContain(link.name.replaceAll("&", "&amp;"));
    }
    expect(markup).toContain("Browse all 6 tracked brands");
    // Categories render as headings (HTML-escaped for names with &).
    for (const group of grouped().groups) {
      expect(markup).toContain(group.category.replaceAll("&", "&amp;"));
    }
  });

  it("asserts the orphan guarantee: every listed /ads page also appears here as a cross-link source", async () => {
    const markup = await render(grouped());
    // Every /ads path linked at least once (the hub is the browse surface
    // that gives the sitemap orphan pages an internal-link graph).
    const adsHrefs = markup.match(/href="\/ads\/[^"]*"/g) ?? [];
    for (const link of links) {
      const href = `href="${link.path}"`;
      expect(adsHrefs.filter((h) => h === href).length).toBeGreaterThan(0);
    }
  });

  it("renders an honest empty state when no brand pages are indexed, never a broken grid", async () => {
    const markup = await render({ allCount: 0, groups: [], categoryLinks: [] });
    expect(markup).toContain("No brand pages are indexed right now");
    expect(markup).not.toContain("ld-brands-groups");
  });

  it("links the Offer Timeline for a brand whose /timeline/:domain is indexable (issue #1931)", async () => {
    // A brand whose timeline is in the sitemap's indexable set gets an
    // "Offer timeline" link next to its /ads page on the hub.
    const markup = await render({
      allCount: 2,
      groups: [
        {
          category: "Sport & footwear",
          items: [
            { domain: "nike.com", path: "/ads/nike.com", name: "Nike", timelineIndexable: true },
            { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas", timelineIndexable: false },
          ],
        },
      ],
      categoryLinks: [
        { slug: "sport-footwear", label: "Sport & footwear", count: 2 },
      ],
    });

    expect(markup).toContain('href="/timeline/nike.com"');
    expect(markup).toContain("Offer timeline");
    // A non-qualifying domain must NOT get a timeline link (would point at a
    // 410/empty timeline).
    expect(markup).not.toContain('href="/timeline/adidas.com"');
  });

  it("emits an ItemList JSON-LD with one ListItem per tracked brand, each linking its /ads/:domain canonical URL (issue #2215)", async () => {
    const markup = await render(grouped());

    const blocks = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1] ?? "") as Record<string, unknown>,
    );

    const itemLists = blocks.filter((block) => block["@type"] === "ItemList");
    expect(itemLists).toHaveLength(1);

    const itemList = itemLists[0] ?? {};
    expect(itemList["@context"]).toBe("https://schema.org");
    const elements = (itemList.itemListElement as Array<Record<string, unknown>>) ?? [];
    expect(elements).toHaveLength(links.length);
    expect(elements.map((e) => e["@type"])).toEqual(Array(links.length).fill("ListItem"));
    expect(elements.map((e) => e["position"])).toEqual(links.map((_l, i) => i + 1));
    expect(elements.map((e) => e["name"])).toEqual(links.map((l) => l.name));
    expect(elements.map((e) => e["item"])).toEqual(
      links.map((l) => `https://0509.io${l.path}`),
    );

    // The existing WebPage JSON-LD is unchanged.
    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);
  });

  it("omits the ItemList JSON-LD when no brand pages are indexed (nothing to enumerate)", async () => {
    const markup = await render({ allCount: 0, groups: [], categoryLinks: [] });
    expect(markup).not.toContain('"@type":"ItemList"');
  });

  it("links every non-empty curated category to its /brands/:slug page and never 'More brands' (issue #2067)", async () => {
    const markup = await render(grouped());

    expect(markup).toContain('href="/brands/sport-footwear"');
    expect(markup).toContain('href="/brands/e-commerce"');
    expect(markup).toContain('href="/brands/saas-software"');
    // Labels render as the href text (escaped for &).
    expect(markup).toContain(">Sport &amp; footwear</a>");
    // The fallback bucket has no landing page — it must never be linked.
    expect(markup).not.toContain('href="/brands/more-brands"');
  });

  it("omits the category-link row entirely when no curated category has brands (nothing to link)", async () => {
    const markup = await render({ allCount: 0, groups: [], categoryLinks: [] });
    expect(markup).not.toContain("Browse by category");
    expect(markup).not.toContain('href="/brands/');
  });
});
