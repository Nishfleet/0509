import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import {
  canonicalizeSitemapTimelineDomain,
  countSitemapTimelineTier,
  deriveSitemapTimelineCohort,
  emptySitemapTimelineTier,
  timelineDomainFromSitemapPath,
  timelineDomainsFromSitemapEntries,
  type SitemapTimelineTier,
} from "~/lib/sitemap-timeline-cohort";

/**
 * Phase-1 unit suite for the sitemap-timeline cohort (issue #1958). Pins the
 * inclusion predicate (a cohort domain without verified/likely coverage would
 * capture a phantom row over its honest existing ledger) and the read-only D1
 * adapter's honesty guards.
 */

const queryIn = vi.hoisted(() => vi.fn());
const queryAll = vi.hoisted(() => vi.fn());
const queryOne = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
const ensureDb = vi.hoisted(() => vi.fn());
const loadIndexableTimelineEntries = vi.hoisted(() => vi.fn());
const loadIndexableBrandPageEntries = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryIn,
  queryAll,
  queryOne,
  execute,
  ensureDb,
}));

// Mock at the adapter boundary.
vi.mock("~/lib/sitemap.server", () => ({
  loadIndexableTimelineEntries,
  loadIndexableBrandPageEntries,
}));

/** Fresh module load of the read-only adapter after vi.resetModules(). */
async function adapter() {
  vi.resetModules();
  return import("~/lib/sitemap-timeline-cohort.server");
}

afterEach(() => {
  queryIn.mockReset();
  queryAll.mockReset();
  queryOne.mockReset();
  execute.mockReset();
  ensureDb.mockReset();
  loadIndexableTimelineEntries.mockReset();
  loadIndexableBrandPageEntries.mockReset();
});

function makeTier(overrides: Partial<SitemapTimelineTier>): SitemapTimelineTier {
  return {
    ...emptySitemapTimelineTier(),
    ...overrides,
  };
}

describe("canonicalizeSitemapTimelineDomain", () => {
  it("lowercases and strips leading www.", () => {
    expect(canonicalizeSitemapTimelineDomain("WWW.Calendly.com")).toBe(
      "calendly.com",
    );
    expect(canonicalizeSitemapTimelineDomain("www.adspyder.io")).toBe(
      "adspyder.io",
    );
    expect(canonicalizeSitemapTimelineDomain("Calendly.com")).toBe(
      "calendly.com",
    );
  });

  it("drops a trailing dot", () => {
    expect(canonicalizeSitemapTimelineDomain("calendly.com.")).toBe(
      "calendly.com",
    );
  });

  it("returns null for empty / non-string input", () => {
    expect(canonicalizeSitemapTimelineDomain("")).toBeNull();
    expect(canonicalizeSitemapTimelineDomain("   ")).toBeNull();
    expect(canonicalizeSitemapTimelineDomain(null)).toBeNull();
    expect(canonicalizeSitemapTimelineDomain(undefined)).toBeNull();
    expect(canonicalizeSitemapTimelineDomain(123)).toBeNull();
  });
});

describe("countSitemapTimelineTier", () => {
  it("counts verified match levels as verified", () => {
    const counts = countSitemapTimelineTier([
      "registrable_domain",
      "verified_entity",
      "verified_advertiser_domain",
      "exact_hostname",
      "verified_alias",
    ]);
    expect(counts.verifiedCount).toBe(5);
    expect(counts.likelyCount).toBe(0);
    expect(counts.unmatchedCount).toBe(0);
  });

  it("counts likely_brand_name as likely", () => {
    const counts = countSitemapTimelineTier(["likely_brand_name"]);
    expect(counts.verifiedCount).toBe(0);
    expect(counts.likelyCount).toBe(1);
    expect(counts.unmatchedCount).toBe(0);
  });

  it("counts unknown / empty / non-string levels as unmatched", () => {
    const counts = countSitemapTimelineTier([
      "some_unknown_level",
      "",
      null as unknown as string,
      "unverified_text_candidate",
      42 as unknown as string,
    ]);
    expect(counts.verifiedCount).toBe(0);
    expect(counts.likelyCount).toBe(0);
    expect(counts.unmatchedCount).toBe(5);
  });
});

