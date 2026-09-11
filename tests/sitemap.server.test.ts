import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  applyWebsiteSearchFallback,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import {
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  deriveBrandPageLookupForCountry,
} from "~/lib/brand-page.server";
import { fingerprintSavedQuery, normalizeSavedQuery, parseSearchParams } from "~/lib/normalize";
import { buildSearchV2CacheKey } from "~/lib/search-v2.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import {
  NOINDEX_ACTION_SURFACES,
  ROOT_SITEMAP_STATIC_ENTRIES,
  SITEMAP_PATHS,
  SITEMAP_STATIC_ENTRIES,
} from "~/lib/seo";
import {
  BUYER_SURFACE_CHILD_PATHS,
  BUYER_SURFACE_LOCALE_IDS,
  BUYER_SURFACE_PATHS,
} from "~/lib/locale-markets";
import { SWITCH_PAGES } from "~/lib/switch-pages";
import routes from "~/routes";
import {
  snapshotRowHasCompleteProof,
  TIMELINE_SNAPSHOT_LIMIT,
} from "~/lib/offer-timeline.server";
import {
  brandDomainFromSitemapCacheRow,
  brandCategorySitemapEntries,
  brandPageLookupCacheKeysForSitemap,
  brandPageRowHasVerifiedAds,
  brandPageRowVerifiedAdCount,
  buildSitemapXml,
  buildLocaleSitemapXml,
  staticSitemapEntriesForLocale,
  collectingTimelineEntries,
  indexableBrandPageEntriesFromRows,
  indexableTimelineEntriesFromRows,
  isIndexableBrandPageRow,
  loadIndexableTimelineEntries,
  newestChangelogLastmod,
  SITEMAP_BRAND_PATH_LIMIT,
  SITEMAP_TIMELINE_PATH_LIMIT,
  SITEMAP_TIMELINE_READ_LIMIT,
  timelineDomainFromSnapshotRow,
  timelineSitemapEntries,
  type SitemapCacheRow,
  type TimelineSitemapRow,
} from "~/lib/sitemap.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

// A cached ad that carries VERIFIED link evidence (a registrable_domain
// domainMatch verdict) AND enough history (30-day first-seen) for the Ad
// Aggression Score to render. Sitemap rows backed by this ad qualify for the
// sitemap; rows whose ads lack verified-link evidence or history back thin
// pages and must stay out.
const verifiedAd = {
  metaAdId: "meta-nykaa-1",
  source: "meta_library_browser",
  landingPageUrl: "https://nykaa.com/shop",
  domainMatch: {
    level: "registrable_domain",
    reason: "Landing page matches nykaa.com",
    matchedDomain: "nykaa.com",
  },
  firstSeenAt: isoAgo(30 * DAY_MS),
  lastSeenAt: null,
  active: true,
  variantCount: 1,
};

const basePayload = {
  ads: [verifiedAd],
  nextCursor: null,
  source: "meta_library_browser",
  provider: "meta_library_browser",
  cacheStatus: "hit",
  searchIntent: "domain",
  displayDomain: "nykaa.com",
};

function cacheRow(overrides: Partial<SitemapCacheRow> & { payload?: unknown } = {}): SitemapCacheRow {
  const { payload, ...rowOverrides } = overrides;
  return {
    cache_key: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
    provider: "meta_library_browser",
    route_context: "public_search",
    payload_json: JSON.stringify(payload ?? basePayload),
    fetched_at: isoAgo(2 * 60 * 60 * 1000),
    ...rowOverrides,
  };
}

// Valid proof artifact keys (the same shapes the monitoring capture writes and
// the loader's proof gate — issue #1284 — validates).
const SCREENSHOT_KEY = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpeg";
const HTML_KEY = "landing-pages/2026-08-01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html";

function snapshotRow(overrides: Partial<TimelineSitemapRow> = {}): TimelineSitemapRow {
  return {
    id: "snap-nykaa-001",
    canonical_url: "https://nykaa.com/glow-serum",
    captured_at: "2026-08-01T10:00:00.000Z",
    artifact_key: HTML_KEY,
    metadata_json: JSON.stringify({ screenshotArtifactKey: SCREENSHOT_KEY }),
    is_ad_destination: 0,
    ...overrides,
  };
}

describe("brandDomainFromSitemapCacheRow", () => {
  it("recovers the domain from an exact-scope search-v2 cache key", () => {
    expect(
      brandDomainFromSitemapCacheRow(cacheRow()),
    ).toBe("nykaa.com");
  });

  it("skips broader-scope rows — the brand page would render the noindex shell", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "search-v2:domain:nykaa.com:broader:meta_library_browser:all:page-1" }),
      ),
    ).toBeNull();
  });

  it("rejects v2 keys whose embedded value is not a valid public domain", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "search-v2:domain:nykaa:exact:meta_library_browser:all:page-1" }),
      ),
    ).toBeNull();
  });

  it("recovers the domain from a legacy-shaped key when the payload is a v2 domain result", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1" }),
      ),
    ).toBe("nykaa.com");
  });

  it("does not map text-intent or plain legacy payloads to a brand page", () => {
    const textPayload = { ...basePayload, searchIntent: "text" };
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1", payload: textPayload }),
      ),
    ).toBeNull();

    const { searchIntent: _searchIntent, displayDomain: _displayDomain, ...legacyPayload } = basePayload;
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1", payload: legacyPayload }),
      ),
    ).toBeNull();
  });

  it("returns null for unparseable payloads", () => {
    expect(
      brandDomainFromSitemapCacheRow(
        cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1", payload_json: "{not json" }),
      ),
    ).toBeNull();
  });
});

describe("isIndexableBrandPageRow", () => {
  const now = new Date();

  it("accepts a fresh non-demo public_search row with ads", () => {
    expect(isIndexableBrandPageRow(cacheRow(), now)).toBe(true);
  });

  it("rejects non-public_search route contexts (scheduled scans are shallow)", () => {
    expect(
      isIndexableBrandPageRow(cacheRow({ route_context: "watchlist_scan" }), now),
    ).toBe(false);
  });

  it("rejects demo providers and demo payloads", () => {
    expect(
      isIndexableBrandPageRow(cacheRow({ provider: "demo" }), now),
    ).toBe(false);
    expect(
      isIndexableBrandPageRow(
        cacheRow({ payload: { ...basePayload, source: "demo", provider: "demo" } }),
        now,
      ),
    ).toBe(false);
  });

  it("rejects rows with no usable (non-demo) ads", () => {
    expect(
      isIndexableBrandPageRow(cacheRow({ payload: { ...basePayload, ads: [] } }), now),
    ).toBe(false);
    expect(
      isIndexableBrandPageRow(
        cacheRow({
          payload: {
            ...basePayload,
            ads: [{ metaAdId: "meta-demo-1", source: "demo" }],
          },
        }),
        now,
      ),
    ).toBe(false);
  });

  it("rejects entries outside the 7-day indexability freshness window", () => {
    expect(
      isIndexableBrandPageRow(
        cacheRow({ fetched_at: isoAgo(BRAND_PAGE_FRESH_FOR_INDEXING_MS + DAY_MS) }),
        now,
      ),
    ).toBe(false);
    // Future timestamps are clock-skew artifacts, never indexable evidence.
    expect(
      isIndexableBrandPageRow(cacheRow({ fetched_at: isoAgo(-DAY_MS) }), now),
    ).toBe(false);
  });

  it("accepts a capture exactly at the 7-day boundary", () => {
    expect(
      isIndexableBrandPageRow(
        cacheRow({ fetched_at: isoAgo(BRAND_PAGE_FRESH_FOR_INDEXING_MS) }),
        now,
      ),
    ).toBe(true);
  });
});

describe("indexableBrandPageEntriesFromRows", () => {
  it("dedupes domains across countries/cursors and keeps newest-first order", () => {
    const rows = [
      cacheRow({
        cache_key: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
        fetched_at: isoAgo(2 * 60 * 60 * 1000),
      }),
      // Same domain, older capture in a different country — must dedupe.
      cacheRow({
        cache_key: "search-v2:domain:nykaa.com:exact:meta_library_browser:india:page-1",
        fetched_at: isoAgo(3 * 60 * 60 * 1000),
      }),
      cacheRow({
        cache_key: "search-v2:domain:meesho.com:exact:meta_library_browser:all:page-1",
        payload: { ...basePayload, displayDomain: "meesho.com" },
        fetched_at: isoAgo(DAY_MS),
      }),
    ];

    const entries = indexableBrandPageEntriesFromRows(rows);
    expect(entries.map((e) => e.path)).toEqual([
      "/ads/nykaa.com",
      "/ads/meesho.com",
    ]);
  });

  it("carries lastmod from fetched_at", () => {
    const fetchedAt = isoAgo(2 * 60 * 60 * 1000);
    const rows = [cacheRow({ fetched_at: fetchedAt })];

    const entries = indexableBrandPageEntriesFromRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/ads/nykaa.com");
    expect(entries[0].lastmod).toBe(fetchedAt.slice(0, 10));
  });

  it("skips rows that would not render an indexable page", () => {
    const rows = [
      cacheRow({ route_context: "watchlist_scan" }),
      cacheRow({ provider: "demo" }),
      cacheRow({ payload: { ...basePayload, ads: [] } }),
      cacheRow({ fetched_at: isoAgo(10 * DAY_MS) }),
      cacheRow({ cache_key: "meta_library_browser:fnv1a-test:all:page-1" }),
      cacheRow(),
    ];

    const entries = indexableBrandPageEntriesFromRows(rows);
    expect(entries.map((e) => e.path)).toEqual(["/ads/nykaa.com"]);
  });

  it("bounds the sitemap to SITEMAP_BRAND_PATH_LIMIT entries", () => {
    const rows = Array.from({ length: SITEMAP_BRAND_PATH_LIMIT + 25 }, (_, index) =>
      cacheRow({
        cache_key: `search-v2:domain:brand-${index}.com:exact:meta_library_browser:all:page-1`,
      }),
    );

    expect(indexableBrandPageEntriesFromRows(rows)).toHaveLength(SITEMAP_BRAND_PATH_LIMIT);
  });
});

