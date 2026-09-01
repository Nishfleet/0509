import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { SNEAKER_RESALE_MARKETS } from "~/lib/locale-markets";
import { sneakerResaleCopy } from "~/lib/sneaker-resale-copy";

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
        createElement(SneakerResaleLanding, { locale: market.id }),
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
  // A domain without a cached /ads/ page 301-redirects to /search, so a
  // missing link here is a dead-end regression, not a styling change.
  it("links every brand tile to a real /ads/:domain brand page (#1290)", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const markup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, { locale: "en" }),
    );
    for (const domain of ["nike.com", "adidas.com", "asos.com", "decathlon.com"]) {
      expect(markup).toContain(`href="/ads/${domain}"`);
    }
    // The brand-links section must not be empty or copy-only: at least four
    // /ads/ links ship, matching the live sneaker-resale page driven on
    // 2026-08-28.
    const adsLinkCount = (markup.match(/href="\/ads\/[^"]+"/g) ?? []).length;
    expect(adsLinkCount).toBeGreaterThanOrEqual(4);
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

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    for (const path of [
      "/sneaker-resale",
      "/de/sneaker-resale",
      "/ja/sneaker-resale",
      "/pt-br/sneaker-resale",
    ]) {
      expect(sitemap?.body).toContain(`<loc>https://0509.io${path}</loc>`);
    }
  });

  it("keeps FAQ JSON-LD in lockstep with the visible FAQ", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const copy = sneakerResaleCopy("de");
    const markup = renderToStaticMarkup(createElement(SneakerResaleLanding, { locale: "de" }));
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
