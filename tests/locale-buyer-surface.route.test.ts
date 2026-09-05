import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUYER_SURFACE_LOCALE_IDS,
  BUYER_SURFACE_PATHS,
  isBuyerSurfaceLocaleId,
} from "~/lib/locale-markets";
import { buyerSurfaceHreflangLinks, publicSeoFileForPathname } from "~/lib/seo";
import { buildLocaleSitemapXml } from "~/lib/sitemap.server";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("locale buyer-surface layout (issue #1501)", () => {
  it("registers the layout + every buyer-surface child route in routes.ts", () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route(":locale", "routes/$locale.tsx"');
    for (const child of [
      "routes/$locale._index.tsx",
      "routes/$locale.pricing.tsx",
      "routes/$locale.help.tsx",
      "routes/$locale.docs.tsx",
      "routes/$locale.api.docs.tsx",
      "routes/$locale.status.tsx",
      "routes/$locale.changelog.tsx",
      "routes/$locale.trust.tsx",
      "routes/$locale.compare.tsx",
      // First-value search funnel + supporting trust surfaces (issue #1578).
      "routes/$locale.search.tsx",
      "routes/$locale.competitor-monitoring.tsx",
      "routes/$locale.capture-rules.tsx",
      "routes/$locale.ad-aggression.tsx",
      // Programmatic /ads/:domain locale pages (issue #1562).
      "routes/$locale.ads.$domain.tsx",
    ]) {
      expect(routes, `routes.ts missing ${child}`).toContain(child);
    }
  });

  it("404s unknown locale prefixes (en and unknown) before touching a child route", async () => {
    const { loader } = await import("~/routes/$locale");
    const context = { cloudflare: { env: {} } };
    for (const locale of ["en", "xx", "de_DE", "en-US", "kraut"]) {
      await expect(
        loader({
          context,
          request: new Request(`http://localhost/${locale}`),
          params: { locale },
        } as never),
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  it("accepts every buyer-surface locale and returns it as the loader data", async () => {
    const { loader } = await import("~/routes/$locale");
    const context = { cloudflare: { env: {} } };
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const data = await loader({
        context,
        request: new Request(`http://localhost/${locale}`),
        params: { locale },
      } as never);
      expect(data).toEqual({ locale });
    }
  });

  it("emits the buyer-surface hreflang cluster from the child route's links", () => {
    // The index page (`/de`) and a subpage (`/de/pricing`) each receive a
    // hreflang entry pointing at themselves plus every sibling locale and
    // the EN x-default. Self- and x-default canonicals are emitted
    // alongside hreflang by `canonicalLinks(...)` in each child file.
    for (const splat of ["", "pricing", "help", "docs", "api/docs", "status", "changelog", "trust", "compare", "search", "competitor-monitoring", "capture-rules", "ad-aggression"]) {
      const entries = buyerSurfaceHreflangLinks(splat);
      // Every buyer-surface locale contributes a self-link; the EN
      // x-default follows. Self-link count equals the cluster size.
      expect(entries).toHaveLength(BUYER_SURFACE_LOCALE_IDS.length + 1);
      const xDefault = entries.find((entry) => entry.hrefLang === "x-default");
      expect(xDefault).toBeDefined();
      const enPath =
        splat === ""
          ? "/"
          : splat === "api/docs"
            ? "/api/docs"
            : `/${splat}`;
      expect(xDefault?.href).toBe(`https://0509.io${enPath}`);
    }
  });

  it("every child route file re-exports the EN route's default component", async () => {
    // This is the production canary: a regression that removes a default
    // export or stops re-exporting the EN component would render an empty
    // page under the locale prefix. The check is per-child so a missing
    // export on one surface fails fast without dragging the rest of the
    // cluster into the failure.
    const { default: indexRoute } = await import("~/routes/$locale._index");
    const { default: pricingRoute } = await import("~/routes/$locale.pricing");
    const { default: helpRoute } = await import("~/routes/$locale.help");
    const { default: docsRoute } = await import("~/routes/$locale.docs");
    const { default: apiDocsRoute } = await import("~/routes/$locale.api.docs");
    const { default: statusRoute } = await import("~/routes/$locale.status");
    const { default: changelogRoute } = await import("~/routes/$locale.changelog");
    const { default: trustRoute } = await import("~/routes/$locale.trust");
    const { default: compareRoute } = await import("~/routes/$locale.compare");
    const { default: localeSearchRoute } = await import("~/routes/$locale.search");
    const { default: localeCompetitorMonitoringRoute } = await import(
      "~/routes/$locale.competitor-monitoring"
    );
    const { default: localeCaptureRulesRoute } = await import(
      "~/routes/$locale.capture-rules"
    );
    const { default: localeAdAggressionRoute } = await import(
      "~/routes/$locale.ad-aggression"
    );
    const { default: localeAdsDomainRoute } = await import(
      "~/routes/$locale.ads.$domain"
    );
    expect(typeof indexRoute).toBe("function");
    expect(typeof pricingRoute).toBe("function");
    expect(typeof helpRoute).toBe("function");
    expect(typeof docsRoute).toBe("function");
    expect(typeof apiDocsRoute).toBe("function");
    expect(typeof statusRoute).toBe("function");
    expect(typeof changelogRoute).toBe("function");
    expect(typeof trustRoute).toBe("function");
    expect(typeof compareRoute).toBe("function");
    expect(typeof localeSearchRoute).toBe("function");
    expect(typeof localeCompetitorMonitoringRoute).toBe("function");
    expect(typeof localeCaptureRulesRoute).toBe("function");
    expect(typeof localeAdAggressionRoute).toBe("function");
    expect(typeof localeAdsDomainRoute).toBe("function");
  });
});

describe("locale buyer-surface sitemap + worker wiring", () => {
  it("excludes every buyer-surface locale subpath from the sitemap (issue #1570)", () => {
    // The buyer-surface cluster serves byte-identical English copy with
    // canonical -> EN. Sitemapping dozens of locale `<loc>` entries
    // advertised them as dozens of indexable surfaces — a duplicate-content
    // doorway pattern. They stay reachable (200, canonical->EN) but are no
    // longer sitemapped.
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const body = buildLocaleSitemapXml(locale);
      expect(body).toContain("<urlset");
      for (const path of BUYER_SURFACE_PATHS) {
        if (path === "/" || path === "/sitemap.xml") continue;
        const expected = `<loc>https://0509.io/${locale}${path}</loc>`;
        expect(body, `sitemap must not list ${expected}`).not.toContain(expected);
      }
      // The genuinely translated sneaker-resale cluster STAYS in the sitemap.
      expect(body).toContain(`<loc>https://0509.io/${locale}/sneaker-resale</loc>`);
    }
  });

  it("serves a LOCALE-SCOPED body for /<locale>/sitemap.xml, never the root body", () => {
    // Issue #1561: the locale sitemaps used to mirror the root byte-for-byte
    // (each listed all URLs with no locale filter), fragmenting crawl
    // budget and splitting PageRank. Now each locale sitemap carries ONLY
    // /<locale>/-prefixed URLs, and the root feed excludes them entirely.
    // With issue #1570 the buyer-surface locale subpaths are gone from the
    // sitemap entirely, so the locale feed carries only the translated
    // sneaker-resale cluster.
    const de = buildLocaleSitemapXml("de");
    expect(de).toContain("<urlset");
    expect(de).toContain(`<loc>https://0509.io/de/sneaker-resale</loc>`);
    expect(de).not.toContain(`<loc>https://0509.io/de/pricing</loc>`);
    // The root body contains the EN (non-prefixed) /pricing, not /de/pricing.
    const root = publicSeoFileForPathname("/sitemap.xml")?.body ?? "";
    expect(root).toContain("<loc>https://0509.io/pricing</loc>");
    expect(root).not.toContain("<loc>https://0509.io/de/pricing</loc>");
  });
});

describe("buyerSurfaceHreflangLinks (issue #1501)", () => {
  it("emits self + sibling hreflang entries pointing at the same subpath", () => {
    const links = buyerSurfaceHreflangLinks("pricing");
    const byLocale = new Map(links.map((link) => [link.hrefLang, link.href]));
    expect(byLocale.get("de")).toBe("https://0509.io/de/pricing");
    expect(byLocale.get("ja")).toBe("https://0509.io/ja/pricing");
    expect(byLocale.get("pt-br")).toBe("https://0509.io/pt-br/pricing");
    expect(byLocale.get("fr")).toBe("https://0509.io/fr/pricing");
    expect(byLocale.get("es")).toBe("https://0509.io/es/pricing");
    expect(byLocale.get("x-default")).toBe("https://0509.io/pricing");
  });

  it("treats /api/docs as a single subpath segment", () => {
    const links = buyerSurfaceHreflangLinks("api/docs");
    expect(links.find((link) => link.hrefLang === "de")?.href).toBe(
      "https://0509.io/de/api/docs",
    );
    expect(links.find((link) => link.hrefLang === "x-default")?.href).toBe(
      "https://0509.io/api/docs",
    );
  });

  it("treats an empty splat as the bare locale index (/<locale> and x-default /)", () => {
    const links = buyerSurfaceHreflangLinks("");
    expect(links.find((link) => link.hrefLang === "de")?.href).toBe(
      "https://0509.io/de",
    );
    expect(links.find((link) => link.hrefLang === "x-default")?.href).toBe(
      "https://0509.io/",
    );
  });
});

describe("isBuyerSurfaceLocaleId (issue #1501)", () => {
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