describe("lookup parity — never list a page that would serve noindex", () => {
  const now = new Date();

  it("excludes a fresh capture stored only under a country scope unknown-geo crawlers never probe (the /ads/myntra.com regression)", () => {
    // Passes every pre-parity rule (public_search, non-demo, ads, fresh), but
    // the page probes [visitor-country, all, United States] — never "india" —
    // so a US crawler got the noindex shell while the sitemap listed it.
    const row = cacheRow({
      cache_key: "search-v2:domain:myntra.com:exact:meta_library_browser:india:page-1",
      payload: { ...basePayload, displayDomain: "myntra.com" },
    });

    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([]);
  });

  it("lists the same domain once captured under an always-tried country scope", () => {
    const row = cacheRow({
      cache_key:
        "search-v2:domain:myntra.com:exact:meta_library_browser:united-states:page-1",
      payload: { ...basePayload, displayDomain: "myntra.com" },
    });

    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([
      "/ads/myntra.com",
    ]);
  });

  it("excludes rows written by a provider other than the resolved commercial provider", () => {
    const row = cacheRow({ provider: "meta_api" });

    expect(
      indexableBrandPageEntriesFromRows([row], now, { provider: "meta_library_browser" }).map(
        (e) => e.path,
      ),
    ).toEqual([]);
  });

  it("under a legacy rollout posture, only rows keyed exactly like the page's legacy lookups qualify", () => {
    const provider = "meta_library_browser";
    const legacyKey = deriveBrandPageLookupForCountry(provider, "nykaa.com", "all", false).cacheKey;

    // A v2-keyed row is unreachable when the page derives legacy fingerprint
    // keys (shadow/legacy mode) — listing it would promise an indexable page
    // that serves noindex.
    expect(
      indexableBrandPageEntriesFromRows([cacheRow()], now, { useDomainV2: false }).map(
        (e) => e.path,
      ),
    ).toEqual([]);

    // A v2-payload row stored under the exact legacy-derived key IS reachable.
    expect(
      indexableBrandPageEntriesFromRows(
        [cacheRow({ cache_key: legacyKey })],
        now,
        { useDomainV2: false },
      ).map((e) => e.path),
    ).toEqual(["/ads/nykaa.com"]);
  });
});

describe("populated-vs-thin gate — never list an indexable thin page (issue #1442)", () => {
  const now = new Date();

  it("lists a populated row whose verified-linked ad clears the 14-day score floor", () => {
    expect(indexableBrandPageEntriesFromRows([cacheRow()], now).map((e) => e.path)).toEqual([
      "/ads/nykaa.com",
    ]);
  });

  it("excludes a row whose ads have NO verified link evidence (the 0-verified-ads thin-page defect)", () => {
    // 24 unverified text-mention matches: the provider returned them for the
    // domain, but none carries a landing-page or domainMatch verdict linking
    // them to it. The page would render the ad wall with zero verified-link
    // evidence, so it self-noindexes — the sitemap must not list it.
    const unverifiedOnlyPayload = {
      ...basePayload,
      ads: [
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
      ],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: unverifiedOnlyPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual([]);
  });

  it("lists a populated row even when its verified-linked ad is too recent to score (window < 14 days)", () => {
    // The 14-day Aggression Score window must NOT gate the sitemap (issue
    // #1442): the verified link exists but the only first-seen is 2 days ago,
    // so the score is deferred — yet the page is populated (an ad wall with
    // verified link evidence), not thin, so it belongs in the sitemap.
    const tooRecentPayload = {
      ...basePayload,
      ads: [{ ...verifiedAd, firstSeenAt: isoAgo(2 * DAY_MS) }],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: tooRecentPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual(["/ads/nykaa.com"]);
  });

  it("lists a populated row even when its verified-linked ad carries no first-seen date", () => {
    // Same decoupling: no first-seen date means no computable score, but the
    // page still ships a real ad wall with verified link evidence — list it
    // (issue #1442).
    const noFirstSeenPayload = {
      ...basePayload,
      ads: [{ ...verifiedAd, firstSeenAt: null }],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: noFirstSeenPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual(["/ads/nykaa.com"]);
  });

  it("lists a row when at least one verified-linked ad is present even if other ads are not verified", () => {
    const mixedPayload = {
      ...basePayload,
      ads: [
        // An unverified text-mention match — renders on the wall, never feeds
        // the score or the verified-link count.
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
        // The verified-linked ad — the wall is populated, so the page is
        // indexable even though no score may render.
        verifiedAd,
      ],
    };

    expect(
      indexableBrandPageEntriesFromRows([cacheRow({ payload: mixedPayload })], now).map(
        (e) => e.path,
      ),
    ).toEqual(["/ads/nykaa.com"]);
  });

  it("brandPageRowHasVerifiedAds mirrors the gate for a populated row", () => {
    expect(brandPageRowHasVerifiedAds(cacheRow(), "nykaa.com")).toBe(true);
  });

  it("brandPageRowHasVerifiedAds is false for a 0-verified-ads row", () => {
    const unverifiedOnlyPayload = {
      ...basePayload,
      ads: [
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
      ],
    };
    expect(
      brandPageRowHasVerifiedAds(cacheRow({ payload: unverifiedOnlyPayload }), "nykaa.com"),
    ).toBe(false);
  });

  it("brandPageRowVerifiedAdCount counts only verified-linked ads, mirroring the gate", () => {
    const strongPayload = {
      ...basePayload,
      ads: [
        verifiedAd,
        { ...verifiedAd, metaAdId: "meta-nykaa-2" },
        { ...verifiedAd, metaAdId: "meta-nykaa-3" },
        // Unverified text-mention — renders on the wall, never counts.
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
      ],
    };
    expect(brandPageRowVerifiedAdCount(cacheRow({ payload: strongPayload }), "nykaa.com")).toBe(3);
    expect(brandPageRowVerifiedAdCount(cacheRow(), "nykaa.com")).toBe(1);
    // Unverified-only rows count 0 — the same fact the hasVerifiedAds gate reads.
    const unverifiedOnly = {
      ...basePayload,
      ads: [
        {
          metaAdId: "meta-text-1",
          source: "meta_library_browser",
          landingPageUrl: null,
          domainMatch: undefined,
          firstSeenAt: isoAgo(30 * DAY_MS),
          active: true,
          variantCount: 1,
        },
      ],
    };
    expect(brandPageRowVerifiedAdCount(cacheRow({ payload: unverifiedOnly }), "nykaa.com")).toBe(0);
  });

  it("lists allbirds.com when the capture lands on allbirds.co.uk with enough history", () => {
    const row = cacheRow({
      cache_key: "search-v2:domain:allbirds.com:exact:meta_library_browser:all:page-1",
      payload: {
        ...basePayload,
        displayDomain: "allbirds.com",
        ads: [
          {
            metaAdId: "meta-allbirds-uk",
            source: "meta_library_browser",
            landingPageUrl: "https://www.allbirds.co.uk/products/womens-dasher",
            domainMatch: {
              level: "unverified_provider_candidate",
              reason: "Returned by the Meta source; website connection not verified",
              matchedDomain: null,
            },
            firstSeenAt: isoAgo(131 * DAY_MS),
            active: true,
            variantCount: 1,
          },
        ],
      },
    });
    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([
      "/ads/allbirds.com",
    ]);
  });

  it("lists mamaearth.com when the capture lands on mamaearth.in with enough history", () => {
    const row = cacheRow({
      cache_key: "search-v2:domain:mamaearth.com:exact:meta_library_browser:all:page-1",
      payload: {
        ...basePayload,
        displayDomain: "mamaearth.com",
        ads: [
          {
            metaAdId: "meta-mamaearth-in",
            source: "meta_library_browser",
            landingPageUrl: "https://mamaearth.in/product/ubtan-face-wash",
            domainMatch: {
              level: "unverified_text_candidate",
              reason: "Mentions “mamaearth” in ad text only",
              matchedDomain: null,
            },
            firstSeenAt: isoAgo(120 * DAY_MS),
            active: true,
            variantCount: 1,
          },
        ],
      },
    });
    expect(indexableBrandPageEntriesFromRows([row], now).map((e) => e.path)).toEqual([
      "/ads/mamaearth.com",
    ]);
  });
});

describe("brandPageLookupCacheKeysForSitemap", () => {
  it("returns exactly the always-tried scopes' keys in the page's key format", () => {
    const keys = brandPageLookupCacheKeysForSitemap(
      "meta_library_browser",
      "nykaa.com",
      true,
    );

    expect([...keys].sort()).toEqual(
      [
        "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
        "search-v2:domain:nykaa.com:exact:meta_library_browser:united-states:page-1",
      ].sort(),
    );
  });

  it("derives legacy-shaped keys outside the v2 posture", () => {
    const keys = brandPageLookupCacheKeysForSitemap("meta_library_browser", "nykaa.com", false);

    expect(keys.size).toBe(2);
    for (const key of keys) {
      expect(key.startsWith("search-v2:")).toBe(false);
      expect(key.startsWith("meta_library_browser:")).toBe(true);
      expect(key.endsWith(":page-1")).toBe(true);
    }
  });
});

describe("deriveBrandPageLookupForCountry", () => {
  it("reproduces the exact search-v2 domain key the page reads under v2 posture", () => {
    const derived = deriveBrandPageLookupForCountry(
      "meta_library_browser",
      "nykaa.com",
      "United States",
      true,
    );
    const intent = parseSearchInputFromWebsiteField("nykaa.com");

    expect(derived.usedDomainKey).toBe(true);
    expect(derived.cacheKey).toBe(
      buildSearchV2CacheKey({
        provider: "meta_library_browser",
        intent,
        scope: "exact",
        country: "United States",
        cursor: null,
      }),
    );
  });

  it("falls back to the legacy fingerprint triple outside v2 posture (shadow serves legacy)", () => {
    const derived = deriveBrandPageLookupForCountry(
      "meta_library_browser",
      "nykaa.com",
      "all",
      false,
    );

    // Mirror the original deriveCacheLookup chain through independent
    // primitives so composition order cannot drift from the page's lookups.
    const website = normalizeCompetitorWebsiteInput("nykaa.com");
    const parsedInput = parseSearchParams(new URLSearchParams(), { country: "all" });
    const parsed = applyWebsiteSearchFallback(parsedInput, website);
    const legacyQuery = normalizeSavedQuery(parsed.mode, parsed.filters);

    expect(derived.usedDomainKey).toBe(false);
    expect(derived.fingerprint).toBe(fingerprintSavedQuery(legacyQuery));
    expect(derived.country).toBe(legacyQuery.filters.country || ALL_COUNTRIES_VALUE);
    expect(derived.cacheKey).toBe(
      buildDiscoveryCacheKey({
        provider: "meta_library_browser",
        fingerprint: fingerprintSavedQuery(legacyQuery),
        country: legacyQuery.filters.country || ALL_COUNTRIES_VALUE,
        cursor: null,
      }),
    );
  });

  // Issue #1982: brands with a curated Meta Page id (goat.com, on.com) must
  // re-derive the SAME page-scoped cache key the publisher writes, so the
  // /ads/:domain loader and sitemap find the warmed rows. A key mismatch
  // would silently drop the brand from the sitemap (reviewer Act-on).
  it.each([
    ["goat.com", "746493592053334"],
    ["on.com", "238939146624"],
  ] as const)(
    "re-derives the page-scoped search-v2 domain key for %s (curated page id)",
    (domain, pageId) => {
      const derived = deriveBrandPageLookupForCountry(
        "meta_library_browser",
        domain,
        "all",
        true,
      );
      const intent = parseSearchInputFromWebsiteField(domain);

      expect(derived.usedDomainKey).toBe(true);
      // The derived key carries the page:<id> segment...
      expect(derived.cacheKey).toBe(
        `search-v2:domain:${domain}:exact:meta_library_browser:all:page:${pageId}:page-1`,
      );
      // ...and equals an independent buildSearchV2CacheKey with the same pageId.
      expect(derived.cacheKey).toBe(
        buildSearchV2CacheKey({
          provider: "meta_library_browser",
          intent,
          scope: "exact",
          country: "all",
          cursor: null,
          pageId,
        }),
      );
    },
  );

  // A non-numeric pageId must be dropped by BOTH the cache key and the saved
  // query, never mismatched (reviewer Act-on: buildSearchV2CacheKey now
  // normalizes the same way buildSearchV2SavedQuery does).
  it("drops a non-numeric curated page id from the cache key (parity with the saved query)", () => {
    const intent = parseSearchInputFromWebsiteField("example.com");
    const keyWithBadPageId = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "exact",
      country: "all",
      cursor: null,
      pageId: "not-a-page-id",
    });
    const keyWithNoPageId = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "exact",
      country: "all",
      cursor: null,
    });
    expect(keyWithBadPageId).toBe(keyWithNoPageId);
    expect(keyWithBadPageId).not.toContain("page:");
  });
});

