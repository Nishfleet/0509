import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The default export reads `useLoaderData`; a mutable fixture lets each test
// render the route with a specific loader payload.
let currentData: { groups: Array<{ category: string; items: Array<{ domain: string; path: string; name: string }> }>; allCount: number };

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
    };
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
    const markup = await render({ allCount: 0, groups: [] });
    expect(markup).toContain("No brand pages are indexed right now");
    expect(markup).not.toContain("ld-brands-groups");
  });
});
