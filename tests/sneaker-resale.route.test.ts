import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import { SNEAKER_RESALE_MARKETS } from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";

// The brand-links and swing sections render exactly the loader-provided
// indexable set (the sneaker-resale seed list ∩ the sitemap indexability
// filter). Fixtures stand in for the live set; cluster members missing from
// it (hoka.com, sneakerping.com) model a still-unpublished brand page.
const INDEXABLE_LINKS: IndexableAdsLink[] = [
  { domain: "nike.com", path: "/ads/nike.com", name: "Nike" },
  { domain: "stockx.com", path: "/ads/stockx.com", name: "StockX" },
  { domain: "adidas.com", path: "/ads/adidas.com", name: "adidas" },
  { domain: "stadiumgoods.com", path: "/ads/stadiumgoods.com", name: "Stadium Goods" },
];
const INDEXABLE_DOMAINS = new Set(INDEXABLE_LINKS.map((link) => link.domain));

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("sneaker-resale locale landing pages", () => {
  it("renders original copy, hreflang, and the locale signup marker for each market", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const { links } = await import("~/routes/sneaker-resale");

    const headLinks = links();
    expect(headLinks).toContainEqual({
      rel: "canonical",
      href: "https://0509.io/sneaker-resale",
    });
    expect(headLinks).toContainEqual({
      rel: "alternate",
      hrefLang: "de",
      href: "https://0509.io/de/sneaker-resale",
    });
    expect(headLinks).toContainEqual({
      rel: "alternate",
      hrefLang: "x-default",
      href: "https://0509.io/sneaker-resale",
    });

    for (const market of SNEAKER_RESALE_MARKETS) {
      const copy = sneakerResaleCopy(market.id);
      const markup = renderToStaticMarkup(
        createElement(SneakerResaleLanding, {
          locale: market.id,
          indexableAdsLinks: INDEXABLE_LINKS,
        }),
      );
      expect(markup).toContain(copy.h1);
      expect(markup).toContain(`href="/auth/signup?source=${market.signupSource}"`);
      expect(markup).toContain('action="/search"');
      expect(markup).toContain("Named for 05:09");
      expect(markup).not.toMatch(/\b\d+% of\b/);
    }
  });

  // #1290 live proof: the sneaker-resale category page used to name brands in
  // copy only and link to zero /ads/ pages. Each brand tile must now link to a
  // real /ads/:domain brand page so the market's #1 swing is not orphaned.
  // Since #1547 the tiles are the loader's live indexable set — the sitemap's
  // own indexability filter — so a brand that loses its page drops off
  // instead of shipping a stale link.
  it("links every brand tile to a real /ads/:domain brand page (#1290, #1547)", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const markup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, {
        locale: "en",
        indexableAdsLinks: INDEXABLE_LINKS,
      }),
    );
    for (const link of INDEXABLE_LINKS) {
      expect(markup).toContain(`href="${link.path}"`);
      expect(markup).toContain(link.name);
    }
    // A seed-list domain whose page is not indexable must not appear.
    expect(markup).not.toContain('href="/ads/hoka.com"');
    expect(markup).not.toContain('href="/ads/sneakerping.com"');
  });

  it("hides the brand-links section entirely when no cluster page is indexable", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const copy = sneakerResaleCopy("en");
    const markup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, { locale: "en", indexableAdsLinks: [] }),
    );
    expect(markup).not.toContain(copy.brandsTitle);
    expect(markup).not.toMatch(/href="\/ads\/[^"]+"/);
  });

  // #1521 live proof: the "Who's moving right now" section named the movers
  // (Saucony, ASICS) with no link at all — the one place on the landing page
  // the followable-proof pattern was absent. Every mover's brand must link to
  // a live proof surface: /ads/<domain> when that brand page is indexable
  // (#1547: #1282/#1306 populated it), else /search?q=<domain>. The required
  // `domain` field keeps a dead link from compiling in.
  it("links every swing mover to its live proof surface in every locale (#1521, #1547)", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    for (const market of SNEAKER_RESALE_MARKETS) {
      const copy = sneakerResaleCopy(market.id);
      const markup = renderToStaticMarkup(
        createElement(SneakerResaleLanding, {
          locale: market.id,
          indexableAdsLinks: INDEXABLE_LINKS,
        }),
      );
      expect(copy.swing.length).toBeGreaterThanOrEqual(2);
      for (const item of copy.swing) {
        expect(item.domain.trim()).not.toBe("");
        expect(item.domain).not.toContain(" ");
        const expected = INDEXABLE_DOMAINS.has(item.domain)
          ? `href="/ads/${item.domain}"`
          : `href="/search?q=${item.domain}"`;
        expect(markup).toContain(expected);
      }
    }
    // The retarget is real: nike.com is in the fixture indexable set, so its
    // swing tile leaves /search for the brand page; sneakerping.com has no
    // indexable page and keeps the /search fallback.
    const enMarkup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, {
        locale: "en",
        indexableAdsLinks: INDEXABLE_LINKS,
      }),
    );
    expect(enMarkup).toContain('href="/ads/nike.com"');
    expect(enMarkup).toContain('href="/search?q=sneakerping.com"');
  });

  it("emits reciprocal hreflang from no-arg links() and a locale canonical from loaderData", async () => {
    const { links, meta } = await import("~/routes/$locale.sneaker-resale");

    // This router version calls links() with no args (see ads.$domain.tsx).
    const headLinks = links();
    expect(headLinks).toContainEqual({
      rel: "alternate",
      hrefLang: "de",
      href: "https://0509.io/de/sneaker-resale",
    });
    expect(headLinks).toContainEqual({
      rel: "alternate",
      hrefLang: "x-default",
      href: "https://0509.io/sneaker-resale",
    });

    const tags = meta({
      loaderData: { locale: "de" },
      params: { locale: "de" },
      location: { pathname: "/de/sneaker-resale" },
    } as never) as Array<Record<string, string>>;
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://0509.io/de/sneaker-resale",
    });
    expect(tags).toContainEqual({ property: "og:locale", content: "de_DE" });
  });

  it("404s unknown locale prefixes and the English prefix duplicate", async () => {
    const { loader } = await import("~/routes/$locale.sneaker-resale");
    const context = { cloudflare: { env: {} } };

    await expect(
      loader({
        context,
        request: new Request("http://localhost/fr/sneaker-resale"),
        params: { locale: "fr" },
      } as never),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      loader({
        context,
        request: new Request("http://localhost/en/sneaker-resale"),
        params: { locale: "en" },
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("is registered and published in the sitemap", async () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("sneaker-resale", "routes/sneaker-resale.tsx")');
    expect(routes).toContain('route(":locale/sneaker-resale", "routes/$locale.sneaker-resale.tsx")');

    // Issue #1561: the EN /sneaker-resale stays in the root sitemap; the
    // locale sneaker-resale pages live ONLY in their own /<locale>/sitemap.xml.
    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const { buildLocaleSitemapXml } = await import("~/lib/sitemap.server");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap?.body).toContain(`<loc>https://0509.io/sneaker-resale</loc>`);
    expect(sitemap?.body).not.toContain(`<loc>https://0509.io/de/sneaker-resale</loc>`);
    for (const [locale, path] of [
      ["de", "/de/sneaker-resale"],
      ["ja", "/ja/sneaker-resale"],
      ["pt-br", "/pt-br/sneaker-resale"],
    ] as const) {
      expect(buildLocaleSitemapXml(locale)).toContain(`<loc>https://0509.io${path}</loc>`);
    }
  });

  it("keeps FAQ JSON-LD in lockstep with the visible FAQ", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const copy = sneakerResaleCopy("de");
    const markup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, {
        locale: "de",
        indexableAdsLinks: INDEXABLE_LINKS,
      }),
    );
    const ldBlocks = [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const faqBlocks = ldBlocks
      .map((match) => JSON.parse(match[1] ?? "{}"))
      .filter((data) => data["@type"] === "FAQPage");
    expect(faqBlocks).toHaveLength(1);
    expect((faqBlocks[0].mainEntity as Array<{ name: string }>).map((entry) => entry.name)).toEqual(
      copy.faq.map((entry) => entry.question),
    );
  });
});
