import { describe, expect, it } from "vitest";

import { BUYER_SURFACE_LOCALE_IDS } from "~/lib/locale-markets";
import { publicSeoFileForPathname } from "~/lib/seo";
import {
  buildLocaleSitemapXml,
  buildSitemapXml,
  staticSitemapEntriesForLocale,
} from "~/lib/sitemap.server";

/**
 * CI canary for locale-scoped sitemaps (issue #1561).
 *
 * The three shipped locales (de/fr/es) — plus the rest of
 * BUYER_SURFACE_LOCALE_IDS that the worker actually serves (ja, pt-br) —
 * must each emit a sitemap containing ONLY URLs rooted under their own
 * `/<locale>/` prefix, and no `<loc>` value may be byte-identical between the
 * root sitemap and a locale sitemap. Before #1561 the locale sitemaps
 * mirrored the root byte-for-byte, so a search engine saw the same 102 URLs
 * four (now six) times, fragmenting crawl budget and splitting PageRank.
 *
 * These two guards are the `accept` #4 / #5 canaries from the issue:
 *  - #4: each /<locale>/sitemap.xml URL has the matching /<locale>/ prefix,
 *  - #5: no <loc> is byte-identical between the root and a locale sitemap.
 */

const SITE = "https://0509.io";

function locsFromXml(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
}

const localePrefixFor = (locale: string) => `${SITE}/${locale}/`;

describe("locale sitemaps are locale-scoped (issue #1561, accept #4)", () => {
  it("serves a sitemap for every buyer-surface locale, non-empty only where translated content exists (issue #1570)", () => {
    // Issue #1570: byte-identical English locale pages were removed from the
    // sitemap. The only locale-prefixed sitemap entries left are the genuinely
    // translated sneaker-resale cluster (de, ja, pt-br). Locales with no
    // translated content (fr, es) emit an empty sitemap — correct, because
    // they have nothing indexable to advertise.
    const LOCALES_WITH_TRANSLATED_CONTENT = ["de", "ja", "pt-br"];
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const locs = locsFromXml(buildLocaleSitemapXml(locale));
      expect(staticSitemapEntriesForLocale(locale).length).toBe(locs.length);
      if (LOCALES_WITH_TRANSLATED_CONTENT.includes(locale)) {
        expect(
          locs.length,
          `/${locale}/sitemap.xml should have translated entries`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("lists ONLY /<locale>/-prefixed URLs in each locale sitemap", () => {
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const prefix = localePrefixFor(locale);
      for (const loc of locsFromXml(buildLocaleSitemapXml(locale))) {
        expect(
          loc.startsWith(prefix),
          `/${locale}/sitemap.xml leaked non-prefixed URL: ${loc}`,
        ).toBe(true);
      }
    }
  });
});

describe("root vs locale sitemap non-overlap (issue #1561, accept #3 + #5)", () => {
  it("keeps no <loc> byte-identical between the root and any locale sitemap", () => {
    const rootBody = buildSitemapXml([], []);
    const rootLocs = new Set(locsFromXml(rootBody));
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const loc of locsFromXml(buildLocaleSitemapXml(locale))) {
        expect(rootLocs.has(loc), `root duplicates locale ${locale} URL: ${loc}`).toBe(
          false,
        );
      }
    }
  });

  it("lists buyer-surface locale URLs in the root sitemap, grouped with hreflang alternates (issue #2030)", () => {
    // Issue #2030 reverses the #1570 doorway concern: instead of dozens of
    // discrete byte-identical <loc> entries, the buyer-surface locale cluster
    // is now listed with the reciprocal sitemap-hreflang alternate set, so
    // Google maps all six variants as one page. Locale subpaths (e.g.
    // /de/pricing, /ja/compare/panoramata) appear as <loc> entries, each
    // carrying an <xhtml:link hreflang> alternate for every sibling locale
    // plus the EN x-default.
    const rootBody = buildSitemapXml([], []);
    const rootLocs = locsFromXml(rootBody);

    // Every shipped locale is discoverable from the root feed.
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      expect(
        rootLocs.some((loc) => loc.startsWith(`${SITE}/${locale}/`)),
        `root sitemap must discover the ${locale} locale cluster`,
      ).toBe(true);
    }

    // A representative buyer-surface subpath is listed as a locale <loc>
    // AND carries the full reciprocal alternate set.
    const dePricing = `<loc>https://0509.io/de/pricing</loc>`;
    expect(rootBody).toContain(dePricing);
    const dePricingBlock = rootBody.match(
      /<url><loc>https:\/\/0509\.io\/de\/pricing<\/loc>\s*((?!<\/url>).)*<\/url>/s,
    )?.[0] ?? "";
    expect(dePricingBlock).toContain(
      `<xhtml:link rel="alternate" hreflang="de" href="https://0509.io/de/pricing"/>`,
    );
    expect(dePricingBlock).toContain(
      `<xhtml:link rel="alternate" hreflang="ja" href="https://0509.io/ja/pricing"/>`,
    );
    expect(dePricingBlock).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="https://0509.io/pricing"/>`,
    );
  });

  it("the EN sibling of each buyer-surface cluster also carries the alternates (issue #2030)", () => {
    // The sitemap hreflang pattern requires every URL in a cluster (including
    // the canonical EN page) to list the full reciprocal alternate set, so
    // Google does not see a one-way annotation.
    const rootBody = buildSitemapXml([], []);
    const enPricingBlock =
      rootBody.match(
        /<url><loc>https:\/\/0509\.io\/pricing<\/loc>\s*<changefreq>weekly<\/changefreq><priority>0\.8<\/priority>(.*?)<\/url>/s,
      )?.[1] ?? "";
    expect(enPricingBlock).toContain(
      `<xhtml:link rel="alternate" hreflang="de" href="https://0509.io/de/pricing"/>`,
    );
    expect(enPricingBlock).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="https://0509.io/pricing"/>`,
    );
  });

  it("keeps noindex/empty and the genuinely translated sneaker-resale cluster OUT of the root feed (issue #2030 accept #3)", () => {
    // The dynamic /ads/:domain brand pages never appear as static locale
    // entries; the honest-green sneaker-resale cluster stays only in its own
    // /<locale>/sitemap.xml (#1561). The root may NOT list sneaker-resale
    // locale URLs (they live in the locale feeds) nor any /ad locale page.
    const rootBody = buildSitemapXml([], []);
    expect(rootBody).not.toContain("<loc>https://0509.io/de/sneaker-resale</loc>");
    expect(rootBody).not.toContain("<loc>https://0509.io/ja/sneaker-resale</loc>");
    expect(rootBody).not.toContain("<loc>https://0509.io/pt-br/sneaker-resale</loc>");
    expect(rootBody).not.toContain("<loc>https://0509.io/de/ads/");
  });

  it("the static fallback sitemap (no-D1) lists the same locale cluster as the dynamic root", () => {
    const staticBody = publicSeoFileForPathname("/sitemap.xml")?.body ?? "";
    const staticLocs = locsFromXml(staticBody);
    // The no-DB fallback serves the same ROOT_SITEMAP_STATIC_ENTRIES catalog,
    // so it discovers the locale cluster too — the two feeds never drift.
    expect(
      staticLocs.some((loc) => loc.startsWith(`${SITE}/de/`)),
      "static fallback must share the locale cluster with the dynamic root",
    ).toBe(true);
    // The static fallback still covers the EN funnel.
    expect(staticBody).toContain("<loc>https://0509.io/pricing</loc>");
    expect(staticBody).toContain("<loc>https://0509.io/sneaker-resale</loc>");
  });
});
