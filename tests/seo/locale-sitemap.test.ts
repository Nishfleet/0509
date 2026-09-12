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
  it("serves de/ja/pt-br with only the sneaker-resale entry; fr/es serve empty feeds (issue #2962)", () => {
    // Issue #2962 (orchestrator Branch B) deleted the untranslated
    // buyer-surface locale routes, so the only indexable locale-sitemap
    // content left is the genuinely translated sneaker-resale cluster
    // (de, ja, pt-br — issues #1457/#1460). fr/es have no sneaker-resale
    // page and emit empty feeds robots.txt no longer advertises.
    for (const locale of ["de", "ja", "pt-br"] as const) {
      const entries = staticSitemapEntriesForLocale(locale);
      expect(entries.map((e) => e.path)).toEqual([`/${locale}/sneaker-resale`]);
      const locs = locsFromXml(buildLocaleSitemapXml(locale));
      expect(locs).toEqual([`${SITE}/${locale}/sneaker-resale`]);
    }
    for (const locale of ["fr", "es"] as const) {
      expect(staticSitemapEntriesForLocale(locale)).toEqual([]);
      expect(locsFromXml(buildLocaleSitemapXml(locale))).toEqual([]);
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
  it("no <loc> is byte-identical between the root and any locale sitemap", () => {
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

  it("the root sitemap contains no buyer-surface locale-prefixed URL at all", () => {
    const rootLocs = locsFromXml(buildSitemapXml([], []));
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const prefix = localePrefixFor(locale);
      for (const loc of rootLocs) {
        expect(
          loc.startsWith(prefix),
          `root sitemap lists a ${locale}-prefixed URL directly: ${loc}`,
        ).toBe(false);
      }
    }
  });

  it("the static fallback sitemap (no-D1) is scoped the same as the dynamic root", () => {
    const staticBody = publicSeoFileForPathname("/sitemap.xml")?.body ?? "";
    const staticLocs = locsFromXml(staticBody);
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const prefix = localePrefixFor(locale);
      for (const loc of staticLocs) {
        expect(
          loc.startsWith(prefix),
          `static fallback lists a ${locale}-prefixed URL directly: ${loc}`,
        ).toBe(false);
      }
    }
    // The static fallback still covers the EN funnel.
    expect(staticBody).toContain("<loc>https://0509.io/pricing</loc>");
    expect(staticBody).toContain("<loc>https://0509.io/sneaker-resale</loc>");
  });
});