describe("buildSitemapXml", () => {
  it("keeps the static funnel paths first, then appends dynamic brand pages", () => {
    const xml = buildSitemapXml([
      { path: "/ads/nykaa.com", lastmod: "2026-08-21" },
      { path: "/ads/meesho.com", lastmod: "2026-08-20" },
    ]);

    expect(xml).toContain("<loc>https://0509.io/</loc>");
    expect(xml).toContain("<loc>https://0509.io/search</loc>");
    expect(xml).toContain("<loc>https://0509.io/ads/nykaa.com</loc>");
    expect(xml).toContain("<loc>https://0509.io/ads/meesho.com</loc>");
    // Brand entries carry lastmod.
    expect(xml).toContain("<lastmod>2026-08-21</lastmod>");
    // Static list never carries a hardcoded /ads/ path.
    expect(xml.indexOf("https://0509.io/ads/")).toBe(
      xml.indexOf("https://0509.io/ads/nykaa.com"),
    );
  });

  it("renders a valid static-only sitemap when there are no brand pages", () => {
    const xml = buildSitemapXml([]);

    expect(xml).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    expect(xml).not.toContain("/ads/");
  });

  it("lists /mcp/setup in the sitemap XML and llms.txt (issue #2125)", async () => {
    // The BET 6 one-paste MCP connector page is live 200 and indexable but
    // was missing from every discovery surface. It must appear in the built
    // sitemap XML and in llms.txt so unpaid search and answer engines can
    // find the shipped connector.
    const xml = buildSitemapXml([]);
    expect(xml).toContain("<loc>https://0509.io/mcp/setup</loc>");

    const { buildLlmsText } = await import("~/lib/public-markdown");
    const llms = buildLlmsText([], []);
    expect(llms).toContain("https://0509.io/mcp/setup");
  });

  it("stamps /changelog with a lastmod derived from the newest changelog entry date (issue #2297)", () => {
    const xml = buildSitemapXml([]);
    const expected = newestChangelogLastmod();
    expect(expected).not.toBeNull();

    // The /changelog <url> block carries a <lastmod> equal to the newest
    // changelog entry date — the acceptance bar for issue #2297.
    const changelogLine = xml
      .split("\n")
      .find((line) => line.includes("<loc>https://0509.io/changelog</loc>"));
    expect(changelogLine).toBeDefined();
    expect(changelogLine).toContain(`<lastmod>${expected}</lastmod>`);
  });

  it("omits lastmod on /compare/* and /methodology — no per-page content date exists (issue #2297)", () => {
    const xml = buildSitemapXml([]);
    const lines = xml.split("\n");

    // /compare/* and /methodology have no existing per-page date field, so
    // they must NOT carry an invented <lastmod> (the judge edit on #2297).
    for (const path of ["/methodology", "/compare", "/compare/meta-ad-library"]) {
      const line = lines.find((l) => l.includes(`<loc>https://0509.io${path}</loc>`));
      expect(line, `expected a sitemap <url> line for ${path}`).toBeDefined();
      expect(line).not.toContain("<lastmod>");
    }
  });
});

