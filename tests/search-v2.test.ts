import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applySearchV2PostFilter,
  buildSearchV2CacheKey,
  buildSearchV2SavedQuery,
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

  it("keeps exact results verified while reporting every rejected candidate", async () => {
    const result = await applySearchV2PostFilter({}, rawResult, {
      queryIntent: intent,
      scope: "exact",
      displayDomain: "nykaa.com",
      identityAliases: [],
    });

    expect(result.ads.map((item) => item.metaAdId)).toEqual(["verified"]);
    expect(result).toMatchObject({
      verifiedCount: 1,
      rawCandidateCount: 3,
      broaderCandidateCount: 2,
      missingVerificationCount: 1,
      rejectedKeywordOnlyCount: 1,
    });
  });

  it("shows sparse provider candidates only in explicitly broader results", async () => {
    const result = await applySearchV2PostFilter({}, rawResult, {
      queryIntent: intent,
      scope: "broader",
      displayDomain: "nykaa.com",
      identityAliases: [],
    });

    expect(result.ads.map((item) => item.metaAdId)).toEqual(["verified", "keyword", "sparse"]);
    expect(result.ads.find((item) => item.metaAdId === "sparse")?.domainMatch).toMatchObject({
      level: "unverified_provider_candidate",
      reason: expect.stringContaining("website connection not verified"),
    });
    expect(result.verifiedCount).toBe(1);
    expect(result.broaderCandidateCount).toBe(2);
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
