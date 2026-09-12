import { describe, expect, it } from "vitest";

import {
  LOCALE_SITEMAP_LOCALES,
  publicSeoFileForPathname,
} from "~/lib/seo";
import {
  buildLocaleSitemapXml,
  buildSitemapXml,
} from "~/lib/sitemap.server";
import { buildLlmsText } from "~/lib/public-markdown";
import {
  BUYER_SURFACE_LOCALE_IDS,
  type BuyerSurfaceLocaleId,
} from "~/lib/locale-markets";

/**
 * llms.txt ↔ reachable-sitemap sync canary (issue #2017, Option A per the
 * orchestrator decision; supersedes the issue's root-sitemap grep gate, which
 * would have reversed shipped issue #1561).
 *
 * The invariant under test: every public marketing URL llms.txt lists must be
 * reachable from a crawler sitemap entry point. "Reachable" means the root
 * sitemap OR a `/<locale>/sitemap.xml` that robots.txt advertises — NOT every
 * sitemap that happens to be served (#1561 keeps locale-prefixed URLs out of
 * the root, and #1570 keeps byte-identical English locale pages out of the
 * sitemaps entirely, so fr/es emit empty sitemaps that are deliberately NOT
 * advertised). Before #2017, robots.txt advertised only the root sitemap, so
 * `/de/sneaker-resale`, `/ja/sneaker-resale`, and `/pt-br/sneaker-resale`
 * were listed in llms.txt and in their locale sitemaps but had no path from
 * robots.txt — Google could never discover them.
 *
 * Locale `/ads/` variants are excluded from the llms-side set where the
 * dynamic-sitemap freshness gate already excludes them (stale/demo/noindex
 * brand shells are never emitted by either side; llmsPageForBrandPath returns
 * null for any locale-prefixed /ads path).
 */

const SITE = "https://0509.io";

function locsFromXml(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
}

function urlsFromLlmsText(text: string): string[] {
  return [...text.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1] ?? "");
}

const isLocaleAdsVariant = (url: string) =>
  BUYER_SURFACE_LOCALE_IDS.some((locale) =>
    url.startsWith(`${SITE}/${locale}/ads/`),
  );

/**
 * The canonical /timeline/:domain set the llms.txt↔sitemap sync canary feeds
 * to BOTH feeds (issue #2080). Includes calendly.com and adspyder.io — the two
 * timelines llms.txt advertised but the sitemap shipped without at observation
 * (2026-09-09) — plus nike.com as a control. Both `buildLlmsText` and
 * `buildSitemapXml` take this same list, so the canary fails the moment either
 * feed drops a timeline URL the other keeps.
 */
const TIMELINE_ENTRIES = [
  { path: "/timeline/calendly.com", lastmod: "2026-09-09" },
  { path: "/timeline/adspyder.io", lastmod: "2026-09-09" },
  { path: "/timeline/nike.com", lastmod: "2026-09-09" },
];

/** Root sitemap including the dynamic brand/timeline entries the live route appends. */
function reachableSitemapLocs() {
  const brandEntries = [
    { path: "/ads/nike.com", adCount: 12, fetchedAt: new Date().toISOString() },
  ];
  return new Set([
    ...locsFromXml(buildSitemapXml(brandEntries, TIMELINE_ENTRIES)),
    ...LOCALE_SITEMAP_LOCALES.flatMap((locale) =>
      locsFromXml(buildLocaleSitemapXml(locale)),
    ),
  ]);
}

describe("robots.txt advertises the non-empty locale sitemaps (issue #2017)", () => {
  it("lists a Sitemap line for the root plus every translated-locale sitemap", () => {
    const robots =
      publicSeoFileForPathname("/robots.txt")?.body ??
      (() => {
        throw new Error("robots.txt must be served");
      })();
    // Issue #2962 (orchestrator Branch B): LOCALE_SITEMAP_LOCALES is the
    // single source of truth for the advertised locale feeds — the
    // sneaker-resale-carrying de/ja/pt-br. fr/es emit empty feeds and must
    // NOT be advertised.
    const expected = [
      `${SITE}/sitemap.xml`,
      ...LOCALE_SITEMAP_LOCALES.map((locale) => `${SITE}/${locale}/sitemap.xml`),
    ];
    for (const url of expected) {
      expect(robots, `robots.txt must advertise ${url}`).toContain(
        `Sitemap: ${url}`,
      );
    }
    for (const locale of ["fr", "es"]) {
      expect(robots, `robots.txt must NOT advertise the empty ${locale} feed`).not.toContain(
        `Sitemap: ${SITE}/${locale}/sitemap.xml`,
      );
    }
  });

  it("never advertises an empty locale sitemap", () => {
    for (const locale of LOCALE_SITEMAP_LOCALES) {
      expect(
        locsFromXml(buildLocaleSitemapXml(locale)).length,
        `/${locale}/sitemap.xml is advertised but empty`,
      ).toBeGreaterThan(0);
    }
    // Issue #2962 (Branch B): fr/es carry no sneaker-resale page, so their
    // feeds are empty — they must stay OUT of the advertised set.
    for (const locale of ["fr", "es"] as const) {
      expect(LOCALE_SITEMAP_LOCALES).not.toContain(locale);
    }
  });
});