describe("timelineDomainFromSitemapPath", () => {
  it("extracts the registrable domain from a /timeline/:domain path", () => {
    expect(timelineDomainFromSitemapPath("/timeline/calendly.com")).toBe(
      "calendly.com",
    );
    expect(timelineDomainFromSitemapPath("/timeline/adspyder.io")).toBe(
      "adspyder.io",
    );
  });

  it("canonicalizes www./case variants in the path segment", () => {
    expect(timelineDomainFromSitemapPath("/timeline/www.Calendly.com")).toBe(
      "calendly.com",
    );
    expect(timelineDomainFromSitemapPath("/timeline/Adspyder.io")).toBe(
      "adspyder.io",
    );
  });

  it("returns null for non-timeline paths", () => {
    expect(timelineDomainFromSitemapPath("/ads/foo")).toBeNull();
    expect(timelineDomainFromSitemapPath("/")).toBeNull();
    expect(timelineDomainFromSitemapPath("")).toBeNull();
  });

  it("returns null for multi-segment timeline paths", () => {
    expect(timelineDomainFromSitemapPath("/timeline/foo/bar")).toBeNull();
    expect(timelineDomainFromSitemapPath("/timeline/calendly.com/extra")).toBeNull();
  });

  it("returns null for locale-prefixed paths", () => {
    expect(timelineDomainFromSitemapPath("/de/timeline/calendly.com")).toBeNull();
    expect(timelineDomainFromSitemapPath("/fr/timeline/adspyder.io")).toBeNull();
  });

  it("returns null for an empty segment after the prefix", () => {
    expect(timelineDomainFromSitemapPath("/timeline/")).toBeNull();
    expect(timelineDomainFromSitemapPath("/timeline")).toBeNull();
  });
});

describe("timelineDomainsFromSitemapEntries", () => {
  it("dedupes and preserves first-seen order", () => {
    const domains = timelineDomainsFromSitemapEntries([
      { path: "/timeline/calendly.com" },
      { path: "/timeline/adspyder.io" },
      { path: "/timeline/calendly.com" },
      { path: "/timeline/www.Calendly.com" },
    ]);
    expect(domains).toEqual(["calendly.com", "adspyder.io"]);
  });

  it("drops entries that do not map to a /timeline/:domain path", () => {
    const domains = timelineDomainsFromSitemapEntries([
      { path: "/ads/nike.com" },
      { path: "/timeline/foo/bar" },
      { path: "/de/timeline/calendly.com" },
      { path: "/timeline/" },
    ]);
    expect(domains).toEqual([]);
  });

  it("returns [] for a non-array input", () => {
    expect(
      timelineDomainsFromSitemapEntries(null as unknown as { path: string }[]),
    ).toEqual([]);
  });
});

describe("deriveSitemapTimelineCohort", () => {
  it("(a) a candidate with hasCoverage tier is included", () => {
    const tier = makeTier({ verifiedCount: 3, likelyCount: 1, hasCoverage: true });
    const cohort = deriveSitemapTimelineCohort(
      ["calendly.com"],
      new Map([["calendly.com", tier]]),
    );
    expect(cohort).toEqual([{ domain: "calendly.com", tier }]);
  });

  it("(b) a candidate whose tier says hasCoverage false stays out", () => {
    const cohort = deriveSitemapTimelineCohort(
      ["calendly.com"],
      new Map([
        [
          "calendly.com",
          makeTier({ verifiedCount: 0, likelyCount: 0, unmatchedCount: 3 }),
        ],
      ]),
    );
    expect(cohort).toEqual([]);
  });

  it("(c) a candidate with no tier entry stays out", () => {
    const cohort = deriveSitemapTimelineCohort(
      ["calendly.com", "adspyder.io"],
      new Map([
        ["adspyder.io", makeTier({ verifiedCount: 1, hasCoverage: true })],
      ]),
    );
    expect(cohort).toEqual([
      { domain: "adspyder.io", tier: expect.objectContaining({ verifiedCount: 1 }) },
    ]);
  });

  it("(d) excluded demo and sneaker-seed domains stay out even with coverage", () => {
    const covered = makeTier({ verifiedCount: 2, hasCoverage: true });
    const cohort = deriveSitemapTimelineCohort(
      ["calendly.com", "nike.com", "stockx.com"],
      new Map([
        ["calendly.com", covered],
        ["nike.com", covered],
        ["stockx.com", covered],
      ]),
      new Set(["nike.com", "stockx.com"]),
    );
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.domain).toBe("calendly.com");
  });

  it("(e) exclusion is normalized through the canonicalizer (www./case/trailing dot)", () => {
    const covered = makeTier({ verifiedCount: 1, hasCoverage: true });
    const cohort = deriveSitemapTimelineCohort(
      ["Calendly.com", "www.Nike.com"],
      new Map([
        ["calendly.com", covered],
        ["nike.com", covered],
      ]),
      ["nike.com", "Calendly.com."],
    );
    expect(cohort).toEqual([]);
  });

  it("(f) duplicate candidates collapse to one entry", () => {
    const tier = makeTier({ verifiedCount: 1, hasCoverage: true });
    const cohort = deriveSitemapTimelineCohort(
      ["calendly.com", "Calendly.com", "www.calendly.com"],
      new Map([["calendly.com", tier]]),
    );
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.domain).toBe("calendly.com");
  });

  it("(g) empty candidates and empty tier maps yield an empty cohort", () => {
    expect(
      deriveSitemapTimelineCohort([], new Map()),
    ).toEqual([]);
    expect(
      deriveSitemapTimelineCohort(["calendly.com"], new Map()),
    ).toEqual([]);
  });

  it("skips empty / non-string candidates", () => {
    const tier = makeTier({ verifiedCount: 1, hasCoverage: true });
    const cohort = deriveSitemapTimelineCohort(
      ["", "   ", 42 as unknown as string, "calendly.com"],
      new Map([["calendly.com", tier]]),
    );
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.domain).toBe("calendly.com");
  });
});