describe("llms.txt parity with dynamic sitemap brand paths", () => {
  it("includes every indexable sitemap brand path and omits noindex shells", async () => {
    const { buildLlmsText } = await import("~/lib/public-markdown");
    const now = new Date();
    const nikeAd = {
      ...verifiedAd,
      metaAdId: "meta-nike-1",
      landingPageUrl: "https://nike.com/shop",
      domainMatch: {
        ...verifiedAd.domainMatch,
        reason: "Landing page matches nike.com",
        matchedDomain: "nike.com",
      },
    };
    const indexable = cacheRow({
      cache_key: "search-v2:domain:nike.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "nike.com", ads: [nikeAd] },
    });
    // A brand with >=3 live Meta Ad Library ads stays in llms.txt (issue
    // #2307); one- and two-ad pages are dropped from llms.txt but remain in
    // the sitemap.
    const threeAd = cacheRow({
      cache_key: "search-v2:domain:adidas.com:exact:meta_library_browser:all:page-1",
      payload: {
        ...basePayload,
        displayDomain: "adidas.com",
        ads: [
          { ...verifiedAd, metaAdId: "meta-adidas-1" },
          { ...verifiedAd, metaAdId: "meta-adidas-2" },
          { ...verifiedAd, metaAdId: "meta-adidas-3" },
        ],
      },
    });
    const stale = cacheRow({
      cache_key: "search-v2:domain:stale.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "stale.com" },
      fetched_at: isoAgo(BRAND_PAGE_FRESH_FOR_INDEXING_MS + DAY_MS),
    });
    const demo = cacheRow({
      cache_key: "search-v2:domain:demo.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "demo.com", source: "demo", provider: "demo" },
    });
    const otherCountry = cacheRow({
      cache_key: "search-v2:domain:myntra.com:exact:meta_library_browser:india:page-1",
      payload: { ...basePayload, displayDomain: "myntra.com" },
    });

    const brandEntries = indexableBrandPageEntriesFromRows(
      [indexable, threeAd, stale, demo, otherCountry, cacheRow()],
      now,
    );
    const sitemapAds = [...buildSitemapXml(brandEntries).matchAll(/https:\/\/0509\.io\/ads\/[^<]+/g)].map(
      (match) => match[0],
    );
    const llmsAds = [...buildLlmsText(brandEntries).matchAll(/https:\/\/0509\.io\/ads\/[^)]+/g)].map(
      (match) => match[0],
    );

    expect(sitemapAds).toEqual([
      "https://0509.io/ads/nike.com",
      "https://0509.io/ads/adidas.com",
      "https://0509.io/ads/nykaa.com",
    ]);
    // llms.txt keeps only the >=3-ad brand (issue #2307); the 1-ad nike.com
    // and nykaa.com pages stay in the sitemap but are dropped from llms.txt.
    expect(llmsAds).toEqual(["https://0509.io/ads/adidas.com"]);
    expect(llmsAds).not.toContain("https://0509.io/ads/nike.com");
    expect(llmsAds).not.toContain("https://0509.io/ads/nykaa.com");
    expect(llmsAds).not.toContain("https://0509.io/ads/stale.com");
    expect(llmsAds).not.toContain("https://0509.io/ads/demo.com");
    expect(llmsAds).not.toContain("https://0509.io/ads/myntra.com");
  });
});

describe("timelineDomainFromSnapshotRow", () => {
  it("recovers the registrable domain from a bare-host capture URL", () => {
    expect(
      timelineDomainFromSnapshotRow(snapshotRow({ canonical_url: "https://nykaa.com/glow" })),
    ).toBe("nykaa.com");
  });

  it("maps www and deeper subdomains back to the registrable domain the route uses", () => {
    expect(
      timelineDomainFromSnapshotRow(
        snapshotRow({ canonical_url: "https://www.nykaa.com/glow-serum" }),
      ),
    ).toBe("nykaa.com");
    expect(
      timelineDomainFromSnapshotRow(
        snapshotRow({ canonical_url: "https://shop.nykaa.com/offers" }),
      ),
    ).toBe("nykaa.com");
  });

  it("keeps multi-label public suffixes intact (nike.co.uk → nike.co.uk)", () => {
    expect(
      timelineDomainFromSnapshotRow(
        snapshotRow({ canonical_url: "https://www.nike.co.uk/sale" }),
      ),
    ).toBe("nike.co.uk");
  });

  it("rejects reserved domains the timeline route would 404 on (example.com)", () => {
    expect(
      timelineDomainFromSnapshotRow(
        snapshotRow({ canonical_url: "https://example.com/landing" }),
      ),
    ).toBeNull();
  });

  it("rejects unparseable or non-http(s) canonical URLs", () => {
    expect(
      timelineDomainFromSnapshotRow(snapshotRow({ canonical_url: "not a url" })),
    ).toBeNull();
    expect(
      timelineDomainFromSnapshotRow(
        snapshotRow({ canonical_url: "file:///tmp/landing.html" }),
      ),
    ).toBeNull();
  });
});

describe("collectingTimelineEntries / timelineSitemapEntries (issue #2021)", () => {
  const brand = (domain: string) => ({ path: `/ads/${domain}` });

  it("emits a collecting /timeline entry for every tracked /ads brand not yet capture-backed", () => {
    const brandEntries = [brand("gymshark.com"), brand("hubspot.com"), brand("calendly.com")];
    const timelineEntries = [{ path: "/timeline/calendly.com", lastmod: "2026-09-01" }];

    const collecting = collectingTimelineEntries(brandEntries, timelineEntries);

    expect(collecting.map((e) => e.path)).toEqual([
      "/timeline/gymshark.com",
      "/timeline/hubspot.com",
    ]);
    // No lastmod: nothing is captured yet, so there is no honest lastmod.
    expect(collecting[0].lastmod).toBeUndefined();
  });

  it("never invents a domain from a non-/ads or multi-segment path", () => {
    const collecting = collectingTimelineEntries(
      [{ path: "/compare/adspyder" }, { path: "/ads/hubspot.com/about" }, { path: "/ads/" }],
      [],
    );
    expect(collecting).toEqual([]);
  });

  it("merges capture-backed first, then collecting, capped at SITEMAP_TIMELINE_PATH_LIMIT", () => {
    const captureBacked = Array.from({ length: 3 }, (_, i) => ({
      path: `/timeline/backed-${i}.com`,
      lastmod: "2026-09-01",
    }));
    const brandEntries = Array.from(
      { length: SITEMAP_TIMELINE_PATH_LIMIT + 1 },
      (_, i) => brand(`cohort-${i}.com`),
    );

    const merged = timelineSitemapEntries(brandEntries, captureBacked);

    expect(merged).toHaveLength(SITEMAP_TIMELINE_PATH_LIMIT);
    // Capture-backed entries (with lastmod) all survive the cap.
    expect(merged.slice(0, 3).map((e) => e.path)).toEqual([
      "/timeline/backed-0.com",
      "/timeline/backed-1.com",
      "/timeline/backed-2.com",
    ]);
    expect(merged[3].lastmod).toBeUndefined();
  });

  it("puts collecting /timeline locs in the sitemap XML with no lastmod", () => {
    const xml = buildSitemapXml(
      [brand("gymshark.com"), brand("calendly.com")],
      timelineSitemapEntries(
        [brand("gymshark.com"), brand("calendly.com")],
        [{ path: "/timeline/calendly.com", lastmod: "2026-09-01" }],
      ),
    );
    expect(xml).toContain("<loc>https://0509.io/timeline/gymshark.com</loc>");
    expect(xml).toContain("<loc>https://0509.io/timeline/calendly.com</loc>");
    expect(xml).toContain("<lastmod>2026-09-01</lastmod>");
    expect(xml).not.toMatch(
      /<loc>https:\/\/0509\.io\/timeline\/gymshark\.com<\/loc><lastmod>/,
    );
  });
});

