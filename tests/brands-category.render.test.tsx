import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The default export reads `useLoaderData`; a mutable fixture lets each test
// render the route with a specific loader payload. `meta` is tested directly
// (it is a pure function of loaderData).
let currentData: {
  slug: string;
  label: string;
  lastMod: string | null;
  brands: Array<{
    domain: string;
    path: string;
    name: string;
    adCount: number | null;
    score: number | null;
  }>;
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
  const { default: BrandCategoryRoute } = await import("~/routes/brands.$category");
  return renderToStaticMarkup(createElement(BrandCategoryRoute));
}

function beautyData(): typeof currentData {
  return {
    slug: "beauty-personal-care",
    label: "Beauty & personal care",
    lastMod: "2026-08-21",
    brands: [
      {
        domain: "nykaa.com",
        path: "/ads/nykaa.com",
        name: "Nykaa",
        adCount: 12,
        score: 42,
      },
      {
        domain: "sugarcosmetics.com",
        path: "/ads/sugarcosmetics.com",
        name: "Sugar Cosmetics",
        adCount: 8,
        score: null,
      },
    ],
  };
}

describe("/brands/:category — per-category brand landing page (issue #2067)", () => {
  it("lists exactly the brands in the category, each linking its /ads/:domain page with ad count + Ad Aggression Score", async () => {
    const markup = await render(beautyData());

    for (const brand of beautyData().brands) {
      expect(markup).toContain(`href="${brand.path}"`);
      expect(markup).toContain(brand.name.replaceAll("&", "&amp;"));
    }
    // Ad count renders for a brand with a known count.
    expect(markup).toContain("— 12 ads");
    expect(markup).toContain("— 8 ads");
    // A computed score renders inline.
    expect(markup).toContain("Ad Aggression Score 42");
    // A deferred score renders the honest "pending" state, never a number.
    expect(markup).toContain("Ad Aggression Score pending");
  });

  it("links back to the /brands hub so the cluster is internally connected", async () => {
    const markup = await render(beautyData());
    expect(markup).toContain('href="/brands"');
    expect(markup).toContain("Back to all tracked brands");
  });

  it("emits an ItemList JSON-LD with one ListItem per category brand", async () => {
    const markup = await render(beautyData());

    const blocks = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1] ?? "") as Record<string, unknown>,
    );

    const itemLists = blocks.filter((block) => block["@type"] === "ItemList");
    expect(itemLists).toHaveLength(1);

    const itemList = itemLists[0] ?? {};
    const elements = (itemList.itemListElement as Array<Record<string, unknown>>) ?? [];
    expect(elements).toHaveLength(2);
    expect(elements.map((e) => e["@type"])).toEqual(["ListItem", "ListItem"]);
    expect(elements.map((e) => e["position"])).toEqual([1, 2]);
    expect(elements.map((e) => e["name"])).toEqual(["Nykaa", "Sugar Cosmetics"]);
    expect(elements.map((e) => e["item"])).toEqual([
      "https://0509.io/ads/nykaa.com",
      "https://0509.io/ads/sugarcosmetics.com",
    ]);
  });

  it("renders the visible Breadcrumb trail from the same items as the BreadcrumbList JSON-LD (issue #2601)", async () => {
    const markup = await render(beautyData());

    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('href="/brands"');
    // First two crumbs link; the current page is plain text with aria-current.
    expect(markup).toContain('<a href="/">Home</a>');
    expect(markup).toContain('<a href="/brands">Brands</a>');
    expect(markup).toContain('<span aria-current="page">Beauty &amp; personal care</span>');
  });

  it("emits a BreadcrumbList JSON-LD of Home > Brands > Category", async () => {
    const markup = await render(beautyData());

    const blocks = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1] ?? "") as Record<string, unknown>,
    );

    const breadcrumbs = blocks.filter((block) => block["@type"] === "BreadcrumbList");
    expect(breadcrumbs).toHaveLength(1);

    const crumbs = (breadcrumbs[0]?.itemListElement as Array<Record<string, unknown>>) ?? [];
    expect(crumbs.map((c) => c["name"])).toEqual(["Home", "Brands", "Beauty & personal care"]);
    expect(crumbs.map((c) => c["item"])).toEqual([
      "https://0509.io/",
      "https://0509.io/brands",
      "https://0509.io/brands/beauty-personal-care",
    ]);
  });

  it("emits a WebPage JSON-LD carrying the category lastmod as dateModified", async () => {
    const markup = await render(beautyData());

    const blocks = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1] ?? "") as Record<string, unknown>,
    );

    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);
    expect(webPages[0]?.["dateModified"]).toBe("2026-08-21");
  });

  it("meta: emits a per-category title, category-intent description, canonical link, and the per-category social card", async () => {
    const { meta } = await import("~/routes/brands.$category");
    const entries = meta({ loaderData: beautyData() } as never) as Array<
      { property?: string; name?: string; title?: string; tagName?: string; rel?: string; href?: string; content?: string }
    >;

    expect(entries.find((e) => e.title)).toEqual({
      title: "Beauty & personal care competitor Meta ads | Five to Nine",
    });
    const description = entries.find((e) => e.name === "description");
    expect(description?.content).toContain("Beauty & personal care");
    const canonical = entries.find((e) => e.tagName === "link" && e.rel === "canonical");
    expect(canonical?.href).toBe("https://0509.io/brands/beauty-personal-care");
    const ogImage = entries.find((e) => e.property === "og:image");
    expect(ogImage?.content).toBe(
      "https://0509.io/social-card/brand/beauty-personal-care.svg",
    );
    const twitterCard = entries.find((e) => e.name === "twitter:card");
    expect(twitterCard?.content).toBe("summary_large_image");
  });
});