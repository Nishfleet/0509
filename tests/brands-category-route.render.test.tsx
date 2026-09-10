import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The default export reads `useLoaderData`; a mutable fixture lets each test
// render the route with a specific loader payload.
let currentData: {
  categorySlug: string;
  categoryLabel: string;
  items: Array<{ domain: string; path: string; name: string; timelineIndexable?: boolean }>;
};

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
  const { default: BrandCategoryRoute } = await import("~/routes/brands.$categorySlug");
  return renderToStaticMarkup(createElement(BrandCategoryRoute));
}

const sportItems = [
  { domain: "nike.com", path: "/ads/nike.com", name: "Nike", timelineIndexable: true },
  { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas", timelineIndexable: false },
];

const sportData = {
  categorySlug: "sport-footwear",
  categoryLabel: "Sport & footwear",
  items: sportItems,
};

describe("/brands/:categorySlug route (issue #2067)", () => {
  it("links every brand in the category to its /ads/:domain page", async () => {
    const markup = await render(sportData);
    for (const item of sportItems) {
      expect(markup).toContain(`href="${item.path}"`);
      expect(markup).toContain(item.name);
      expect(markup).toContain(item.domain);
    }
  });

  it("renders an ItemList schema listing the brands and pointing at their /ads pages", async () => {
    const markup = await render(sportData);
    expect(markup).toContain("ItemList");
    expect(markup).toContain("ListItem");
    expect(markup).toContain("/ads/nike.com");
    expect(markup).toContain("/ads/adidas.com");
  });

  it("renders a breadcrumb Home > Brands > Category", async () => {
    const markup = await render(sportData);
    expect(markup).toContain("BreadcrumbList");
    expect(markup).toContain("Home");
    expect(markup).toContain('href="/brands"');
    // The current page crumb is plain text (not a link).
    expect(markup).toContain("Sport & footwear");
  });

  it("links back to the /brands hub", async () => {
    const markup = await render(sportData);
    expect(markup).toContain('href="/brands"');
    expect(markup).toContain("Browse all tracked brands");
  });

  it("links the Offer Timeline for a brand whose /timeline/:domain is indexable", async () => {
    const markup = await render({
      ...sportData,
      items: [
        { domain: "nike.com", path: "/ads/nike.com", name: "Nike", timelineIndexable: true },
        { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas", timelineIndexable: false },
      ],
    });
    expect(markup).toContain('href="/timeline/nike.com"');
    expect(markup).not.toContain('href="/timeline/adidas.com"');
  });

  it("stamps a per-category social card og:image via meta", async () => {
    const { meta } = await import("~/routes/brands.$categorySlug");
    const entries = meta({
      loaderData: sportData,
      params: {},
      location: { pathname: "/brands/sport-footwear" } as never,
      matches: [],
    }) as ReadonlyArray<{
      property?: string;
      content?: string;
    }>;
    const ogImage = entries.find((e) => e.property === "og:image")?.content;
    expect(ogImage).toMatch(/^https:\/\/0509\.io\/social-card\/brands\/sport-footwear\.svg$/);
    const ogAlt = entries.find((e) => e.property === "og:image:alt")?.content;
    expect(ogAlt).toContain("Sport & footwear");
  });

  it("meta title targets the category-intent query and description names the category", async () => {
    const { meta } = await import("~/routes/brands.$categorySlug");
    const entries = meta({
      loaderData: sportData,
      params: {},
      location: { pathname: "/brands/sport-footwear" } as never,
      matches: [],
    }) as ReadonlyArray<{
      title?: string;
      name?: string;
      content?: string;
    }>;
    const title = entries.find((e) => e.title !== undefined)?.title;
    expect(title).toBe("Sport & footwear competitor Meta ads | Five to Nine");
    const description = entries.find((e) => e.name === "description")?.content;
    expect(description).toContain("Sport & footwear");
  });

  it("emits a canonical link tag for the category path", async () => {
    const { meta } = await import("~/routes/brands.$categorySlug");
    const entries = meta({
      loaderData: sportData,
      params: {},
      location: { pathname: "/brands/sport-footwear" } as never,
      matches: [],
    }) as ReadonlyArray<{
      tagName?: string;
      rel?: string;
      href?: string;
    }>;
    const canonical = entries.find((e) => e.rel === "canonical");
    expect(canonical?.href).toBe("https://0509.io/brands/sport-footwear");
  });
});
