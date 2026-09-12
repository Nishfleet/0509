import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applySearchV2PostFilter,
  buildSearchV2CacheKey,
  buildSearchV2SavedQuery,
  resolveVerifiedAdvertiserPageId,
} from "~/lib/search-v2.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { clearWebsiteIdentityCacheForTests } from "~/lib/website-identity.server";
import type { AdRecord, SearchFilters, SearchResponse } from "~/lib/types";

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nykaa",
    body: "Beauty sale",
    previewHeadline: "Beauty sale",
    previewSubhead: "Shop now",
    hook: "Beauty sale",
    offer: "Sale",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

const filters = {
  query: "",
  country: "India",
  platform: "all",
  creativeType: "all" as const,
  status: "all" as const,
  firstSeenFrom: "",
  lastSeenFrom: "",
};

describe("search v2 cache isolation", () => {
  it("discovers domain candidates with the registrable domain in both proof scopes", () => {
    const intent = parseSearchInputFromWebsiteField("https://www.nykaa.com");

    expect(buildSearchV2SavedQuery(intent, "exact", filters).filters.query).toBe("nykaa.com");
    expect(buildSearchV2SavedQuery(intent, "broader", filters).filters.query).toBe("nykaa.com");
  });

  it("queries Meta with the registrable domain, not the site-name alias (issue #1999)", () => {
    // Live 2026-09-09: website=on.com / website=reebok.com asked Meta for the
    // curated site names "On" / "Reebok" (identityAliases[0]) and returned 0
    // verified/likely rows. The same brands on q=on.com / q=reebok.com returned
    // 30 and 2 verified rows. Site names stay matching aliases; they must not
    // drive the provider query, including when the live og:site_name is a shop
    // label that Meta returns 0 ads for ("On Shop").
    const goat = parseSearchInputFromWebsiteField("https://goat.com");
    const on = parseSearchInputFromWebsiteField("https://on.com");
    const reebok = parseSearchInputFromWebsiteField("https://reebok.com");

    const goatQuery = buildSearchV2SavedQuery(goat, "exact", filters, {
      identityAliases: ["GOAT"],
    });
    const onQuery = buildSearchV2SavedQuery(on, "exact", filters, {
      identityAliases: ["On Shop", "On"],
    });
    const reebokQuery = buildSearchV2SavedQuery(reebok, "exact", filters, {
      identityAliases: ["Reebok"],
    });

    expect(goatQuery.filters.query).toBe("goat.com");
    expect(onQuery.filters.query).toBe("on.com");
    expect(reebokQuery.filters.query).toBe("reebok.com");
  });

  it("uses distinct keys for domain exact vs broader scope", () => {
    const intent = parseSearchInputFromWebsiteField("okara.ai");
    const exact = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "exact",
      country: "all",
    });
    const broader = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "broader",
      country: "all",
    });

    expect(exact).toContain("search-v2:domain:okara.ai:exact");
    expect(broader).toContain("search-v2:domain:okara.ai:broader");
    expect(exact).not.toBe(broader);
  });

  it("does not reuse text cache namespace for domain intent", () => {
    const domainIntent = parseSearchInputFromWebsiteField("okara.ai");
    const textIntent = parseSearchInputFromWebsiteField("okara");

    const domainKey = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: domainIntent,
      scope: "exact",
      country: "all",
    });
    const textKey = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: textIntent,
      scope: "exact",
      country: "all",
    });

    expect(domainKey.startsWith("search-v2:domain:")).toBe(true);
    expect(textKey.startsWith("search-v2:domain:")).toBe(false);
  });

  // Issue #2437: the domain-intent key named only domain/scope/provider/country,
  // but the provider request DOES carry the result filters (media_type from
  // creativeType, active_status from status — meta-library-browser.server.ts
  // buildSearchUrl). Two differently-filtered searches for one domain shared a
  // single cache entry, so an unfiltered visitor could be served another
  // visitor's video-only payload and vice versa.
  it("isolates the domain key on every non-default result filter", () => {
    const intent = parseSearchInputFromWebsiteField("nike.com");
    const defaults: SearchFilters = {
      query: "nike.com",
      country: "all",
      platform: "all",
      creativeType: "all",
      status: "all",
      firstSeenFrom: "",
      lastSeenFrom: "",
    };
    const keyFor = (overrides: Partial<SearchFilters>) =>
      buildSearchV2CacheKey({
        provider: "meta_library_browser",
        intent,
        scope: "exact",
        country: "all",
        filters: { ...defaults, ...overrides },
      });

    const unfiltered = keyFor({});
    expect(keyFor({ creativeType: "video" })).not.toBe(unfiltered);
    expect(keyFor({ status: "active" })).not.toBe(unfiltered);
    expect(keyFor({ platform: "Instagram" })).not.toBe(unfiltered);
    expect(keyFor({ firstSeenFrom: "2026-01-01" })).not.toBe(unfiltered);
    expect(keyFor({ lastSeenFrom: "2026-01-01" })).not.toBe(unfiltered);

    // Every filter must isolate independently, not merely from the unfiltered
    // key: two different non-default values that shared a key would still
    // cross-serve.
    expect(keyFor({ platform: "Instagram" })).not.toBe(keyFor({ platform: "Facebook" }));
    expect(keyFor({ creativeType: "video" })).not.toBe(keyFor({ creativeType: "image" }));
    expect(keyFor({ status: "active" })).not.toBe(keyFor({ status: "inactive" }));
  });

  it("keeps the legacy six-segment key when every result filter is default", () => {
    const intent = parseSearchInputFromWebsiteField("nike.com");
    const defaults: SearchFilters = {
      query: "nike.com",
      country: "all",
      platform: "all",
      creativeType: "all",
      status: "all",
      firstSeenFrom: "",
      lastSeenFrom: "",
    };
    const withDefaults = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "exact",
      country: "all",
      filters: defaults,
    });
    const withoutFilters = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent,
      scope: "exact",
      country: "all",
    });

    // The format-pinning canaries (tests/ads-programmatic-seo-guard.test.tsx,
    // sitemap.server.test.ts) hard-code this exact shape for default filters.
    expect(withDefaults).toBe("search-v2:domain:nike.com:exact:meta_library_browser:all:page-1");
    expect(withDefaults).toBe(withoutFilters);
  });
});

