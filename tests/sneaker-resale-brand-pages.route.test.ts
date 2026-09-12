import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "./helpers/mock-react-router";
import { SNEAKER_RESALE_BRAND_PAGE_SLUGS } from "~/lib/sneaker-resale-brand-pages";

beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loader: () => ({
      page: {
        slug: "nike",
        name: "Nike",
        domain: "nike.com",
        signal: "signal line",
        proof: [{ title: "t", detail: "d" }],
      },
    }),
  })
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const request = new Request("https://0509.io/sneaker-resale/nike");

describe("sneaker-resale per-brand pages (issue #3087)", () => {
  it("exactly covers the four brands whose /ads pages the hub links", () => {
    expect([...SNEAKER_RESALE_BRAND_PAGE_SLUGS]).toEqual([
      "nike",
      "stockx",
      "footlocker",
      "jdsports",
    ]);
  });

  it("404s an unknown slug before any loader side effects", async () => {
    const mod = await import("~/routes/sneaker-resale.$brand");
    let threw: unknown = null;
    try {
      await mod.loader({
        context: undefined,
        request,
        params: { brand: "goat" },
      } as never);
    } catch (error) {
      threw = error;
    }
    expect(threw).toMatchObject({ status: 404 });
  });

  it("returns the brand copy for a live slug without needing D1", async () => {
    const mod = await import("~/routes/sneaker-resale.$brand");
    for (const slug of SNEAKER_RESALE_BRAND_PAGE_SLUGS) {
      const data = await mod.loader({
        context: undefined,
        request,
        params: { brand: slug },
      } as never);
      expect(data.page).toBeTruthy();
      expect(data.page.slug).toBe(slug);
      expect(data.page.domain.endsWith(".com")).toBe(true);
    }
  });

  it("canonicals to the English page only — no spoofed hreflang (#3087, #2962)", async () => {
    const mod = await import("~/routes/sneaker-resale.$brand");
    const meta = mod.meta({ loaderData: { page: { slug: "nike", name: "Nike", domain: "nike.com" } } } as never);
    const entries = [...(meta ?? [])] as Array<{ [key: string]: unknown }>;
    const canonical = entries.find(
      (entry) => entry.rel === "canonical",
    );
    expect(String(canonical?.href)).toBe("https://0509.io/sneaker-resale/nike");
    // The issue's acceptance forbids joining the locale hreflang cluster.
    expect(entries.some((entry) => entry.rel === "alternate")).toBe(false);
  });

  it("renders the dated sources, the /ads link, the hub backlink, and no hreflang", async () => {
    const { default: BrandRoute } = await import("~/routes/sneaker-resale.$brand");
    const markup = renderToStaticMarkup(createElement(BrandRoute));
    // Dated, external sources with <time> elements.
    expect((markup.match(/<time/gi) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain("(2026-08-30)");
    expect(markup).toContain("(2026-08-12)");
    // Internal links both ways + the /ads wall.
    expect(markup).toContain('href="/ads/nike.com"');
    expect(markup).toContain('href="/sneaker-resale"');
    // Sibling cluster pages are linked.
    expect(markup).toContain('href="/sneaker-resale/stockx"');
  });

  it("lists the four brand paths in the sitemap and the route registration keeps exact set parity", async () => {
    const { SITEMAP_PATHS } = await import("~/lib/seo");
    for (const slug of SNEAKER_RESALE_BRAND_PAGE_SLUGS) {
      expect(SITEMAP_PATHS).toContain(`/sneaker-resale/${slug}`);
    }
    // EN-only: root sitemap must still list them (no locale prefix stripped).
    const { ROOT_SITEMAP_STATIC_ENTRIES } = await import("~/lib/seo");
    for (const slug of SNEAKER_RESALE_BRAND_PAGE_SLUGS) {
      expect(ROOT_SITEMAP_STATIC_ENTRIES.map((entry) => entry.path)).toContain(
        `/sneaker-resale/${slug}`,
      );
    }
    // Locale sitemaps must NOT pick the EN-only cluster child up (canonical to
    // the English page only).
    const { staticSitemapEntriesForLocale } = await import("~/lib/sitemap.server");
    for (const locale of ["de", "ja", "pt-br"] as const) {
      const paths = staticSitemapEntriesForLocale(locale as never).map((entry) => entry.path);
      expect(paths).not.toContain(`/${locale}/sneaker-resale/nike`);
    }
  });

  it("the hub links down to every brand cluster page (page #3087)", async () => {
    const { SneakerResaleLanding } = await import("~/components/sneaker-resale-landing");
    const markup = renderToStaticMarkup(
      createElement(SneakerResaleLanding, { locale: "en" }),
    );
    for (const slug of SNEAKER_RESALE_BRAND_PAGE_SLUGS) {
      expect(markup).toContain(`href="/sneaker-resale/${slug}"`);
    }
  });

  it("routes.ts registers the brand route exactly once", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/routes.ts", "utf8"),
    );
    const routeLines = source
      .split("\n")
      .filter((line) => line.includes('sneaker-resale'));
    expect(routeLines.filter((line) => line.includes("sneaker-resale/:brand")).length).toBe(1);
  });
});