describe("getSitemapTimelineTierByDomain (read-only D1 adapter)", () => {
  it("(h) builds the right candidate keys for calendly.com + adspyder.io and emits NO expiry filter", async () => {
    queryIn.mockResolvedValue([]);
    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    await getSitemapTimelineTierByDomain(env, ["calendly.com", "adspyder.io"]);

    expect(queryIn).toHaveBeenCalledTimes(1);
    const call = queryIn.mock.calls[0]?.[1];
    expect(call).toBeDefined();
    const sql = call.buildSql("?,?,?,?,?,?");
    expect(sql).toContain("FROM discovery_cache_entry");
    expect(sql).toContain("route_context = 'public_search'");
    expect(sql).toContain("country = 'all'");
    expect(sql).toContain("cache_key IN (?,?,?,?,?,?)");
    // Manager decision: no `expires_at > ?` gate — age surfaces as cacheStatus.
    expect(sql).not.toContain("expires_at >");
    expect(call.prefix).toBeUndefined();
    expect(call.values).toEqual([
      "search-v2:domain:calendly.com:exact:meta_api:all:page-1",
      "search-v2:domain:calendly.com:exact:meta_library_browser:all:page-1",
      "search-v2:domain:calendly.com:exact:demo:all:page-1",
      "search-v2:domain:adspyder.io:exact:meta_api:all:page-1",
      "search-v2:domain:adspyder.io:exact:meta_library_browser:all:page-1",
      "search-v2:domain:adspyder.io:exact:demo:all:page-1",
    ]);
  });

  it("(i) parses payload tiers into a per-domain tier map (fresh row)", async () => {
    const fetchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const calendlyKey =
      "search-v2:domain:calendly.com:exact:meta_library_browser:all:page-1";
    const adspyderKey =
      "search-v2:domain:adspyder.io:exact:meta_library_browser:all:page-1";

    queryIn.mockResolvedValue([
      {
        cache_key: calendlyKey,
        fetched_at: fetchedAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [
            { domainMatch: { level: "registrable_domain" } },
            { domainMatch: { level: "registrable_domain" } },
            { domainMatch: { level: "likely_brand_name" } },
            { domainMatch: { level: "unverified_text_candidate" } },
          ],
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      },
      {
        cache_key: adspyderKey,
        fetched_at: fetchedAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [{ domainMatch: { level: "exact_hostname" } }],
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      },
    ]);

    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, [
      "calendly.com",
      "adspyder.io",
    ]);

    expect(tierByDomain.get("calendly.com")).toEqual({
      verifiedCount: 2,
      likelyCount: 1,
      unmatchedCount: 1,
      hasCoverage: true,
      cacheStatus: "fresh",
    });
    expect(tierByDomain.get("adspyder.io")).toEqual({
      verifiedCount: 1,
      likelyCount: 0,
      unmatchedCount: 0,
      hasCoverage: true,
      cacheStatus: "fresh",
    });
  });

  it("(j) the most-recently-fetched row wins on provider rollover", async () => {
    const now = Date.now();
    const expiresAt = new Date(now + 12 * 60 * 60 * 1000).toISOString();
    const newerAt = new Date(now - 10 * 60 * 1000).toISOString();
    const olderAt = new Date(now - 60 * 60 * 1000).toISOString();
    const olderKey =
      "search-v2:domain:calendly.com:exact:meta_api:all:page-1";
    const newerKey =
      "search-v2:domain:calendly.com:exact:meta_library_browser:all:page-1";

    queryIn.mockResolvedValue([
      {
        cache_key: olderKey,
        fetched_at: olderAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [
            { domainMatch: { level: "registrable_domain" } },
            { domainMatch: { level: "registrable_domain" } },
          ],
          source: "meta_api",
          provider: "meta_api",
        }),
      },
      {
        cache_key: newerKey,
        fetched_at: newerAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [{ domainMatch: { level: "registrable_domain" } }],
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      },
    ]);

    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, [
      "calendly.com",
    ]);

    expect(tierByDomain.get("calendly.com")).toEqual({
      verifiedCount: 1,
      likelyCount: 0,
      unmatchedCount: 0,
      hasCoverage: true,
      cacheStatus: "fresh",
    });
  });

  it("(k) falls through a newest demo row to the next-newest non-demo row", async () => {
    const now = Date.now();
    const expiresAt = new Date(now + 12 * 60 * 60 * 1000).toISOString();
    const demoAt = new Date(now - 5 * 60 * 1000).toISOString();
    const commercialAt = new Date(now - 25 * 60 * 1000).toISOString();
    const demoKey = "search-v2:domain:calendly.com:exact:demo:all:page-1";
    const commercialKey =
      "search-v2:domain:calendly.com:exact:meta_library_browser:all:page-1";

    queryIn.mockResolvedValue([
      {
        cache_key: demoKey,
        fetched_at: demoAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [{ domainMatch: { level: "registrable_domain" } }],
          source: "demo",
          provider: "demo",
        }),
      },
      {
        cache_key: commercialKey,
        fetched_at: commercialAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [{ domainMatch: { level: "registrable_domain" } }],
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      },
    ]);

    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, [
      "calendly.com",
    ]);

    expect(tierByDomain.get("calendly.com")).toEqual({
      verifiedCount: 1,
      likelyCount: 0,
      unmatchedCount: 0,
      hasCoverage: true,
      cacheStatus: "fresh",
    });
  });

  it("(l) surfaces cacheStatus 'stale' (not 'fresh') when expires_at is in the past — coverage kept", async () => {
    const now = new Date();
    const fetchedAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Expired at read time (manager decision: no SQL gate — verdict survives,
    // age surfaces as stale).
    const expiredAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const key = "search-v2:domain:calendly.com:exact:meta_library_browser:all:page-1";

    queryIn.mockResolvedValue([
      {
        cache_key: key,
        fetched_at: fetchedAt,
        expires_at: expiredAt,
        payload_json: JSON.stringify({
          ads: [
            { domainMatch: { level: "registrable_domain" } },
            { domainMatch: { level: "registrable_domain" } },
          ],
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      },
    ]);

    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, [
      "calendly.com",
    ]);

    expect(tierByDomain.get("calendly.com")).toEqual({
      verifiedCount: 2,
      likelyCount: 0,
      unmatchedCount: 0,
      hasCoverage: true,
      cacheStatus: "stale",
    });
  });

  it("(m) returns an empty map (no throw) when env.DB is missing", async () => {
    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = {} as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, [
      "calendly.com",
      "adspyder.io",
    ]);

    expect(tierByDomain).toBeInstanceOf(Map);
    expect(tierByDomain.size).toBe(0);
    expect(queryIn).not.toHaveBeenCalled();
  });

  it("returns an empty map when the domain list is empty (no D1 call)", async () => {
    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, []);
    expect(tierByDomain.size).toBe(0);
    expect(queryIn).not.toHaveBeenCalled();
  });

  it("treats a `no such table: discovery_cache_entry` error as an empty map (no throw)", async () => {
    queryIn.mockRejectedValue(new Error("no such table: discovery_cache_entry"));

    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, [
      "calendly.com",
    ]);
    expect(tierByDomain.size).toBe(0);
  });

  it("excludes demo-source payloads so demo data never back a public cohort entry", async () => {
    const fetchedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const key = "search-v2:domain:calendly.com:exact:demo:all:page-1";
    queryIn.mockResolvedValue([
      {
        cache_key: key,
        fetched_at: fetchedAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [
            { domainMatch: { level: "registrable_domain" } },
            { domainMatch: { level: "registrable_domain" } },
          ],
          source: "demo",
          provider: "demo",
        }),
      },
    ]);

    const { getSitemapTimelineTierByDomain } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSitemapTimelineTierByDomain(env, [
      "calendly.com",
    ]);
    expect(tierByDomain.size).toBe(0);
  });
});