describe("search v2 proof policy", () => {
  const intent = parseSearchInputFromWebsiteField("https://nykaa.com");
  const rawResult: SearchResponse = {
    ads: [
      ad({ metaAdId: "verified", landingPageUrl: "https://nykaa.com/sale" }),
      ad({ metaAdId: "keyword", advertiser: "Nykaa Beauty", body: "Nykaa sale" }),
      ad({
        metaAdId: "sparse",
        advertiser: "",
        body: "",
        previewHeadline: "New offer",
        hook: "New offer",
      }),
    ],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
  };

  it("keeps every candidate in exact scope, labelled by tier (BET 2 no dead-end)", async () => {
    const result = await applySearchV2PostFilter({}, rawResult, {
      queryIntent: intent,
      scope: "exact",
      displayDomain: "nykaa.com",
      identityAliases: [],
      domainAliases: [],
    });

    // Exact scope no longer drops non-verified candidates to an empty page.
    // The verified ad leads; the brand-name match is "likely"; the sparse
    // provider return is "unmatched". All three render as rows.
    expect(result.ads.map((item) => item.metaAdId)).toEqual([
      "verified",
      "keyword",
      "sparse",
    ]);
    expect(result.ads.find((item) => item.metaAdId === "keyword")?.domainMatch).toMatchObject({
      level: "likely_brand_name",
    });
    expect(result.ads.find((item) => item.metaAdId === "sparse")?.domainMatch).toMatchObject({
      level: "unverified_provider_candidate",
      reason: expect.stringContaining("website connection not verified"),
    });
    expect(result).toMatchObject({
      verifiedCount: 1,
      likelyCount: 1,
      unmatchedCount: 1,
      rawCandidateCount: 3,
      broaderCandidateCount: 2,
      rejectedKeywordOnlyCount: 0,
    });
  });

  it("shows sparse provider candidates only in explicitly broader results", async () => {
    const result = await applySearchV2PostFilter({}, rawResult, {
      queryIntent: intent,
      scope: "broader",
      displayDomain: "nykaa.com",
      identityAliases: [],
      domainAliases: [],
    });

    expect(result.ads.map((item) => item.metaAdId)).toEqual(["verified", "keyword", "sparse"]);
    expect(result.ads.find((item) => item.metaAdId === "sparse")?.domainMatch).toMatchObject({
      level: "unverified_provider_candidate",
      reason: expect.stringContaining("website connection not verified"),
    });
    expect(result.verifiedCount).toBe(1);
    expect(result.likelyCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
    expect(result.broaderCandidateCount).toBe(2);
  });

  it("verifies Mamaearth ads landing on mamaearth.in against mamaearth.com", async () => {
    const mamaearth = parseSearchInputFromWebsiteField("https://mamaearth.com");
    const result = await applySearchV2PostFilter(
      {},
      {
        ads: [
          ad({
            metaAdId: "mamaearth-in",
            advertiser: "Mamaearth",
            landingPageUrl: "https://mamaearth.in/product/ubtan-face-wash",
          }),
        ],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "miss",
      },
      {
        queryIntent: mamaearth,
        scope: "exact",
        displayDomain: "mamaearth.com",
        identityAliases: [],
        domainAliases: ["mamaearth.in"],
      },
    );

    expect(result.verifiedCount).toBe(1);
    expect(result.ads[0]?.domainMatch?.level).toBe("verified_alias");
  });

  it("verifies ŌURA ads landing on ouraring.com against oura.com", async () => {
    const oura = parseSearchInputFromWebsiteField("https://oura.com");
    const result = await applySearchV2PostFilter(
      {},
      {
        ads: [
          ad({
            metaAdId: "oura-ring",
            advertiser: "ŌURA",
            landingPageUrl: "https://ouraring.com/store/rings/oura-ring-4",
          }),
        ],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "miss",
      },
      {
        queryIntent: oura,
        scope: "exact",
        displayDomain: "oura.com",
        identityAliases: [],
        domainAliases: [],
      },
    );

    expect(result.verifiedCount).toBe(1);
    expect(result.ads[0]?.domainMatch?.level).not.toBe("unverified_text_candidate");
  });

  it("verifies On ads landing on the curated on-running.com alias against on.com", async () => {
    // on.com / on-running.com are the same brand (On Running). The live
    // on.com redirect chain never touches on-running.com, and the 2-char stem
    // "on" is below the stem-extension floor, so the curated domain alias is
    // what lets an ad that lands on on-running.com verify against a searched
    // on.com (issue #1950 on.com ↔ on-running.com).
    const on = parseSearchInputFromWebsiteField("https://on.com");
    const result = await applySearchV2PostFilter(
      {},
      {
        ads: [
          ad({
            metaAdId: "on-running-shoe",
            advertiser: "On",
            landingPageUrl: "https://www.on-running.com/us/cloudrunner",
          }),
        ],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "miss",
      },
      {
        queryIntent: on,
        scope: "exact",
        displayDomain: "on.com",
        identityAliases: ["On Shop"],
        domainAliases: ["on-running.com"],
      },
    );

    expect(result.verifiedCount).toBe(1);
    expect(result.ads[0]?.domainMatch?.level).toBe("verified_alias");
  });
});

describe("search v2 okara.ai precision regression (BET 2)", () => {
  // The okara.ai → "ESHAL HOMEOPATHIC CLINIC OKARA" bug must not regress: a
  // clinic whose name contains the city "Okara" is NOT the okara.ai brand.
  // It must classify as unmatched (unverified_text_candidate), never as
  // verified or likely, so the precision fix survives the three-tier model.
  const intent = parseSearchInputFromWebsiteField("https://okara.ai");

  it("classifies the Okara clinic as unmatched, not likely or verified", async () => {
    const clinic = ad({
      metaAdId: "clinic-okara",
      advertiser: "ESHAL HOMEOPATHIC CLINIC OKARA",
      body: "Visit our clinic in Okara, Pakistan",
      landingPageUrl: "https://eshal-clinic.example.com",
    });
    const result = await applySearchV2PostFilter(
      {},
      { ads: [clinic], nextCursor: null, source: "meta_library_browser", cacheStatus: "miss" },
      {
        queryIntent: intent,
        scope: "exact",
        displayDomain: "okara.ai",
        identityAliases: [],
        domainAliases: [],
      },
    );

    expect(result.verifiedCount).toBe(0);
    expect(result.likelyCount).toBe(0);
    expect(result.unmatchedCount).toBe(1);
    expect(result.ads[0]?.domainMatch?.level).toBe("unverified_text_candidate");
  });

  it("classifies a real okara.ai brand-name advertiser as likely", async () => {
    const brand = ad({
      metaAdId: "okara-brand",
      advertiser: "Okara",
      body: "Okara product launch",
      landingPageUrl: null,
    });
    const result = await applySearchV2PostFilter(
      {},
      { ads: [brand], nextCursor: null, source: "meta_library_browser", cacheStatus: "miss" },
      {
        queryIntent: intent,
        scope: "exact",
        displayDomain: "okara.ai",
        identityAliases: [],
        domainAliases: [],
      },
    );

    expect(result.likelyCount).toBe(1);
    expect(result.verifiedCount).toBe(0);
    expect(result.ads[0]?.domainMatch?.level).toBe("likely_brand_name");
  });
});

describe("verified advertiser page-id scoping", () => {
  const intent = parseSearchInputFromWebsiteField("https://nykaa.com");

  it("surfaces a single verified advertiser page id for persisted page-scoped scans", async () => {
    const rawResult: SearchResponse = {
      ads: [
        ad({
          metaAdId: "verified",
          landingPageUrl: "https://nykaa.com/sale",
          advertiserPageId: "112233445566",
        }),
        // Reseller keyword candidate: verified page id must ignore it entirely.
        ad({ metaAdId: "reseller", advertiser: "Reseller", advertiserPageId: "999" }),
      ],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    };

    const result = await applySearchV2PostFilter({}, rawResult, {
      queryIntent: intent,
      scope: "exact",
      displayDomain: "nykaa.com",
      identityAliases: [],
      domainAliases: [],
    });

    expect(result.verifiedAdvertiserPageId).toBe("112233445566");
  });

  it("returns null when verified matches disagree or carry no page id", () => {
    expect(resolveVerifiedAdvertiserPageId([])).toBeNull();
    expect(
      resolveVerifiedAdvertiserPageId([
        {
          ad: ad({ advertiserPageId: "111111" }),
          match: {
            level: "registrable_domain",
            matchedDomain: "nykaa.com",
            matchedSignal: "landing_page_url",
            confidenceCategory: "verified",
            providerSource: "meta_library_browser",
            customerReason: "verified",
          },
        },
        {
          ad: ad({ advertiserPageId: "222222" }),
          match: {
            level: "verified_alias",
            matchedDomain: "nykaa.com",
            matchedSignal: "audited_alias",
            confidenceCategory: "verified",
            providerSource: "meta_library_browser",
            customerReason: "verified",
          },
        },
      ]),
    ).toBeNull();
  });

  it("persists a verified page id into the saved query for later scans", () => {
    const scoped = buildSearchV2SavedQuery(intent, "exact", filters, {
      pageId: "112233445566",
    });
    expect(scoped.filters.pageId).toBe("112233445566");

    // No page id → keyword saved query, unchanged fingerprint surface.
    const keyword = buildSearchV2SavedQuery(intent, "exact", filters);
    expect("pageId" in keyword.filters).toBe(false);
  });
});

describe("curated page-id scoping (issue #1982)", () => {
  // GOAT and On Running are major Meta advertisers whose brand-name keyword
  // queries ("GOAT", "On") surface tens of thousands of junk rows instead of
  // the brand's own ads. The curated Meta Page id scopes the provider search
  // to the brand's exact page (view_all_page_id) so its own ads surface. The
  // matcher still verifies each ad lands on the brand's domain — a curated
  // page id never fabricates a verified row.
  it("propagates a curated page id into the saved query for page-scoped search", () => {
    const goat = parseSearchInputFromWebsiteField("https://goat.com");
    const query = buildSearchV2SavedQuery(goat, "exact", filters, {
      identityAliases: ["GOAT"],
      pageId: "746493592053334",
    });
    // Issue #1999: the provider query is the registrable domain, not the
    // site-name alias. The curated page id still scopes the scrape to the
    // brand's exact Meta page (view_all_page_id); the query term is secondary
    // to that scoping.
    expect(query.filters.query).toBe("goat.com");
    expect(query.filters.pageId).toBe("746493592053334");
  });

  it("uses a distinct cache key for page-scoped vs keyword-scoped search", () => {
    const goat = parseSearchInputFromWebsiteField("https://goat.com");
    const keywordKey = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: goat,
      scope: "exact",
      country: "all",
    });
    const pageScopedKey = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: goat,
      scope: "exact",
      country: "all",
      pageId: "746493592053334",
    });
    expect(keywordKey).not.toBe(pageScopedKey);
    expect(pageScopedKey).toContain("page:746493592053334");
    // The keyword key keeps the legacy "page-1" cursor segment.
    expect(keywordKey).toContain("page-1");
    expect(keywordKey).not.toContain("page:");
  });

  it("omits the pageId segment when no curated id exists (legacy parity)", () => {
    const nykaa = parseSearchInputFromWebsiteField("https://nykaa.com");
    const key = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: nykaa,
      scope: "exact",
      country: "all",
    });
    expect(key).not.toContain("page:");
    expect(key).toContain("page-1");
  });
});

