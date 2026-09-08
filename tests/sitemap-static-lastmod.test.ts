import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LATEST_CHANGELOG_ENTRY_DATE,
  normalizeSitemapLastmod,
  renderSitemapXml,
  ROOT_SITEMAP_STATIC_ENTRIES,
  type SitemapEntry,
} from "~/lib/seo";
import { buildSitemapXml, indexableBrandPageEntriesFromRows, withStaticLastmod, type SitemapCacheRow } from "~/lib/sitemap.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

/** A populated, verified, public_search row that qualifies for the sitemap. */
function qualifyingRow(domain: string, fetchedAt: string, adCount = 3): SitemapCacheRow {
  return {
    cache_key: `search-v2:domain:${domain}:exact:meta_library_browser:all:page-1`,
    provider: "meta_library_browser",
    route_context: "public_search",
    payload_json: JSON.stringify({
      ads: Array.from({ length: adCount }, (_, i) => ({
        metaAdId: `${domain}-${i}`,
        source: "meta_library_browser",
        landingPageUrl: `https://${domain}/product`,
        domainMatch: {
          level: "registrable_domain",
          reason: `Landing page matches ${domain}`,
          matchedDomain: domain,
        },
        firstSeenAt: isoAgo(30 * DAY_MS),
        lastSeenAt: null,
        active: true,
        variantCount: 1,
      })),
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      searchIntent: "domain",
      displayDomain: domain,
    }),
    fetched_at: fetchedAt,
  };
}

function locsAndLastmods(xml: string): { locs: string[]; lastmods: string[] } {
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  const lastmods = [...xml.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map((m) => m[1]);
  return { locs, lastmods };
}

describe("sitemap static lastmod (issue #2031)", () => {
  it("every sitemap URL — static, /ads, and /timeline — carries a <lastmod>", () => {
    const brandEntries = indexableBrandPageEntriesFromRows(
      [qualifyingRow("allbirds.com", isoAgo(2 * DAY_MS)), qualifyingRow("ridgewallet.com", isoAgo(6 * DAY_MS))],
      new Date(),
    );
    expect(brandEntries.length).toBe(2);
    const xml = buildSitemapXml(brandEntries, [
      { path: "/timeline/calendly.com", lastmod: "2026-09-01", changefreq: "weekly", priority: "0.5" },
    ]);
    const { locs, lastmods } = locsAndLastmods(xml);
    expect(locs.length).toBe(ROOT_SITEMAP_STATIC_ENTRIES.length + brandEntries.length + 1);
    expect(lastmods.length).toBe(locs.length);
  });

  it("the no-DB fallback sitemap covers every static URL with a lastmod too", () => {
    const { locs, lastmods } = locsAndLastmods(
      renderSitemapXml(withStaticLastmod()),
    );
    expect(locs.length).toBeGreaterThan(0);
    expect(lastmods.length).toBe(locs.length);
  });

  it("every lastmod is W3C datetime (YYYY-MM-DD) and a real calendar date", () => {
    const brandEntries = indexableBrandPageEntriesFromRows(
      [qualifyingRow("allbirds.com", isoAgo(2 * DAY_MS))],
      new Date(),
    );
    const xml = buildSitemapXml(brandEntries);
    const { lastmods } = locsAndLastmods(xml);
    expect(lastmods.length).toBeGreaterThan(0);
    for (const lastmod of lastmods) {
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(normalizeSitemapLastmod(lastmod)).toBe(lastmod);
    }
  });

  it("a known-stale domain's lastmod is older than a fresh one's", () => {
    const fresh = indexableBrandPageEntriesFromRows([qualifyingRow("allbirds.com", isoAgo(2 * DAY_MS))], new Date());
    const stale = indexableBrandPageEntriesFromRows([qualifyingRow("ridgewallet.com", isoAgo(6 * DAY_MS))], new Date());
    expect(fresh[0].lastmod).toBeDefined();
    expect(stale[0].lastmod).toBeDefined();
    expect(stale[0].lastmod!.localeCompare(fresh[0].lastmod!)).toBeLessThan(0);
  });

  it("normalizeSitemapLastmod rejects malformed and impossible dates", () => {
    expect(normalizeSitemapLastmod(undefined)).toBeUndefined();
    expect(normalizeSitemapLastmod("")).toBeUndefined();
    expect(normalizeSitemapLastmod("not-a-date")).toBeUndefined();
    expect(normalizeSitemapLastmod("2026-09-06T00:00:00Z")).toBeUndefined();
    expect(normalizeSitemapLastmod("2026-02-31")).toBeUndefined();
    expect(normalizeSitemapLastmod("2026-09-06")).toBe("2026-09-06");
  });

  it("the changelog entry's lastmod equals the constant — and the constant matches the newest entry in app/routes/changelog.tsx (drift detector)", () => {
    const entries = withStaticLastmod([]);
    const changelogEntry = entries.find((entry: SitemapEntry) => entry.path === "/changelog");
    expect(changelogEntry?.lastmod).toBe(LATEST_CHANGELOG_ENTRY_DATE);

    const source = readFileSync("app/routes/changelog.tsx", "utf8");
    const titles = [...source.matchAll(/title="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(0);
    // The changelog route renders newest entry first, but the newest ISO date
    // is order-independent. The constant must equal it or the sitemap lies.
    expect(LATEST_CHANGELOG_ENTRY_DATE).toBe(titles.slice().sort().at(-1));
  });

  it("/brands tracks its newest capture, not the changelog date", () => {
    const brandEntries = indexableBrandPageEntriesFromRows(
      [qualifyingRow("allbirds.com", isoAgo(2 * DAY_MS))],
      new Date(),
    );
    const brandsEntry = withStaticLastmod(brandEntries).find((entry) => entry.path === "/brands");
    expect(brandsEntry?.lastmod).toBe(brandEntries[0].fetchedAt!.slice(0, 10));
    // Older than the changelog date constant? No — it must simply be a real
    // capture date; the /changelog entry still carries the content date.
    const changelogEntry = withStaticLastmod(brandEntries).find((entry) => entry.path === "/changelog");
    expect(changelogEntry?.lastmod).toBe(LATEST_CHANGELOG_ENTRY_DATE);
  });
});