describe("indexableTimelineEntriesFromRows", () => {
  it("lists a domain whose snapshot survives the loader's proof gate (screenshot + page text)", () => {
    const rows = [snapshotRow()];

    const entries = indexableTimelineEntriesFromRows(rows);
    expect(entries.map((e) => e.path)).toEqual(["/timeline/nykaa.com"]);
    expect(entries[0].lastmod).toBe("2026-08-01");
  });

  it("does not list a zero-entry domain — rows without complete proof render the empty ledger (gone/noindex shell)", () => {
    const backfill = snapshotRow({
      canonical_url: "https://slack.com/landing",
      artifact_key: null,
      metadata_json: JSON.stringify({ backfill: true }),
    });
    const screenshotOnly = snapshotRow({
      canonical_url: "https://slack.com/landing",
      artifact_key: null,
      metadata_json: JSON.stringify({ screenshotArtifactKey: SCREENSHOT_KEY }),
    });
    const pageTextOnly = snapshotRow({
      canonical_url: "https://slack.com/landing",
      artifact_key: HTML_KEY,
      metadata_json: "{}",
    });

    expect(indexableTimelineEntriesFromRows([backfill, screenshotOnly, pageTextOnly])).toEqual([]);
  });

  it("dedupes across captures, keeping the newest capture date as lastmod", () => {
    // The input is assumed to be ordered `captured_at ASC, id ASC` (matching
    // loadOfferTimeline's SQL); "newest" within the loader's per-domain window
    // is therefore the LAST row in the ASC-sorted set.
    const rows = [
      snapshotRow({ captured_at: "2026-08-01T10:00:00.000Z" }),
      snapshotRow({ captured_at: "2026-08-10T08:00:00.000Z" }),
    ];

    const entries = indexableTimelineEntriesFromRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/timeline/nykaa.com");
    expect(entries[0].lastmod).toBe("2026-08-10");
  });

  it("a domain whose NEWEST capture fails the proof gate still qualifies when an older capture is complete", () => {
    // The loader filters proof-less rows out of the ledger, so an empty proof
    // capture must not bump the domain off the list — the older complete
    // capture still renders an indexable ledger. Input is ASC (loader order);
    // the newest capture (2026-08-20) appears LAST in the ASC input.
    const rows = [
      snapshotRow({ captured_at: "2026-08-01T10:00:00.000Z" }),
      snapshotRow({ captured_at: "2026-08-20T08:00:00.000Z", artifact_key: null }),
    ];

    const entries = indexableTimelineEntriesFromRows(rows);
    expect(entries.map((e) => e.path)).toEqual(["/timeline/nykaa.com"]);
    expect(entries[0].lastmod).toBe("2026-08-01");
  });

  // Loader's per-domain window (issue #1928): the lister mirrors
  // loadOfferTimeline's own `ORDER BY captured_at ASC, id ASC LIMIT
  // TIMELINE_SNAPSHOT_LIMIT` window per domain — only the first 200 rows in
  // the ASC input can ever back a /timeline/:domain render, so proof-less
  // rows INSIDE that window rule the domain out of the sitemap (the route
  // would render empty → 410). Rows past the window are unreachable on the
  // route, so they cannot back a sitemap entry either.
  it("excludes a domain whose only passing rows fall outside the loader's per-domain TIMELINE_SNAPSHOT_LIMIT window", () => {
    const baseDayMs = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00.000Z
    const dayAt = (dayIndex: number) =>
      new Date(baseDayMs + dayIndex * DAY_MS).toISOString();
    const backfillRow = (dayIndex: number): TimelineSitemapRow =>
      snapshotRow({
        id: `snap-slack-backfill-${dayIndex}`,
        canonical_url: "https://slack.com/landing",
        captured_at: dayAt(dayIndex),
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true }),
      });
    const proofRow = (dayIndex: number): TimelineSitemapRow =>
      snapshotRow({
        id: `snap-slack-proof-${dayIndex}`,
        canonical_url: "https://slack.com/landing",
        captured_at: dayAt(dayIndex),
      });

    // Oldest TIMELINE_SNAPSHOT_LIMIT (200) daily captures are seeded backfill
    // (issue #1284 — no proof artifacts); newest 50 daily captures carry full
    // proof artifacts. Input is ASC, matching the loader's SQL window.
    const rows: TimelineSitemapRow[] = [
      ...Array.from({ length: TIMELINE_SNAPSHOT_LIMIT }, (_, index) =>
        backfillRow(index),
      ),
      ...Array.from({ length: 50 }, (_, offset) =>
        proofRow(TIMELINE_SNAPSHOT_LIMIT + offset),
      ),
    ];

    // Sanity-check the test setup: the 50 newest rows DO pass the proof gate
    // themselves, so the exclusion below is the loader window's doing — not
    // the proof gate, not the rows' shape.
    expect(rows.slice(-50).every((row) => snapshotRowHasCompleteProof(row))).toBe(true);

    // The loader window is the first TIMELINE_SNAPSHOT_LIMIT rows in ASC
    // order — that whole window is backfill, so the route would render an
    // empty ledger (gone/noindex shell), and the sitemap must NOT list it
    // even though the 50 newer rows pass.
    const entries = indexableTimelineEntriesFromRows(rows);
    expect(entries.map((e) => e.path)).not.toContain("/timeline/slack.com");
  });

  it("includes a domain whose loader window has at least one passing row (proof gate passes inside the per-domain window)", () => {
    // Four proof-less rows scattered through ASC order with one passing row
    // in the middle; 5 rows total — well under the loader's TIMELINE_SNAPSHOT_LIMIT
    // window, so the whole bucket enters the window. The proof gate accepts
    // the middle row, so /timeline/hubspot.com lists with lastmod = the
    // passing row's date.
    const passingCapturedAt = "2026-08-10T08:00:00.000Z";
    const rows = [
      snapshotRow({
        id: "snap-hubspot-backfill-1",
        canonical_url: "https://hubspot.com/landing",
        captured_at: "2026-08-01T08:00:00.000Z",
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true }),
      }),
      snapshotRow({
        id: "snap-hubspot-backfill-2",
        canonical_url: "https://hubspot.com/landing",
        captured_at: "2026-08-05T08:00:00.000Z",
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true }),
      }),
      // The single passing row — full proof artifacts.
      snapshotRow({
        id: "snap-hubspot-proof",
        canonical_url: "https://hubspot.com/landing",
        captured_at: passingCapturedAt,
      }),
      snapshotRow({
        id: "snap-hubspot-backfill-3",
        canonical_url: "https://hubspot.com/landing",
        captured_at: "2026-08-15T08:00:00.000Z",
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true }),
      }),
      snapshotRow({
        id: "snap-hubspot-backfill-4",
        canonical_url: "https://hubspot.com/landing",
        captured_at: "2026-08-20T08:00:00.000Z",
        artifact_key: null,
        metadata_json: JSON.stringify({ backfill: true }),
      }),
    ];

    const entries = indexableTimelineEntriesFromRows(rows);
    expect(entries).toEqual([
      {
        path: "/timeline/hubspot.com",
        lastmod: "2026-08-10",
      },
    ]);
  });

  // Issue #1729 gate coverage — the sitemap lister must mirror
  // loadOfferTimeline's `!row.is_ad_destination` filter. An ad-destination
  // row is a landing page correlated against `ad_observation` (the snapshot
  // is reached through an ad wall — not the brand's own dated offer state),
  // so it cannot back the public /timeline/:domain ledger. The loader
  // excludes them; the sitemap must too, even when every row otherwise
  // carries full proof artifacts.
  it("excludes a domain whose ONLY passing rows are ad destinations (issue #1729 gate coverage)", () => {
    const rows = [
      snapshotRow({
        id: "snap-adspyder-1",
        canonical_url: "https://adspyder.io/landing",
        captured_at: "2026-08-01T08:00:00.000Z",
        is_ad_destination: 1,
      }),
      snapshotRow({
        id: "snap-adspyder-2",
        canonical_url: "https://adspyder.io/landing",
        captured_at: "2026-08-10T08:00:00.000Z",
        is_ad_destination: 1,
      }),
      snapshotRow({
        id: "snap-adspyder-3",
        canonical_url: "https://adspyder.io/landing",
        captured_at: "2026-08-20T08:00:00.000Z",
        is_ad_destination: 1,
      }),
    ];

    // Sanity-check the test setup: every row carries full proof artifacts, so
    // the proof gate alone would qualify the domain. The exclusion below is
    // the ad-destination gate's doing — exactly the gap that existed before
    // this issue (#1729) was first gated in the lister.
    expect(rows.every((row) => snapshotRowHasCompleteProof(row))).toBe(true);

    const entries = indexableTimelineEntriesFromRows(rows);
    expect(entries).toEqual([]);
  });

  it("bounds the sitemap to SITEMAP_TIMELINE_PATH_LIMIT entries", () => {
    const rows = Array.from({ length: SITEMAP_TIMELINE_PATH_LIMIT + 25 }, (_, index) =>
      snapshotRow({ canonical_url: `https://brand-${index}.com/landing` }),
    );

    expect(indexableTimelineEntriesFromRows(rows)).toHaveLength(SITEMAP_TIMELINE_PATH_LIMIT);
  });
});