describe("curated provider query (issue #2233)", () => {
  // saucony.co.uk is a country storefront that redirects onto www.saucony.com,
  // so Saucony's Meta ads never carry the .co.uk host. Asking Meta for the
  // registrable domain (the #1999 rule) settles on a confirmed 0-row page for
  // it; the brand name is the term Meta actually indexes. The curated term is
  // narrow by design: it only applies to a domain listed in IDENTITY_OVERRIDES,
  // so the #1999 registrable-domain contract stands everywhere else.
  it("asks the provider the curated brand term for a curated country storefront", () => {
    const sauconyUk = parseSearchInputFromWebsiteField("https://saucony.co.uk");
    const query = buildSearchV2SavedQuery(sauconyUk, "exact", filters);

    expect(query.filters.query).toBe("Saucony");
  });

  it("keeps the registrable domain for every domain without a curated term", () => {
    // The .com sibling of the same brand has no curated term, and neither do
    // the #1999 regression brands — their provider query must not move.
    for (const [input, expected] of [
      ["https://saucony.com", "saucony.com"],
      ["https://goat.com", "goat.com"],
      ["https://on.com", "on.com"],
      ["https://zappos.com", "zappos.com"],
      ["https://mamaearth.in", "mamaearth.in"],
      // An uncurated country storefront must NOT pick up the brand stem: a
      // heuristic like "ccTLD storefront -> brand name" would pass the cases
      // above while silently changing the provider term for every one of
      // these (issue #2233).
      ["https://nike.co.uk", "nike.co.uk"],
      ["https://jdsports.co.uk", "jdsports.co.uk"],
    ] as const) {
      const query = buildSearchV2SavedQuery(
        parseSearchInputFromWebsiteField(input),
        "exact",
        filters,
      );
      expect(query.filters.query).toBe(expected);
    }
  });

  it("connects a curated country storefront to the ads landing on its primary host", async () => {
    // The curated term only changes the question asked of Meta. The connection
    // that makes the row verified is still the landing page, and it needs no
    // curated alias: www.saucony.com and saucony.co.uk share the folded label
    // "saucony", which the collapsed-label rule already connects. This is the
    // pairing the canary measures, with empty aliases on purpose.
    const sauconyUk = parseSearchInputFromWebsiteField("https://saucony.co.uk");
    const result = await applySearchV2PostFilter(
      {},
      {
        ads: [
          ad({
            metaAdId: "saucony-uk-shoe",
            advertiser: "Saucony",
            landingPageUrl: "https://www.saucony.com/UK/en_GB/home/",
          }),
        ],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "miss",
      },
      {
        queryIntent: sauconyUk,
        scope: "exact",
        displayDomain: "saucony.co.uk",
        identityAliases: [],
        domainAliases: [],
      },
    );

    expect(result.verifiedCount).toBe(1);
  });

  it("does not verify a curated-term row that lands somewhere unrelated", async () => {
    // The guard on the curated term: it must never turn a same-name advertiser
    // into a verified row. A row landing on an unrelated host is not connected
    // to saucony.co.uk no matter which term surfaced it.
    const sauconyUk = parseSearchInputFromWebsiteField("https://saucony.co.uk");
    const result = await applySearchV2PostFilter(
      {},
      {
        ads: [
          ad({
            metaAdId: "unrelated-saucony-name",
            advertiser: "Saucony",
            landingPageUrl: "https://example.com/promo",
          }),
        ],
        nextCursor: null,
        source: "meta_library_browser",
        cacheStatus: "miss",
      },
      {
        queryIntent: sauconyUk,
        scope: "exact",
        displayDomain: "saucony.co.uk",
        identityAliases: [],
        domainAliases: [],
      },
    );

    expect(result.verifiedCount).toBe(0);
  });

  it("gives a curated provider term its own cache-key segment", () => {
    // The stale 0-row page for saucony.co.uk was written to the cache under the
    // registrable-domain key. If the curated term did not move the key, the
    // empty page would keep being served and the fix would never be observable.
    const sauconyUk = parseSearchInputFromWebsiteField("https://saucony.co.uk");
    const key = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: sauconyUk,
      scope: "exact",
      country: "all",
    });

    expect(key).toContain("q:saucony");
    expect(key).toContain("page-1");
    // The segment is what makes the already-cached settled 0-row page
    // unreachable, so pin the whole key rather than a substring.
    expect(key).toBe(
      "search-v2:domain:saucony.co.uk:exact:meta_library_browser:all:q:saucony:page-1",
    );
    expect(key).not.toBe(
      "search-v2:domain:saucony.co.uk:exact:meta_library_browser:all:page-1",
    );
  });

  it("leaves cache keys without a curated term on the legacy shape", () => {
    const saucony = parseSearchInputFromWebsiteField("https://saucony.com");
    const key = buildSearchV2CacheKey({
      provider: "meta_library_browser",
      intent: saucony,
      scope: "exact",
      country: "all",
    });

    expect(key).not.toContain("q:");
    expect(key).toContain("page-1");
  });
});

describe("website identity SSRF guard", () => {
  afterEach(() => {
    clearWebsiteIdentityCacheForTests();
    vi.unstubAllGlobals();
  });

  it("refuses localhost identity fetches", async () => {
    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    const identity = await resolveWebsiteIdentity("http://localhost");
    expect(identity).toBeNull();
  });

  it("refuses metadata IP identity fetches", async () => {
    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    const identity = await resolveWebsiteIdentity("http://169.254.169.254");
    expect(identity).toBeNull();
  });

  it("returns null when website identity fetches time out", async () => {
    const dnsA = new Response(JSON.stringify({
      Answer: [{ type: 1, data: "93.184.216.34" }],
    }));
    const dnsAaaa = new Response(JSON.stringify({ Answer: [] }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(dnsA.clone())
      .mockResolvedValueOnce(dnsAaaa.clone())
      .mockResolvedValueOnce(dnsA.clone())
      .mockResolvedValueOnce(dnsAaaa.clone())
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    const identity = await resolveWebsiteIdentity("https://example.com");

    expect(identity).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
