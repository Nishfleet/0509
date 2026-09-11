/**
 * Issue #2030 — the buyer-surface locale cluster must be reciprocal: every
 * EN canonical page that has locale variants emits the full
 * rel="alternate" hreflang set (en self + de/ja/pt-br/fr/es + x-default),
 * and the sitemap lists the locale URLs as `xhtml:link` alternates grouped
 * under each indexable `<url>` — never as duplicate `<loc>` entries
 * (issue #1561's one-loc-per-URL rule stays).
 */
import { describe, expect, it } from "vitest";

import {
  BUYER_SURFACE_LOCALE_IDS,
  BUYER_SURFACE_PATHS,
  type BuyerSurfaceLocaleId,
} from "~/lib/locale-markets";
import {
  buyerSurfaceHreflangLinks,
  sitemapHreflangAlternates,
} from "~/lib/seo";
import {
  buildLocaleSitemapXml,
  buildSitemapXml,
} from "~/lib/sitemap.server";

const SITE = "https://0509.io";

interface LinkDescriptorLike {
  rel?: string;
  hreflang?: string;
  href?: string;
}

function hreflangMap(links: LinkDescriptorLike[]) {
  return new Map(
    links
      .filter((link) => link.rel === "alternate")
      .map((link) => [link.hreflang, link.href]),
  );
}

describe("EN canonical pages emit the reciprocal hreflang cluster (issue #2030)", () => {
  // One representative EN route per surface family — every one of these has
  // live /<locale>/ twins and previously emitted ZERO hreflang, so Google
  // ignored the whole one-way cluster.
  const cases: Array<{ name: string; load: () => Promise<{ links: () => LinkDescriptorLike[] }>; enPath: string }> = [
    { name: "/", load: () => import("~/routes/marketing") as never, enPath: "/" },
    { name: "/pricing", load: () => import("~/routes/pricing") as never, enPath: "/pricing" },
    { name: "/search", load: () => import("~/routes/search") as never, enPath: "/search" },
    { name: "/compare", load: () => import("~/routes/compare") as never, enPath: "/compare" },
    {
      name: "/compare/panoramata",
      load: () => import("~/routes/compare.panoramata") as never,
      enPath: "/compare/panoramata",
    },
    {
      name: "/switch/visualping",
      load: () => import("~/routes/switch.visualping") as never,
      enPath: "/switch/visualping",
    },
    {
      name: "/guides/how-to-track-competitor-ads",
      load: () => import("~/routes/guides.how-to-track-competitor-ads") as never,
      enPath: "/guides/how-to-track-competitor-ads",
    },
    { name: "/methodology", load: () => import("~/routes/methodology") as never, enPath: "/methodology" },
  ];

  for (const { name, load, enPath } of cases) {
    it(`${name} emits en self + every locale + x-default`, async () => {
      const mod = await load();
      const links = mod.links() as LinkDescriptorLike[];
      const byHreflang = hreflangMap(links);

      expect(byHreflang.get("en")).toBe(`${SITE}${enPath}`);
      for (const locale of BUYER_SURFACE_LOCALE_IDS) {
        const expected =
          enPath === "/" ? `${SITE}/${locale}` : `${SITE}/${locale}${enPath}`;
        expect(byHreflang.get(locale), `${name} missing ${locale}`).toBe(expected);
      }
      expect(byHreflang.get("x-default")).toBe(`${SITE}${enPath}`);
      // canonical stays the EN URL.
      expect(links.find((link) => link.rel === "canonical")?.href).toBe(
        `${SITE}${enPath}`,
      );
    });
  }

  it("the locale twin emits the identical complete cluster", async () => {
    const en = (await import("~/routes/pricing")) as unknown as {
      links: () => LinkDescriptorLike[];
    };
    const de = (await import("~/routes/$locale.pricing")) as unknown as {
      links: () => LinkDescriptorLike[];
    };
    expect(hreflangMap(de.links())).toEqual(hreflangMap(en.links()));
  });

  it("canonicalized-away compare losers emit NO hreflang cluster", async () => {
    for (const slug of ["visualping", "visualping-ad-library", "foreplay"]) {
      const mod = (await import(`~/routes/compare.${slug}`)) as unknown as {
        links: () => LinkDescriptorLike[];
      };
      const alternates = mod.links().filter((link) => link.rel === "alternate");
      expect(alternates, `/compare/${slug} must not emit hreflang`).toHaveLength(0);
    }
  });

  it("an indexable /ads/:domain page emits the cluster; a noindex shell does not", async () => {
    const { meta } = await import("~/routes/ads.$domain");
    const base = {
      brandName: "Nike",
      domain: "nike.com",
      canonicalPath: "/ads/nike.com",
      hasCachedAds: false,
      adCount: 0,
      brandOwnedAdCount: 0,
      verifiedLinkCount: 0,
      unverifiedMatchCount: 0,
      adLibraryCountry: null,
      checkedAgo: "recently",
      aggression: null,
    };
    const indexable = meta({
      loaderData: { ...base, noindex: false },
    } as never) as Array<Record<string, string>>;
    const indexableAlternates = indexable.filter(
      (tag) => tag.tagName === "link" && tag.rel === "alternate",
    );
    expect(indexableAlternates).toHaveLength(BUYER_SURFACE_LOCALE_IDS.length + 2);
    expect(indexableAlternates).toContainEqual({
      tagName: "link",
      rel: "alternate",
      hrefLang: "de",
      href: `${SITE}/de/ads/nike.com`,
    });
    expect(indexableAlternates).toContainEqual({
      tagName: "link",
      rel: "alternate",
      hrefLang: "x-default",
      href: `${SITE}/ads/nike.com`,
    });

    const shell = meta({
      loaderData: { ...base, noindex: true },
    } as never) as Array<Record<string, string>>;
    expect(
      shell.filter((tag) => tag.tagName === "link" && tag.rel === "alternate"),
    ).toHaveLength(0);
  });
});