describe("loadSitemapTimelineCandidateDomains (read-only D1 adapter)", () => {
  it("maps capture-backed timeline entries plus the tracked /ads cohort to deduped, ordered domains", async () => {
    loadIndexableTimelineEntries.mockResolvedValue([
      { path: "/timeline/calendly.com", lastmod: "2026-09-01" },
      { path: "/timeline/adspyder.io", lastmod: "2026-09-01" },
      { path: "/timeline/www.Calendly.com", lastmod: "2026-09-01" },
      { path: "/timeline/foo/bar", lastmod: "2026-09-01" },
    ]);
    loadIndexableBrandPageEntries.mockResolvedValue([
      { path: "/ads/nike.com" },
      { path: "/ads/gymshark.com" },
      { path: "/ads/hubspot.com/about" },
      { path: "/ads/calendly.com" },
      { path: "/compare/adspyder" },
    ]);

    const { loadSitemapTimelineCandidateDomains } = await adapter();

    const env = { DB: {} } as unknown as AppEnv;
    const domains = await loadSitemapTimelineCandidateDomains(env);

    expect(loadIndexableTimelineEntries).toHaveBeenCalledTimes(1);
    expect(loadIndexableTimelineEntries).toHaveBeenCalledWith(env);
    expect(loadIndexableBrandPageEntries).toHaveBeenCalledTimes(1);
    expect(loadIndexableBrandPageEntries).toHaveBeenCalledWith(env);
    // Capture-backed first, then the /ads cohort (deduped, canonicalized);
    // multi-segment /ads paths and non-/ads paths never guess a domain.
    expect(domains).toEqual([
      "calendly.com",
      "adspyder.io",
      "nike.com",
      "gymshark.com",
    ]);
  });

  it("returns [] (no sitemap read) when env.DB is missing", async () => {
    const { loadSitemapTimelineCandidateDomains } = await adapter();

    const env = {} as unknown as AppEnv;
    const domains = await loadSitemapTimelineCandidateDomains(env);

    expect(domains).toEqual([]);
    expect(loadIndexableTimelineEntries).not.toHaveBeenCalled();
    expect(loadIndexableBrandPageEntries).not.toHaveBeenCalled();
  });
});