describe("llms.txt ↔ reachable sitemap sync (issue #2017 canary)", () => {
  it("every llms.txt URL is reachable from an advertised sitemap", () => {
    const reachable = reachableSitemapLocs();
    const llmsUrls = urlsFromLlmsText(
      buildLlmsText([{ path: "/ads/nike.com", adCount: 12 }], TIMELINE_ENTRIES),
    ).filter((url) => !isLocaleAdsVariant(url));
    expect(llmsUrls.length).toBeGreaterThan(0);
    for (const url of llmsUrls) {
      expect(
        reachable.has(url),
        `llms.txt lists ${url} but no advertised sitemap does`,
      ).toBe(true);
    }
  });

  it("every llms.txt timeline URL is present in the root sitemap (issue #2080)", () => {
    const llmsTimelineUrls = urlsFromLlmsText(
      buildLlmsText([], TIMELINE_ENTRIES),
    ).filter((url) => url.includes("/timeline/"));
    const sitemapLocs = locsFromXml(buildSitemapXml([], TIMELINE_ENTRIES));
    // The canary must actually exercise the timeline block, not pass vacuous.
    expect(llmsTimelineUrls.length).toBeGreaterThan(0);
    for (const url of llmsTimelineUrls) {
      expect(
        sitemapLocs.includes(url),
        `llms.txt advertises timeline ${url} but the sitemap does not list it`,
      ).toBe(true);
    }
  });

  it("every llms.txt /switch/:slug URL is present in the root sitemap (issue #2081)", () => {
    const llmsSwitchUrls = urlsFromLlmsText(buildLlmsText([], [])).filter((url) =>
      /\/switch\/(panoramata|visualping|magicbrief|adspy)$/.test(url),
    );
    const sitemapLocs = locsFromXml(buildSitemapXml([], []));
    expect(llmsSwitchUrls.sort()).toEqual([
      `${SITE}/switch/adspy`,
      `${SITE}/switch/magicbrief`,
      `${SITE}/switch/panoramata`,
      `${SITE}/switch/visualping`,
    ]);
    for (const url of llmsSwitchUrls) {
      expect(
        sitemapLocs.includes(url),
        `llms.txt advertises switch ${url} but the sitemap does not list it`,
      ).toBe(true);
    }
  });

  it("all sneaker-resale cluster URLs are sitemap-reachable; locale twins stay locale-sitemap-only (#1561, #3087)", () => {
    const reachable = reachableSitemapLocs();
    for (const path of [
      "/sneaker-resale",
      "/de/sneaker-resale",
      "/ja/sneaker-resale",
      "/pt-br/sneaker-resale",
    ]) {
      expect(
        reachable.has(`${SITE}${path}`),
        `${path} has no sitemap path to it`,
      ).toBe(true);
    }
    // Issue #3087: the root now carries the hub plus the four per-brand
    // below-retail cluster pages — the landing surface for the demand signal
    // is no longer a single URL. Still no duplicate per URL.
    const rootLocs = locsFromXml(buildSitemapXml([], []));
    const sneakerRootLocs = rootLocs.filter((loc) => loc.includes("sneaker-resale"));
    expect(sneakerRootLocs).toHaveLength(5);
    expect(new Set(sneakerRootLocs).size).toBe(5);
    for (const path of ["/sneaker-resale/nike", "/sneaker-resale/stockx", "/sneaker-resale/footlocker", "/sneaker-resale/jdsports"]) {
      expect(rootLocs).toContain(`${SITE}${path}`);
    }
    // Each locale sneaker-resale URL lives in its own locale sitemap only.
    const translated: readonly BuyerSurfaceLocaleId[] = ["de", "ja", "pt-br"];
    for (const locale of translated) {
      const locs = locsFromXml(buildLocaleSitemapXml(locale));
      expect(locs).toContain(`${SITE}/${locale}/sneaker-resale`);
    }
  });
});
