import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BUYER_SURFACE_LOCALE_IDS,
  isBuyerSurfaceLocaleId,
} from "~/lib/locale-markets";
import { publicSeoFileForPathname } from "~/lib/seo";
import { buildLocaleSitemapXml, staticSitemapEntriesForLocale } from "~/lib/sitemap.server";

/**
 * Regression canary for issue #2962 (orchestrator Branch B): the
 * untranslated buyer-surface locale routes are DELETED and every
 * buyer-surface locale path 301s to the EN pathname (query preserved),
 * while the genuinely translated sneaker-resale locale cluster
 * (de, ja, pt-br) keeps serving indexable, self-canonical locale pages and
 * keeps its coverage in the de/ja/pt-br locale sitemaps. fr/es carry no
 * sneaker-resale page, so their feeds are empty and robots.txt no longer
 * advertises them.
 */

const REDIRECT_CASES = [
  { splat: "", enPath: "/" },
  { splat: "pricing", enPath: "/pricing" },
  { splat: "compare/panoramata", enPath: "/compare/panoramata" },
  { splat: "api/docs", enPath: "/api/docs" },
  { splat: "ads/nike.com", enPath: "/ads/nike.com" },
] as const;

const AUDIT_BUYER_ROUTES = [
  "/pricing",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/compare",
  "/search",
  "/competitor-monitoring",
  "/capture-rules",
  "/methodology",
  "/compare/panoramata",
  "/switch/visualping",
  "/ads/nike.com",
] as const;

describe("retired buyer-surface locale cluster → 301 (issue #2962)", () => {
  it("registers the :locale splat redirect and NOT the deleted child routes", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route(":locale/*", "routes/$locale.tsx"');
    expect(routes).toContain(
      'route(":locale/sneaker-resale", "routes/$locale.sneaker-resale.tsx")',
    );
    for (const gone of [
      "routes/$locale._index.tsx",
      "routes/$locale.pricing.tsx",
      "routes/$locale.search.tsx",
      "routes/$locale.ads.$domain.tsx",
      "routes/$locale.compare.panoramata.tsx",
      "routes/$locale.guides.how-to-track-competitor-ads.tsx",
    ]) {
      expect(routes, `${gone} must be gone from routes.ts`).not.toContain(`"${gone}"`);
    }
    expect(routes.includes("routes/$locale.pricing.tsx")).toBe(false);
  });

  it("301s every buyer-surface locale path to the EN pathname (query preserved, bare index → /)", async () => {
    const { loader } = await import("~/routes/$locale");
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const { splat, enPath } of REDIRECT_CASES) {
        const response = await loader({
          request: new Request(
            `http://localhost/${locale}${splat ? `/${splat}` : ""}?utm=1`,
          ),
          params: { locale, "*": splat },
          context: {},
        } as never);
        expect(response.status, `${locale}/${splat}`).toBe(301);
        expect(response.headers.get("location"), `${locale}/${splat}`).toBe(
          `${enPath}?utm=1`,
        );
      }
      // Bare locale index: 301 to "/" with no trailing "?".
      const bare = await loader({
        request: new Request(`http://localhost/${locale}`),
        params: { locale, "*": "" },
        context: {},
      } as never);
      expect(bare.status).toBe(301);
      expect(bare.headers.get("location")).toBe("/");
    }
  });

  it("covers the issue audit's buyer-surface route list with 301 expectations", async () => {
    // The audit's own curl list — every formerly-200 buyer path must now be
    // a 301 to its EN twin, so no already-indexed URL dead-ends on a 404.
    const { loader } = await import("~/routes/$locale");
    for (const route of AUDIT_BUYER_ROUTES) {
      const splat = route.replace(/^\//, "");
      const response = await loader({
        request: new Request(`http://localhost/de${route}`),
        params: { locale: "de", "*": splat },
        context: {},
      } as never);
      expect(response.status, route).toBe(301);
      expect(response.headers.get("location")).toBe(route);
    }
  });

  it("404s unknown locale prefixes instead of re-routing the EN page", async () => {
    const { loader } = await import("~/routes/$locale");
    for (const locale of ["en", "xx", "de_DE", "en-US"]) {
      await expect(
        loader({
          request: new Request(`http://localhost/${locale}/pricing`),
          params: { locale, "*": "pricing" },
          context: {},
        } as never),
      ).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe("locale sitemaps after the removal (issue #2962)", () => {
  it("lists only the sneaker-resale page for de/ja/pt-br; fr/es serve empty feeds", () => {
    for (const locale of ["de", "ja", "pt-br"] as const) {
      const body = buildLocaleSitemapXml(locale);
      expect(body).toContain(`<loc>https://0509.io/${locale}/sneaker-resale</loc>`);
      // No buyer-surface locale page remains to be advertised.
      expect(body).not.toContain(`https://0509.io/${locale}/pricing`);
    }
    for (const locale of ["fr", "es"] as const) {
      expect(staticSitemapEntriesForLocale(locale)).toEqual([]);
      expect(buildLocaleSitemapXml(locale)).not.toContain("<loc>");
    }
  });

  it("still serves a locale-scoped body and never leaks locale URLs into the root feed", () => {
    const de = buildLocaleSitemapXml("de");
    expect(de).toContain("<loc>https://0509.io/de/sneaker-resale</loc>");
    const root = publicSeoFileForPathname("/sitemap.xml")?.body ?? "";
    expect(root).toContain("<loc>https://0509.io/sneaker-resale</loc>");
    expect(root).not.toContain("/de/sneaker-resale");
    // robots.txt advertises the de/ja/pt-br feeds but NOT the empty fr/es ones.
    const robots = publicSeoFileForPathname("/robots.txt")?.body ?? "";
    expect(robots).toContain("Sitemap: https://0509.io/de/sitemap.xml");
    expect(robots).not.toContain("Sitemap: https://0509.io/fr/sitemap.xml");
    expect(robots).not.toContain("Sitemap: https://0509.io/es/sitemap.xml");
  });
});

describe("isBuyerSurfaceLocaleId (kept as the 301 + worker sitemap gate)", () => {
  it("accepts every buyer-surface locale id", () => {
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      expect(isBuyerSurfaceLocaleId(locale)).toBe(true);
    }
  });

  it("rejects the English x-default and any unknown locale", () => {
    expect(isBuyerSurfaceLocaleId("en")).toBe(false);
    expect(isBuyerSurfaceLocaleId("EN")).toBe(false);
    expect(isBuyerSurfaceLocaleId("de_DE")).toBe(false);
    expect(isBuyerSurfaceLocaleId("xx")).toBe(false);
    expect(isBuyerSurfaceLocaleId(undefined)).toBe(false);
  });
});