describe("sitemap hreflang alternates (issue #2030)", () => {
  it("maps EN and locale paths to the same complete cluster", () => {
    for (const path of ["/pricing", "/de/pricing", "/es/pricing"]) {
      const alternates = sitemapHreflangAlternates(path);
      expect(alternates).toHaveLength(BUYER_SURFACE_LOCALE_IDS.length + 2);
      const byHreflang = new Map(
        (alternates ?? []).map((alt) => [alt.hreflang, alt.href]),
      );
      expect(byHreflang.get("en")).toBe(`${SITE}/pricing`);
      expect(byHreflang.get("de")).toBe(`${SITE}/de/pricing`);
      expect(byHreflang.get("x-default")).toBe(`${SITE}/pricing`);
    }
  });

  it("covers the programmatic /ads/:domain surface", () => {
    const alternates = sitemapHreflangAlternates("/ads/nike.com");
    expect(alternates?.map((alt) => alt.href)).toContain(
      `${SITE}/de/ads/nike.com`,
    );
  });

  it("sneaker-resale keeps its own translated 3-locale cluster", () => {
    const en = sitemapHreflangAlternates("/sneaker-resale");
    const de = sitemapHreflangAlternates("/de/sneaker-resale");
    expect(en?.map((alt) => alt.hreflang)).toEqual([
      "en",
      "de",
      "ja",
      "pt-BR",
      "x-default",
    ]);
    expect(de).toEqual(en);
    // fr/es have no sneaker-resale page — never advertised.
    expect(sitemapHreflangAlternates("/fr/sneaker-resale")).toBeUndefined();
  });

  it("returns undefined for paths with no live locale variant", () => {
    for (const path of [
      "/privacy",
      "/terms",
      "/brands",
      "/brands/sneakers",
      "/timeline/nike.com",
      "/briefs/weekly",
      "/compare/visualping",
      "/sitemap.xml",
      "/de/sitemap.xml",
      "/for-agencies",
    ]) {
      expect(
        sitemapHreflangAlternates(path),
        `${path} must not emit alternates`,
      ).toBeUndefined();
    }
  });

  it("the root sitemap lists locale URLs as xhtml:link alternates, never as <loc>", () => {
    const xml = buildSitemapXml([]);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="de" href="${SITE}/de/pricing"/>`,
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/pricing"/>`,
    );
    // The issue's verify gate: locale URLs are present in the live sitemap.
    expect(xml.match(/\/de\/|\/ja\/|\/pt-br\//g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    // Issue #1561 holds: no locale URL becomes its own <loc>.
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      expect(xml).not.toContain(`<loc>${SITE}/${locale}/`);
    }
    // Pages with no locale cluster get none.
    const privacyBlock = xml
      .split("<url>")
      .find((block) => block.includes(`<loc>${SITE}/privacy</loc>`));
    expect(privacyBlock).toBeDefined();
    expect(privacyBlock).not.toContain("xhtml:link");
  });

  it("every buyer-surface static entry carries alternates", () => {
    const xml = buildSitemapXml([]);
    for (const path of BUYER_SURFACE_PATHS) {
      if (path === "/sitemap.xml") continue;
      const block = xml
        .split("<url>")
        .find((b) => b.includes(`<loc>${SITE}${path === "/" ? "/" : path}</loc>`));
      expect(block, `sitemap block for ${path}`).toBeDefined();
      expect(block, `${path} must carry xhtml:link alternates`).toContain(
        "xhtml:link",
      );
    }
  });

  it("locale sitemaps carry the same cluster on every entry", () => {
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const xml = buildLocaleSitemapXml(locale as BuyerSurfaceLocaleId);
      expect(xml).toContain(
        `<xhtml:link rel="alternate" hreflang="en" href="${SITE}/pricing"/>`,
      );
      expect(xml).toContain(
        `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/pricing"/>`,
      );
    }
  });
});
