import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applySearchV2PostFilter,
  buildSearchV2CacheKey,
  buildSearchV2SavedQuery,
  resolveVerifiedAdvertiserPageId,
} from "~/lib/search-v2.server";
import { parseSearchInputFromWebsiteField } from "~/lib/search-query";
import { clearWebsiteIdentityCacheForTests } from "~/lib/website-identity.server";
import type { AdRecord, SearchResponse } from "~/lib/types";

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
  it("discovers domain candidates with the brand term in both proof scopes", () => {
    const intent = parseSearchInputFromWebsiteField("https://www.nykaa.com");

    expect(buildSearchV2SavedQuery(intent, "exact", filters).filters.query).toBe("nykaa");
    expect(buildSearchV2SavedQuery(intent, "broader", filters).filters.query).toBe("nykaa");
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
