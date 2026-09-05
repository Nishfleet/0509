import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BUYER_SURFACE_LOCALE_IDS,
  htmlLangForPathname,
  localeSearchPathname,
} from "~/lib/locale-markets";
import {
  buyerSurfaceHreflangLinks,
  publicSeoFileForPathname,
} from "~/lib/seo";

// First-value search funnel + supporting trust surfaces that must serve 200
// under every buyer-surface locale prefix (issue #1578).
const LOCALE_FIRST_VALUE_ROUTES = [
  "search",
  "competitor-monitoring",
  "capture-rules",
  "ad-aggression",
] as const;

describe("locale first-value search funnel (issue #1578)", () => {
  it("registers every first-value route as a child of the :locale layout in routes.ts", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    const localeBlock = routes.slice(
      routes.indexOf('route(":locale"'),
      routes.indexOf('route("team/accept"'),
    );
    for (const route of LOCALE_FIRST_VALUE_ROUTES) {
      expect(localeBlock, `routes.ts :locale block missing ${route}`).toContain(
        `route("${route}", "routes/$locale.${route}.tsx")`,
      );
    }
  });

  it("every first-value $locale route re-exports the EN component and a functional surface", async () => {
    // A missing default export (or one that stopped re-exporting the EN
    // component) would render an empty page under the locale prefix — the
    // EN surface shipped under #1501 stays in lockstep. `search` additionally
    // re-exports its full loader/action/headers so /<locale>/search is the
    // genuinely functional search, not a byte-identical stub.
    const { default: searchRoute, loader, action } = await import(
      "~/routes/$locale.search"
    );
    expect(typeof searchRoute).toBe("function");
    expect(typeof loader).toBe("function");
    expect(typeof action).toBe("function");
    for (const route of ["competitor-monitoring", "capture-rules", "ad-aggression"]) {
      const mod = await import(`~/routes/$locale.${route}`);
      expect(typeof mod.default, `${route} default`).toBe("function");
    }
  });

  it("emits the canonical (EN) + reciprocal hreflang cluster for each first-value route", async () => {
    for (const route of LOCALE_FIRST_VALUE_ROUTES) {
      const mod = await import(`~/routes/$locale.${route}`);
      const links = mod.links?.() ?? [];
      const canonical = links.find((link: { rel?: string }) => link.rel === "canonical");
      expect(canonical, `${route} canonical`).toBeDefined();
      expect(canonical.href, `${route} canonical href`).toBe(
        `https://0509.io/${route}`,
      );
      const hreflang = links.some((link: { rel?: string }) => link.rel === "alternate");
      expect(hreflang, `${route} hreflang`).toBe(true);
      const siblings = buyerSurfaceHreflangLinks(route);
      // self + every sibling locale + x-default.
      expect(siblings).toHaveLength(BUYER_SURFACE_LOCALE_IDS.length + 1);
      expect(siblings.find((s) => s.hrefLang === "x-default")?.href).toBe(
        `https://0509.io/${route}`,
      );
    }
  });

  it("reports the correct <html lang> for every locale × first-value route", () => {
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const expectedLang = locale === "pt-br" ? "pt-BR" : locale;
      for (const route of LOCALE_FIRST_VALUE_ROUTES) {
        expect(htmlLangForPathname(`/${locale}/${route}`), `/${locale}/${route}`).toBe(
          expectedLang,
        );
      }
    }
  });

  it("lists all 20 locale first-value URLs in the sitemap so Google can locale-target them", () => {
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    expect(sitemap).not.toBeNull();
    const body = sitemap?.body ?? "";
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const route of LOCALE_FIRST_VALUE_ROUTES) {
        const loc = `<loc>https://0509.io/${locale}/${route}</loc>`;
        expect(body, `sitemap missing ${loc}`).toContain(loc);
      }
    }
  });

  it("a localised surface funnels the search moment to the locale-prefixed /search, not EN", () => {
    // accept #3: locale pages must link to /{locale}/search. EN pathnames
    // keep /search unchanged.
    for (const route of ["search", "competitor-monitoring", "capture-rules", "ad-aggression"]) {
      for (const locale of BUYER_SURFACE_LOCALE_IDS) {
        expect(localeSearchPathname(`/${locale}/${route}`), `/${locale}/${route}`).toBe(
          `/${locale}/search`,
        );
      }
      expect(localeSearchPathname(`/${route}`)).toBe("/search");
    }
  });
});