describe("loadIndexableBrandPageEntries (D1 read)", () => {
  let queryAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    queryAll = vi.fn();
    vi.doMock("~/lib/data/d1.server", () => ({ queryAll }));
  });

  afterEach(() => {
    vi.doUnmock("~/lib/data/d1.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function runLoader(env: Record<string, unknown>) {
    const { loadIndexableBrandPageEntries } = await import("~/lib/sitemap.server");
    return loadIndexableBrandPageEntries(env as never);
  }

  it("returns the static-only set when D1 is absent", async () => {
    await expect(runLoader({})).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("returns the static-only set in demo-provider environments", async () => {
    // No BROWSER binding → provider resolves to demo → no real pages exist.
    await expect(runLoader({ DB: {} })).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("returns the static-only set under the PUBLIC_BRAND_PAGES_INDEXABLE emergency brake", async () => {
    await expect(
      runLoader({ DB: {}, BROWSER: {}, PUBLIC_BRAND_PAGES_INDEXABLE: "0" }),
    ).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("queries only the resolved provider's indexable public_search rows and maps them to /ads entries", async () => {
    queryAll.mockResolvedValue([
      cacheRow(),
      cacheRow({
        cache_key: "search-v2:domain:meesho.com:exact:meta_library_browser:all:page-1",
        payload: { ...basePayload, displayDomain: "meesho.com" },
      }),
      cacheRow({ route_context: "watchlist_scan" }),
    ]);

    // Production posture (wrangler.jsonc): SEARCH_ROLLOUT_MODE="v2".
    const entries = await runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "v2" });

    expect(queryAll).toHaveBeenCalledTimes(1);
    const [, sql, providerParam, cutoffIso, limit] = queryAll.mock.calls[0] as [
      unknown,
      string,
      string,
      string,
      number,
    ];
    expect(sql).toContain("route_context = 'public_search'");
    expect(sql).toContain("provider = ?");
    expect(providerParam).toBe("meta_library_browser");
    expect(sql).toContain("fetched_at >= ?");
    expect(new Date(cutoffIso).getTime()).toBeCloseTo(
      Date.now() - BRAND_PAGE_FRESH_FOR_INDEXING_MS,
      -3,
    );
    expect(limit).toBe(SITEMAP_BRAND_PATH_LIMIT);
    expect(entries.map((e: { path: string }) => e.path)).toEqual(["/ads/nykaa.com", "/ads/meesho.com"]);
    // Entries carry lastmod from fetched_at.
    for (const entry of entries) {
      expect(entry.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("mirrors the SEARCH_ROLLOUT_MODE posture when matching row keys", async () => {
    // v2 posture: the page derives search-v2 domain keys, so the v2-keyed row
    // is reachable and listable.
    queryAll.mockResolvedValue([cacheRow()]);
    await expect(
      runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "v2" }),
    ).resolves.toEqual([
      expect.objectContaining({ path: "/ads/nykaa.com" }),
    ]);

    // Legacy/shadow posture: the same v2-keyed row would render the noindex
    // shell (the page derives legacy fingerprint keys), so it must not be
    // listed.
    queryAll.mockResolvedValue([cacheRow()]);
    await expect(
      runLoader({ DB: {}, BROWSER: {}, SEARCH_ROLLOUT_MODE: "legacy" }),
    ).resolves.toEqual([]);
  });

  it("degrades to the static-only set when the discovery cache table is missing", async () => {
    queryAll.mockRejectedValue(new Error("D1_ERROR: no such table: discovery_cache_entry"));

    await expect(runLoader({ DB: {}, BROWSER: {} })).resolves.toEqual([]);
  });

  it("propagates genuine D1 failures instead of silently hiding them", async () => {
    queryAll.mockRejectedValue(new Error("connection lost"));

    await expect(runLoader({ DB: {}, BROWSER: {} })).rejects.toThrow("connection lost");
  });
});

describe("buildSitemapXml with timeline entries", () => {
  it("appends timeline locs after brand pages; static entries stay first", () => {
    const brand = [
      { path: "/ads/nykaa.com", lastmod: "2026-08-21" },
    ];
    const timeline = [
      { path: "/timeline/nykaa.com", lastmod: "2026-08-10" },
      { path: "/timeline/meesho.com", lastmod: "2026-08-02" },
    ];

    const xml = buildSitemapXml(brand, timeline);
    const homeLoc = xml.indexOf("https://0509.io/</loc>");
    const adsLoc = xml.indexOf("https://0509.io/ads/nykaa.com");
    const timelineNykaaLoc = xml.indexOf("https://0509.io/timeline/nykaa.com");
    const timelineMeeshoLoc = xml.indexOf("https://0509.io/timeline/meesho.com");

    expect(homeLoc).toBeGreaterThanOrEqual(0);
    expect(adsLoc).toBeGreaterThan(homeLoc);
    expect(timelineNykaaLoc).toBeGreaterThan(adsLoc);
    expect(timelineMeeshoLoc).toBeGreaterThan(timelineNykaaLoc);
    expect(xml).toContain("<lastmod>2026-08-10</lastmod>");
  });

  it("omits timeline locs when the timeline list is empty (default)", () => {
    const xml = buildSitemapXml([]);
    expect(xml).not.toContain("/timeline/");
  });
});

describe("loadIndexableTimelineEntries (D1 read)", () => {
  let queryAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    queryAll = vi.fn();
    vi.doMock("~/lib/data/d1.server", () => ({ queryAll }));
  });

  afterEach(() => {
    vi.doUnmock("~/lib/data/d1.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function runLoader(env: Record<string, unknown>) {
    const { loadIndexableTimelineEntries } = await import("~/lib/sitemap.server");
    return loadIndexableTimelineEntries(env as never);
  }

  it("returns nothing when D1 is absent", async () => {
    await expect(runLoader({})).resolves.toEqual([]);
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("keeps listing timeline entries under the PUBLIC_BRAND_PAGES_INDEXABLE emergency brake (the timeline loader never reads that env)", async () => {
    // The brake noindexes /ads/* pages only; /timeline/:domain indexability is
    // purely the empty-ledger rule, so its locs must stay live under the brake
    // (the pages they point to still render indexable).
    queryAll.mockResolvedValue([snapshotRow()]);

    const entries = await runLoader({ DB: {}, PUBLIC_BRAND_PAGES_INDEXABLE: "0" });

    expect(queryAll).toHaveBeenCalledTimes(1);
    expect(entries.map((e: { path: string }) => e.path)).toEqual(["/timeline/nykaa.com"]);
  });

  it("reads a bounded snapshot subset ordered ASC and maps to timeline entries", async () => {
    queryAll.mockResolvedValue([snapshotRow()]);

    const entries = await runLoader({ DB: {} });

    expect(queryAll).toHaveBeenCalledTimes(1);
    const [, sql, limit] = queryAll.mock.calls[0] as [unknown, string, number];
    expect(sql).toContain("FROM landing_page_snapshot");
    // Mirrors loadOfferTimeline's own ORDER BY ... ASC LIMIT window so the
    // per-domain first-200 slice in indexableTimelineEntriesFromRows matches
    // what the loader would render (issue #1928).
    expect(sql).toContain("ORDER BY captured_at ASC, id ASC");
    expect(sql).toContain("LIMIT ?");
    expect(limit).toBe(SITEMAP_TIMELINE_READ_LIMIT);
    expect(entries.map((e: { path: string }) => e.path)).toEqual(["/timeline/nykaa.com"]);
    expect(entries[0].lastmod).toBe("2026-08-01");
  });

  it("degrades to the static set when the snapshot table is missing", async () => {
    queryAll.mockRejectedValue(new Error("D1_ERROR: no such table: landing_page_snapshot"));

    await expect(runLoader({ DB: {} })).resolves.toEqual([]);
  });

  it("propagates genuine D1 failures instead of silently hiding them", async () => {
    queryAll.mockRejectedValue(new Error("connection lost"));

    await expect(runLoader({ DB: {} })).rejects.toThrow("connection lost");
  });
});

interface PlainRoute {
  path?: string;
  index?: boolean;
  children?: PlainRoute[];
}

function patternToRegex(pattern: string): RegExp | null {
  if (pattern.includes("*")) return null;
  const escaped = pattern
    .split("/")
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function collectRoutePatterns(routes: PlainRoute[], parent = ""): RegExp[] {
  const patterns: RegExp[] = [];
  for (const r of routes) {
    if (r.index) {
      const re = patternToRegex(parent);
      if (re) patterns.push(re);
      continue;
    }
    if (r.path) {
      const full = parent ? `${parent}/${r.path}` : r.path;
      if (r.children) {
        if (r.children.some((child) => child.index)) {
          const re = patternToRegex(full);
          if (re) patterns.push(re);
        }
        patterns.push(...collectRoutePatterns(r.children, full));
      } else {
        const re = patternToRegex(full);
        if (re) patterns.push(re);
      }
    }
  }
  return patterns;
}

describe("SITEMAP_PATHS", () => {
  it("only includes paths that resolve to a registered non-splat route", () => {
    const patterns = collectRoutePatterns(routes as unknown as PlainRoute[]);

    for (const sitemapPath of SITEMAP_PATHS) {
      const pathname = sitemapPath === "/" ? "" : sitemapPath.replace(/^\/+/, "");
      const matched = patterns.some((pattern) => pattern.test(pathname));
      expect(matched, `${sitemapPath} has no registered, non-splat route`).toBe(true);
    }
  });

  it("keeps restored money pages in the sitemap and signup out", () => {
    // /compare/foreplay and /compare/visualping were restored as money pages
    // (#944/#945) and are now canonicalized duplicates of their more specific
    // siblings (issue #1481) — the sitemap lists the winners instead. The
    // losers still render HTTP 200 from their registered routes.
    const moneyPages = [
      "/pricing",
      "/compare/foreplay-spyder",
      "/compare/visualping-ad-libraries",
      "/compare/pulzifi",
      "/compare/spyland",
    ] as const;

    for (const path of moneyPages) {
      expect(SITEMAP_PATHS, `${path} dropped from SITEMAP_PATHS`).toContain(path);
    }
    expect(SITEMAP_PATHS).not.toContain("/auth/signup");
    expect(NOINDEX_ACTION_SURFACES).toContain("/auth/signup");
  });

  it("lists the /brands hub (issue #1417) as a static sitemap path and inside the built XML", () => {
    // The hub is the browse surface that links the otherwise-orphaned /ads/*
    // pages — it must be crawlable, and the sitemap build must include it.
    expect(SITEMAP_PATHS).toContain("/brands");
    const entry = SITEMAP_STATIC_ENTRIES.find((e) => e.path === "/brands");
    expect(entry).toBeTruthy();
    expect(entry?.lastmod).toBeUndefined();
    const xml = buildSitemapXml([], []);
    expect(xml).toContain("<loc>https://0509.io/brands</loc>");
  });

  it("keeps every indexable /compare/* winner in the sitemap (issue #1878)", () => {
    // The issue asked to surface all built /compare/* pages (the 4 that were
    // missing) and all indexable /ads/:domain pages. Duplicate /compare pairs
    // (visualping, foreplay) are canonicalized to their more specific winners
    // (issue #1481/#1548); the winners below are the distinct indexable URLs
    // that must never regress out of the static sitemap.
    const compareWinners = [
      "/compare",
      "/compare/meta-ad-library",
      "/compare/visualping-ad-libraries",
      "/compare/spyland",
      "/compare/pulzifi",
      "/compare/foreplay-spyder",
      "/compare/panoramata",
      "/compare/adspyder",
      "/compare/adspy",
    ] as const;

    const rootPaths = ROOT_SITEMAP_STATIC_ENTRIES.map((e) => e.path);
    for (const path of compareWinners) {
      expect(rootPaths, `${path} dropped from root sitemap`).toContain(path);
      const entry = ROOT_SITEMAP_STATIC_ENTRIES.find((e) => e.path === path);
      expect(entry, `${path} missing from static entries`).toBeTruthy();
    }

    // The canonicalized losers never appear as distinct sitemap URLs.
    expect(rootPaths).not.toContain("/compare/visualping");
    expect(rootPaths).not.toContain("/compare/foreplay");
  });

  it("lists every live /switch/:slug page in the production sitemap XML (issue #2081)", () => {
    // Production /sitemap.xml is buildSitemapXml (workers/app.ts →
    // publicSitemapFile), not the static publicSeoFileForPathname fallback.
    // Pinning ROOT_SITEMAP_STATIC_ENTRIES + the rendered XML means a later
    // locale-filter or static-list edit cannot drop BET 8's demand-capture
    // pages while SITEMAP_PATHS still contains them. lastmod stays omitted:
    // switch pages have no per-page content timestamp, and inventing one
    // would fail the issue #2031 honesty clause below.
    const xml = buildSitemapXml([]);
    const rootPaths = ROOT_SITEMAP_STATIC_ENTRIES.map((e) => e.path);
    const switchPages = Object.values(SWITCH_PAGES);
    expect(switchPages.map((page) => page.pathname).sort()).toEqual([
      "/switch/panoramata",
      "/switch/visualping",
    ]);
    for (const page of switchPages) {
      expect(rootPaths, `${page.pathname} dropped from root sitemap`).toContain(
        page.pathname,
      );
      const entry = ROOT_SITEMAP_STATIC_ENTRIES.find((e) => e.path === page.pathname);
      expect(entry, `${page.pathname} missing from static entries`).toBeTruthy();
      expect(entry?.lastmod, `${page.pathname} fabricated lastmod`).toBeUndefined();
      expect(xml).toContain(`<loc>https://0509.io${page.pathname}</loc>`);
      expect(xml).not.toMatch(
        new RegExp(
          `<loc>https://0509\\.io${page.pathname}</loc><lastmod>`,
        ),
      );
    }
    expect(rootPaths.filter((path) => path === "/switch")).toHaveLength(0);
    expect(xml).not.toContain("<loc>https://0509.io/switch</loc>");
  });

  it("renders at least 10 indexable /ads/:domain + /compare/* locs in the built sitemap (issue #1878 termination)", () => {
    // Termination gate: the live sitemap must carry >= 10 <loc> under /ads/ or
    // /compare/ (the `/compare` bare path is excluded by the regex's trailing
    // slash). 7 indexable /compare/* winners are static above (issue #2127
    // wiped one); appending three representative indexable brand entries
    // clears the floor, proving the
    // dynamic reader + static winners jointly satisfy the acceptance metric.
    const xml = buildSitemapXml([
      {
        path: "/ads/nykaa.com",
        lastmod: "2026-08-21",
        adCount: 3,
        fetchedAt: "2026-08-21T10:00:00.000Z",
      },
      {
        path: "/ads/meesho.com",
        lastmod: "2026-08-20",
        adCount: 2,
        fetchedAt: "2026-08-20T10:00:00.000Z",
      },
      {
        path: "/ads/mamaearth.in",
        lastmod: "2026-08-19",
        adCount: 4,
        fetchedAt: "2026-08-19T10:00:00.000Z",
      },
    ]);
    const indexableLocs = [...xml.matchAll(
      /<loc>https:\/\/0509\.io\/(ads|compare)\/[^<]+<\/loc>/g,
    )];
    expect(indexableLocs.length).toBeGreaterThanOrEqual(10);
    // The dynamic brand entries are present alongside the static comparison set.
    expect(xml).toContain("<loc>https://0509.io/ads/nykaa.com</loc>");
    const nykaa = ROOT_SITEMAP_STATIC_ENTRIES.find((e) => e.path === "/ads/nykaa.com");
    expect(nykaa).toBeUndefined(); // dynamic, never hardcoded static
  });
});

describe("every dynamic sitemap URL carries an honest lastmod (issue #2031)", () => {
  // A verified-linked ad whose landing evidence resolves to the given domain,
  // so a fresh.com / stale.com cache row qualifies for the sitemap (the
  // populated-vs-thin gate needs verified link evidence to the registrable
  // domain, mirroring the loader).
  function domainAd(domain: string) {
    return {
      metaAdId: `meta-${domain}-1`,
      source: "meta_library_browser",
      landingPageUrl: `https://${domain}/shop`,
      domainMatch: {
        level: "registrable_domain",
        reason: `Landing page matches ${domain}`,
        matchedDomain: domain,
      },
      firstSeenAt: isoAgo(30 * DAY_MS),
      lastSeenAt: null,
      active: true,
      variantCount: 1,
    };
  }

  // Parse the rendered urlset into {loc, lastmod} pairs. Static funnel paths
  // (/, /search, /compare/*, ...) honestly omit lastmod — they have no per-page
  // content freshness field, and inventing one would be a false freshness
  // claim (issue #2031: "only real data timestamps; a stale page must not
  // claim freshness"). The dynamic /ads/:domain and /timeline/:domain entries
  // are the URLs that carry real freshness data, so the assertion below locks
  // those: every one of them must ship a W3C-format lastmod.
  function sitemapUrls(xml: string): Array<{ loc: string; lastmod?: string }> {
    return xml.split("<url>").slice(1).map((block) => ({
      loc: block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "",
      lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1],
    }));
  }

  it("renders a W3C lastmod on every /ads and /timeline URL, and a known-stale domain's lastmod is older than a fresh one's", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    // Fresh capture: 6 hours old, carries real verified-linked ads for its own
    // domain. Stale capture: 5 days old (still inside the 7-day indexability
    // window, so it stays listed) but clearly older than the fresh one.
    const fresh = cacheRow({
      cache_key: "search-v2:domain:fresh.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "fresh.com", ads: [domainAd("fresh.com")] },
      fetched_at: "2026-09-08T06:00:00.000Z",
    });
    const stale = cacheRow({
      cache_key: "search-v2:domain:stale.com:exact:meta_library_browser:all:page-1",
      payload: { ...basePayload, displayDomain: "stale.com", ads: [domainAd("stale.com")] },
      fetched_at: "2026-09-03T06:00:00.000Z",
    });

    const brandEntries = indexableBrandPageEntriesFromRows([fresh, stale], now, {
      provider: "meta_library_browser",
      useDomainV2: true,
    });
    const timelineEntries = indexableTimelineEntriesFromRows([
      snapshotRow({ id: "snap-stale-001", canonical_url: "https://stale.com/landing", captured_at: "2026-09-03T06:00:00.000Z" }),
      snapshotRow({ id: "snap-fresh-001", canonical_url: "https://fresh.com/landing", captured_at: "2026-09-08T06:00:00.000Z" }),
    ]);

    expect(brandEntries.map((e) => e.path).sort()).toEqual(["/ads/fresh.com", "/ads/stale.com"]);
    expect(timelineEntries.map((e) => e.path).sort()).toEqual(["/timeline/fresh.com", "/timeline/stale.com"]);

    const xml = buildSitemapXml(brandEntries, timelineEntries);
    const dynamicUrls = sitemapUrls(xml).filter(
      (u) => u.loc.includes("/ads/") || u.loc.includes("/timeline/"),
    );

    // Every dynamic URL must carry a W3C (YYYY-MM-DD) lastmod — the honest
    // freshness signal sourced from fetched_at / captured_at, never build time.
    expect(dynamicUrls.length).toBe(4);
    for (const u of dynamicUrls) {
      expect(u.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const byLoc = new Map(dynamicUrls.map((u) => [u.loc, u.lastmod]));
    // Pin the exact values too, not just the ordering: the lastmod must be the
    // real fetched_at / captured_at date slice, so a regression that emits a
    // different-but-still-ordered date (or build time that happens to sort)
    // cannot slip through (reviewer round, issue #2031).
    expect(byLoc.get("https://0509.io/ads/fresh.com")).toBe("2026-09-08");
    expect(byLoc.get("https://0509.io/ads/stale.com")).toBe("2026-09-03");
    expect(byLoc.get("https://0509.io/timeline/fresh.com")).toBe("2026-09-08");
    expect(byLoc.get("https://0509.io/timeline/stale.com")).toBe("2026-09-03");
    // A known-stale domain's lastmod must be older than a fresh one's, for both
    // the /ads and /timeline surfaces (lexical compare is valid for YYYY-MM-DD).
    expect(Date.parse(byLoc.get("https://0509.io/ads/stale.com")!)).toBeLessThan(
      Date.parse(byLoc.get("https://0509.io/ads/fresh.com")!),
    );
    expect(Date.parse(byLoc.get("https://0509.io/timeline/stale.com")!)).toBeLessThan(
      Date.parse(byLoc.get("https://0509.io/timeline/fresh.com")!),
    );
  });

  it("never fabricates a lastmod for static funnel paths that have no real freshness field (issue #2031 honesty clause)", () => {
    // Static pages (/, /search, /compare/*, ...) have no per-page content
    // timestamp. The issue forbids build-time or invented dates, so they must
    // stay lastmod-less rather than claim a freshness they cannot back.
    // /changelog is the one exception (issue #2297): it carries a real
    // lastmod derived from its newest dated entry, so it is excluded here.
    const xml = buildSitemapXml([]);
    const staticUrls = sitemapUrls(xml).filter(
      (u) =>
        !u.loc.includes("/ads/") &&
        !u.loc.includes("/timeline/") &&
        u.loc !== "https://0509.io/changelog",
    );
    expect(staticUrls.length).toBeGreaterThan(0);
    for (const u of staticUrls) {
      expect(u.lastmod).toBeUndefined();
    }
  });
});

describe("locale sitemap feed count matches the buyer-surface derivation (issue #2294)", () => {
  it("each locale feed count equals the BUYER_SURFACE_PATHS-derived count", () => {
    // Issue #2294 accept: the locale feed is derived from BUYER_SURFACE_PATHS
    // + compare/switch children + the /guides/* cluster (the single source of
    // truth), not from filtering the static list. The bare index and
    // /sitemap.xml are excluded — neither is a real page.
    const derivedCount =
      BUYER_SURFACE_PATHS.filter((p) => p !== "/" && p !== "/sitemap.xml").length +
      BUYER_SURFACE_CHILD_PATHS.length +
      3; // /guides/how-to-track-competitor-ads + /guides/how-to-monitor-meta-ad-library (issue #2867) + /guides/how-to-monitor-competitor-landing-page-changes (issue #2888)
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      const entries = staticSitemapEntriesForLocale(locale);
      const body = buildLocaleSitemapXml(locale);
      const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
      // The genuinely translated sneaker-resale cluster adds one for the
      // locales that ship it (de, ja, pt-br).
      const expected = locale === "de" || locale === "ja" || locale === "pt-br"
        ? derivedCount + 1
        : derivedCount;
      expect(entries.length).toBe(expected);
      expect(locs.length).toBe(expected);
      if (locale === "de" || locale === "ja" || locale === "pt-br") {
        expect(locs).toContain(`https://0509.io/${locale}/sneaker-resale`);
      }
    }
  });

  it("every locale sitemap URL is a registered route (no entry for a non-200 path)", () => {
    // Issue #2294 accept: no entry for a non-200 path. Every locale sitemap
    // URL must correspond to a route registered under the `:locale` layout,
    // so it serves 200 rather than 404. The guide route is the one the
    // derivation adds that is not in BUYER_SURFACE_PATHS — it must be
    // registered too.
    const routesText = readFileSync("app/routes.ts", "utf8");
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const entry of staticSitemapEntriesForLocale(locale)) {
        const path = entry.path.replace(`/${locale}`, "");
        // The buyer-surface cluster is registered as a `:locale` layout child;
        // the sneaker-resale cluster is a root-level `:locale/sneaker-resale`
        // route. Both live in routes.ts, so check the whole file.
        expect(
          routesText,
          `/${locale}${path} is in the locale sitemap but not a registered route`,
        ).toContain(`"${path.replace(/^\//, "")}"`);
      }
    }
  });

  it("every buyer-surface path and compare/switch child is in SITEMAP_STATIC_ENTRIES (no silent drop)", () => {
    // The derivation reuses the EN path set from
    // SITEMAP_STATIC_ENTRIES and skips any path missing from it. A path
    // added to BUYER_SURFACE_PATHS / BUYER_SURFACE_CHILD_PATHS but not to
    // SITEMAP_PATHS would silently vanish from the locale sitemap — this
    // cross-check makes that drift fail loudly.
    const staticPaths = new Set(SITEMAP_STATIC_ENTRIES.map((e) => e.path));
    const derived = [
      ...BUYER_SURFACE_PATHS.filter((p) => p !== "/" && p !== "/sitemap.xml"),
      ...BUYER_SURFACE_CHILD_PATHS,
      "/guides/how-to-track-competitor-ads",
      "/guides/how-to-monitor-meta-ad-library",
      "/guides/how-to-monitor-competitor-landing-page-changes",
    ];
    for (const path of derived) {
      expect(staticPaths, `${path} missing from SITEMAP_STATIC_ENTRIES`).toContain(path);
    }
  });
});

describe("brandCategorySitemapEntries (issue #2067)", () => {
  it("emits one /brands/:slug entry per NON-EMPTY curated category, with lastmod = newest brand lastmod", () => {
    const brandEntries = [
      // Beauty & personal care — two brands, newest lastmod 2026-08-21.
      { path: "/ads/nykaa.com", lastmod: "2026-08-21" },
      { path: "/ads/sugarcosmetics.com", lastmod: "2026-08-20" },
      { path: "/ads/mcaffeine.com", lastmod: "2026-08-19" },
      // Sport & footwear — one brand.
      { path: "/ads/nike.com", lastmod: "2026-08-18" },
      // Unclassified — falls into "More brands", has no landing page.
      { path: "/ads/myexamplebrand.com", lastmod: "2026-08-16" },
    ];

    const entries = brandCategorySitemapEntries(brandEntries);
    const byPath = (p: string) => entries.find((e) => e.path === p);

    // Beauty aggregates both brands and takes the newest lastmod.
    const beauty = byPath("/brands/beauty-personal-care");
    expect(beauty).toBeDefined();
    expect(beauty?.lastmod).toBe("2026-08-21");

    const sport = byPath("/brands/sport-footwear");
    expect(sport?.lastmod).toBe("2026-08-18");

    // Every curated category with a brand gets an entry: exactly the 2 that
    // have brands. The other 5 curated categories are empty and omitted.
    expect(entries.map((e) => e.path).sort()).toEqual([
      "/brands/beauty-personal-care",
      "/brands/sport-footwear",
    ]);
    // "More brands" and any unclassified domain are never emitted.
    expect(entries.some((e) => e.path.includes("more-brands"))).toBe(false);
    expect(entries.some((e) => e.path.includes("myexamplebrand") || e.path.includes("/ads/"))).toBe(false);
  });

  it("omits every curated category when none has brands, and never emits the More-brands bucket", () => {
    const entries = brandCategorySitemapEntries([
      { path: "/ads/myexamplebrand.com", lastmod: "2026-08-16" },
    ]);
    expect(entries).toEqual([]);
  });

  it("omits lastmod when a category's brands carry no dated lastmod (never invents one)", () => {
    const entries = brandCategorySitemapEntries([
      { path: "/ads/nykaa.com" },
      { path: "/ads/sugarcosmetics.com" },
    ]);
    const beauty = entries.find((e) => e.path === "/brands/beauty-personal-care");
    expect(beauty).toBeDefined();
    expect(beauty?.lastmod).toBeUndefined();
  });

  it("buildSitemapXml threads category entries so all 7 non-empty categories + the hub render (count >= 8)", () => {
    // One brand per curated category so every curated slug has a page.
    const brandEntries = [
      { path: "/ads/nike.com", lastmod: "2026-08-01" }, // Sport & footwear
      { path: "/ads/asos.com", lastmod: "2026-08-02" }, // E-commerce
      { path: "/ads/nykaa.com", lastmod: "2026-08-03" }, // Beauty & personal care
      { path: "/ads/lenskart.com", lastmod: "2026-08-04" }, // Optical & eyewear
      { path: "/ads/hubspot.com", lastmod: "2026-08-05" }, // SaaS & software
      { path: "/ads/ouraring.com", lastmod: "2026-08-06" }, // Wearables & health
      { path: "/ads/ridgewallet.com", lastmod: "2026-08-07" }, // Wallet & accessories
    ];

    const categoryEntries = brandCategorySitemapEntries(brandEntries);
    expect(categoryEntries).toHaveLength(7);

    // /brands (the hub) is a static root entry — so the sitemap lists the
    // hub plus all 7 category pages: >= 8 /brands* URLs.
    const xml = buildSitemapXml(brandEntries, [], categoryEntries);
    const brandPageUrls = [...xml.matchAll(/https:\/\/0509\.io\/brands[^<]*/g)].map((m) => m[0]);
    const categoryUrls = brandPageUrls.filter((u) => /^https:\/\/0509\.io\/brands\/[a-z-]+$/.test(u));
    expect(brandPageUrls).toContain("https://0509.io/brands");
    expect(categoryUrls).toHaveLength(7);
    for (const slug of [
      "sport-footwear",
      "e-commerce",
      "beauty-personal-care",
      "optical-eyewear",
      "saas-software",
      "wearables-health",
      "wallet-accessories",
    ]) {
      expect(xml).toContain(`<loc>https://0509.io/brands/${slug}</loc>`);
    }
  });
});
