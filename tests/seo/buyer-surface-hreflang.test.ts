import { describe, expect, it } from "vitest";

import {
  BUYER_SURFACE_CHILD_PATHS,
  BUYER_SURFACE_LOCALE_IDS,
} from "~/lib/locale-markets";
import {
  buyerSurfaceHreflangLinksForPathname,
  buyerSurfaceHreflangLinks,
} from "~/lib/seo";
import { buildSitemapXml } from "~/lib/sitemap.server";

/**
 * Issue #2030 canary: the ~27 live /de|/ja|/pt-br (plus fr/es) buyer-surface
 * locale pages had zero reciprocal hreflang and zero sitemap coverage, so
 * Google could not connect the locale cluster. This test locks the two
 * acceptance gates:
 *   - every canonical EN page with locale variants emits the reciprocal
 *     self + sibling-locale + x-default hreflang set (via the root Layout's
 *     BuyerSurfaceHreflang, whose source is buyerSurfaceHreflangLinksForPathname),
 *     and every locale variant emits the same set from its own route links;
 *   - the root sitemap lists the indexable locale URLs grouped with the
 *     sitemap-hreflang alternate set.
 */

const SITE = "https://0509.io";

function hrefs(links: { hreflang: string; href: string }[]): Map<string, string> {
  return new Map(links.map((l) => [l.hreflang, l.href]));
}

describe("canonical EN page hreflang (issue #2030 accept #1)", () => {
  it("emits self + every sibling locale + x-default on the canonical home page", () => {
    const links = buyerSurfaceHreflangLinksForPathname("/");
    expect(links).not.toBeNull();
    const byLang = hrefs(links!);
    expect(links).toHaveLength(BUYER_SURFACE_LOCALE_IDS.length + 1);
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      expect(byLang.get(locale)).toBe(`${SITE}/${locale}`);
    }
    expect(byLang.get("x-default")).toBe(`${SITE}/`);
  });

  it("emits the cluster on a deep canonical compare child page", () => {
    const links = buyerSurfaceHreflangLinksForPathname("/compare/panoramata");
    expect(links).not.toBeNull();
    const byLang = hrefs(links!);
    expect(byLang.get("de")).toBe(`${SITE}/de/compare/panoramata`);
    expect(byLang.get("ja")).toBe(`${SITE}/ja/compare/panoramata`);
    expect(byLang.get("pt-br")).toBe(`${SITE}/pt-br/compare/panoramata`);
    expect(byLang.get("x-default")).toBe(`${SITE}/compare/panoramata`);
  });

  it("emits nothing on locale-prefixed and non-buyer pages (no duplicate/one-way tags)", () => {
    // Locale pages emit the cluster from their own route links; the canonical
    // helper must not double-emit. Non-buyer surfaces have no cluster.
    expect(buyerSurfaceHreflangLinksForPathname("/de/pricing")).toBeNull();
    expect(buyerSurfaceHreflangLinksForPathname("/ja/compare/panoramata")).toBeNull();
    expect(buyerSurfaceHreflangLinksForPathname("/privacy")).toBeNull();
    expect(buyerSurfaceHreflangLinksForPathname("/sneaker-resale")).toBeNull();
  });
});

describe("locale variant hreflang mirrors the canonical set (issue #2030)", () => {
  it("the locale variant and the canonical page share one reciprocal set", () => {
    // Google ignores one-way hreflang: the /de/compare/panoramata page must
    // declare the exact same alternates the canonical /compare/panoramata
    // declares, so the cluster is reciprocal on both ends.
    const canonical = hrefs(buyerSurfaceHreflangLinksForPathname("/compare/panoramata")!);
    const locale = hrefs(buyerSurfaceHreflangLinks("compare/panoramata"));
    expect([...locale.entries()].sort()).toEqual([...canonical.entries()].sort());
    expect(locale.get("de")).toBe(`${SITE}/de/compare/panoramata`);
    expect(locale.get("x-default")).toBe(`${SITE}/compare/panoramata`);
  });

  it("every locale child path emits a reciprocal cluster from its route links", () => {
    for (const child of BUYER_SURFACE_CHILD_PATHS) {
      const splat = child.replace(/^\//, "");
      const links = buyerSurfaceHreflangLinks(splat);
      expect(links).toHaveLength(BUYER_SURFACE_LOCALE_IDS.length + 1);
      expect(links.some((l) => l.hreflang === "x-default")).toBe(true);
    }
  });
});

describe("sitemap lists locale URLs grouped with hreflang alternates (issue #2030 accept #2)", () => {
  it("lists indexable locale URLs and carries the sitemap-hreflang pattern", () => {
    const body = buildSitemapXml([], []);
    // The verify gate: the live sitemap must surface /de, /ja and /pt-br URLs.
    for (const locale of ["de", "ja", "pt-br"]) {
      expect(body).toMatch(new RegExp(`<loc>https://0509\\.io/${locale}/[^<]+</loc>`));
    }
    // The sitemap-hreflang pattern: the locale <loc> block carries an
    // <xhtml:link> alternate for every sibling locale plus x-default.
    expect(body).toContain(
      `<xhtml:link rel="alternate" hreflang="de" href="https://0509.io/de/pricing"/>`,
    );
    expect(body).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="https://0509.io/pricing"/>`,
    );
    // The canonical EN sibling is annotated too — no one-way sitemap annotation.
    expect(body).toContain(
      `<xhtml:link rel="alternate" hreflang="ja" href="https://0509.io/ja/pricing"/>`,
    );
  });
});