describe("sitemapTimelineExcludedDomains (static, no D1)", () => {
  it("contains the five demo brands and the sneaker-resale seed domains, deduped", async () => {
    const { sitemapTimelineExcludedDomains } = await adapter();

    const excluded = sitemapTimelineExcludedDomains();

    // All five BET 3 demo brands (the demo-brand rail owns their timelines).
    for (const demoDomain of [
      "nike.com",
      "nykaa.com",
      "allbirds.com",
      "lenskart.com",
      "mamaearth.com",
    ]) {
      expect(excluded).toContain(demoDomain);
    }

    // Sneaker seed domains (first, last, and an interior one).
    expect(excluded).toContain("nike.com");
    expect(excluded).toContain("stockx.com");
    expect(excluded).toContain("finishline.com");

    // Length is derived from the live seed list (it grows with market-signal
    // refreshes — never hardcode it): 5 demo brands ∪ seed domains, deduped.
    const { resolveSeedList } = await import("~/lib/ads-domain-publisher.server");
    const { SNEAKER_RESALE_SEED_LIST } = await import(
      "~/lib/sneaker-resale-backfill.server"
    );
    const { canonicalizeSitemapTimelineDomain } = await import(
      "~/lib/sitemap-timeline-cohort"
    );
    const seedDomains = new Set(
      (resolveSeedList(SNEAKER_RESALE_SEED_LIST)?.domains ?? [])
        .map((entry) => canonicalizeSitemapTimelineDomain(entry?.domain))
        .filter((d): d is string => d !== null),
    );
    const expected = new Set([
      "nike.com",
      "nykaa.com",
      "allbirds.com",
      "lenskart.com",
      "mamaearth.com",
      ...seedDomains,
    ]);
    expect(excluded).toHaveLength(expected.size);
    expect(new Set(excluded).size).toBe(excluded.length);
    // Deterministic order: demo brands first, then seed-list order.
    expect(excluded.slice(0, 5)).toEqual([
      "nike.com",
      "nykaa.com",
      "allbirds.com",
      "lenskart.com",
      "mamaearth.com",
    ]);
  });
});