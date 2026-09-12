import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import sneakerResaleSeedList from "../data/seed-lists/sneaker-resale.json";
import type { SeedList } from "~/lib/ads-domain-publisher.server";
import type { AppEnv } from "~/lib/env.server";
import {
  canonicalizeSneakerResaleDomain,
  countSneakerResaleTier,
  deriveSneakerResaleCohort,
  emptySneakerResaleTier,
  type SneakerResaleTier,
} from "~/lib/sneaker-resale-cohort";

/**
 * Phase-1 unit suite for the sneaker-resale cohort (issue #1946). The
 * nightly offer-timeline backfill (phase 2) iterates the cohort this suite
 * guards; a cohort that ships a brand with no verified/likely coverage
 * would write a phantom timeline row, so every test pins the inclusion
 * predicate to the public predicate the publisher already uses.
 */

const queryIn = vi.hoisted(() => vi.fn());

vi.mock("~/lib/data/d1.server", () => ({
  queryIn,
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  ensureDb: vi.fn(),
}));

afterEach(() => {
  queryIn.mockReset();
});

function makeSeedList(domains: ReadonlyArray<{ domain: string; brand?: string }>): SeedList {
  return {
    cluster: "sneaker-resale",
    asOf: "2026-09-01",
    sourceNote: "test",
    domains: [...domains],
  };
}

function makeTier(overrides: Partial<SneakerResaleTier>): SneakerResaleTier {
  return {
    ...emptySneakerResaleTier(),
    ...overrides,
  };
}

describe("canonicalizeSneakerResaleDomain", () => {
  it("lowercases and strips leading www.", () => {
    expect(canonicalizeSneakerResaleDomain("WWW.StockX.com")).toBe("stockx.com");
    expect(canonicalizeSneakerResaleDomain("www.nike.com")).toBe("nike.com");
  });

  it("drops a trailing dot", () => {
    expect(canonicalizeSneakerResaleDomain("nike.com.")).toBe("nike.com");
  });

  it("returns null for empty / non-string input", () => {
    expect(canonicalizeSneakerResaleDomain("")).toBeNull();
    expect(canonicalizeSneakerResaleDomain("   ")).toBeNull();
    expect(canonicalizeSneakerResaleDomain(null)).toBeNull();
    expect(canonicalizeSneakerResaleDomain(undefined)).toBeNull();
    expect(canonicalizeSneakerResaleDomain(123)).toBeNull();
  });
});

describe("countSneakerResaleTier", () => {
  it("counts verified match levels as verified", () => {
    const counts = countSneakerResaleTier([
      "registrable_domain",
      "verified_entity",
      "verified_advertiser_domain",
    ]);
    expect(counts.verifiedCount).toBe(3);
    expect(counts.likelyCount).toBe(0);
    expect(counts.unmatchedCount).toBe(0);
  });

  it("counts likely_brand_name as likely", () => {
    const counts = countSneakerResaleTier(["likely_brand_name"]);
    expect(counts.verifiedCount).toBe(0);
    expect(counts.likelyCount).toBe(1);
    expect(counts.unmatchedCount).toBe(0);
  });

  it("counts unknown / empty levels as unmatched", () => {
    const counts = countSneakerResaleTier([
      "some_unknown_level",
      "",
      null as unknown as string,
      "unverified_text_candidate",
    ]);
    expect(counts.verifiedCount).toBe(0);
    expect(counts.likelyCount).toBe(0);
    expect(counts.unmatchedCount).toBe(4);
  });
});

describe("deriveSneakerResaleCohort", () => {
  it("(a) respects both inputs: 3 seed entries, 2 tiers → cohort of 2", () => {
    const seed = makeSeedList([
      { domain: "stockx.com", brand: "StockX" },
      { domain: "goat.com", brand: "GOAT" },
      { domain: "saucony.com", brand: "Saucony" },
    ]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      [
        "stockx.com",
        makeTier({ verifiedCount: 4, likelyCount: 2, hasCoverage: true }),
      ],
      [
        "saucony.com",
        makeTier({ verifiedCount: 1, likelyCount: 0, hasCoverage: true }),
      ],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toHaveLength(2);
    expect(cohort.map((entry) => entry.domain).sort()).toEqual([
      "saucony.com",
      "stockx.com",
    ]);
    expect(cohort.find((entry) => entry.domain === "stockx.com")?.brand).toBe(
      "StockX",
    );
  });

  it("(b) brand without a cache row is excluded", () => {
    const seed = makeSeedList([
      { domain: "stockx.com", brand: "StockX" },
      { domain: "goat.com", brand: "GOAT" },
    ]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      [
        "stockx.com",
        makeTier({ verifiedCount: 2, likelyCount: 1, hasCoverage: true }),
      ],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.domain).toBe("stockx.com");
  });

  it("(c) brand with verified=1, likely=0 is included", () => {
    const seed = makeSeedList([{ domain: "stockx.com", brand: "StockX" }]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      ["stockx.com", makeTier({ verifiedCount: 1, likelyCount: 0, hasCoverage: true })],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.domain).toBe("stockx.com");
    expect(cohort[0]?.tier.verifiedCount).toBe(1);
  });

  it("(d) brand with verified=0, likely=0, unmatched=3 is excluded", () => {
    const seed = makeSeedList([{ domain: "goat.com", brand: "GOAT" }]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      [
        "goat.com",
        makeTier({
          verifiedCount: 0,
          likelyCount: 0,
          unmatchedCount: 3,
          hasCoverage: false,
        }),
      ],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toEqual([]);
  });

  it("(e) empty seed list → empty cohort", () => {
    const seed = makeSeedList([]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      ["stockx.com", makeTier({ verifiedCount: 1, hasCoverage: true })],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toEqual([]);
  });

  it("(f) brand with likely=1, verified=0 is included (likely alone counts)", () => {
    const seed = makeSeedList([{ domain: "hypebeast.com", brand: "Hypebeast" }]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      [
        "hypebeast.com",
        makeTier({ verifiedCount: 0, likelyCount: 1, hasCoverage: true }),
      ],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.domain).toBe("hypebeast.com");
    expect(cohort[0]?.tier.likelyCount).toBe(1);
  });

  it("matches the publisher's www./case normalization (stockx.com === WWW.StockX.com)", () => {
    const seed = makeSeedList([
      { domain: "WWW.StockX.com", brand: "StockX" },
    ]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      ["stockx.com", makeTier({ verifiedCount: 1, hasCoverage: true })],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.domain).toBe("stockx.com");
    expect(cohort[0]?.brand).toBe("StockX");
  });

  it("drops duplicate seed domains without double-counting them", () => {
    const seed = makeSeedList([
      { domain: "stockx.com", brand: "StockX" },
      { domain: "StockX.com", brand: "StockX duplicate" },
    ]);
    const tierByDomain = new Map<string, SneakerResaleTier>([
      ["stockx.com", makeTier({ verifiedCount: 1, hasCoverage: true })],
    ]);

    const cohort = deriveSneakerResaleCohort(seed, tierByDomain);
    expect(cohort).toHaveLength(1);
    expect(cohort[0]?.brand).toBe("StockX");
  });
});

describe("deriveSneakerResaleCohort with the bundled seed list", () => {
  it("filters the real bundled sneaker-resale seed list down to the covered brands", () => {
    // Use a fake tier map so the test stays deterministic: stockx.com and
    // flightclub.com have coverage; the rest are unmatched-only.
    const tierByDomain = new Map<string, SneakerResaleTier>();
    for (const entry of sneakerResaleSeedList.domains) {
      const canonical = canonicalizeSneakerResaleDomain(entry.domain);
      if (!canonical) continue;
      const covered = canonical === "stockx.com" || canonical === "flightclub.com";
      tierByDomain.set(
        canonical,
        covered
          ? makeTier({ verifiedCount: 2, likelyCount: 1, hasCoverage: true })
          : makeTier({ verifiedCount: 0, likelyCount: 0, unmatchedCount: 1, hasCoverage: false }),
      );
    }

    const cohort = deriveSneakerResaleCohort(
      sneakerResaleSeedList as SeedList,
      tierByDomain,
    );
    expect(cohort.map((entry) => entry.domain).sort()).toEqual([
      "flightclub.com",
      "stockx.com",
    ]);
  });
});

describe("getSneakerResaleTierByDomain (read-only D1 adapter)", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("(g) returns a per-domain tier map when queryIn yields fresh cache rows", async () => {
    const fetchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const stockxKey = "search-v2:domain:stockx.com:exact:meta_library_browser:all:page-1";
    const flightclubKey = "search-v2:domain:flightclub.com:exact:meta_library_browser:all:page-1";
    const goatKey = "search-v2:domain:goat.com:exact:meta_library_browser:all:page-1";

    queryIn.mockResolvedValue([
      {
        cache_key: stockxKey,
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
        cache_key: flightclubKey,
        fetched_at: fetchedAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [{ domainMatch: { level: "exact_hostname" } }],
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      },
      {
        cache_key: goatKey,
        fetched_at: fetchedAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [
            { domainMatch: { level: "unverified_text_candidate" } },
            { domainMatch: { level: "unverified_provider_candidate" } },
            { domainMatch: { level: "unverified_text_candidate" } },
          ],
          source: "meta_library_browser",
          provider: "meta_library_browser",
        }),
      },
    ]);

    const { getSneakerResaleTierByDomain } = await import(
      "~/lib/sneaker-resale-cohort.server"
    );

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSneakerResaleTierByDomain(env, [
      "stockx.com",
      "flightclub.com",
      "goat.com",
    ]);

    expect(tierByDomain.get("stockx.com")).toEqual({
      verifiedCount: 2,
      likelyCount: 1,
      unmatchedCount: 1,
      hasCoverage: true,
      cacheStatus: "fresh",
    });
    expect(tierByDomain.get("flightclub.com")).toEqual({
      verifiedCount: 1,
      likelyCount: 0,
      unmatchedCount: 0,
      hasCoverage: true,
      cacheStatus: "fresh",
    });
    expect(tierByDomain.get("goat.com")).toEqual({
      verifiedCount: 0,
      likelyCount: 0,
      unmatchedCount: 3,
      hasCoverage: false,
      cacheStatus: "fresh",
    });
  });

  it("(h) returns an empty map (no throw) when env.DB is missing", async () => {
    const { getSneakerResaleTierByDomain } = await import(
      "~/lib/sneaker-resale-cohort.server"
    );

    const env = {} as unknown as AppEnv;
    const tierByDomain = await getSneakerResaleTierByDomain(env, [
      "stockx.com",
      "flightclub.com",
    ]);

    expect(tierByDomain).toBeInstanceOf(Map);
    expect(tierByDomain.size).toBe(0);
    expect(queryIn).not.toHaveBeenCalled();
  });

  it("returns an empty map when the domain list is empty (no D1 call)", async () => {
    const { getSneakerResaleTierByDomain } = await import(
      "~/lib/sneaker-resale-cohort.server"
    );

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSneakerResaleTierByDomain(env, []);
    expect(tierByDomain.size).toBe(0);
    expect(queryIn).not.toHaveBeenCalled();
  });

  it("treats a `no such table: discovery_cache_entry` error as an empty map (no throw)", async () => {
    queryIn.mockRejectedValue(new Error("no such table: discovery_cache_entry"));

    const { getSneakerResaleTierByDomain } = await import(
      "~/lib/sneaker-resale-cohort.server"
    );

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSneakerResaleTierByDomain(env, ["stockx.com"]);
    expect(tierByDomain.size).toBe(0);
  });

  it("excludes demo-source payloads so demo data never back a public cohort entry", async () => {
    const fetchedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const key = "search-v2:domain:stockx.com:exact:demo:all:page-1";
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

    const { getSneakerResaleTierByDomain } = await import(
      "~/lib/sneaker-resale-cohort.server"
    );

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSneakerResaleTierByDomain(env, ["stockx.com"]);
    expect(tierByDomain.size).toBe(0);
  });

  it("falls through a demo-source row to an older non-demo row for the same domain (issue #1946)", async () => {
    const now = Date.now();
    const demoFetchedAt = new Date(now - 5 * 60 * 1000).toISOString();
    const commercialFetchedAt = new Date(now - 25 * 60 * 1000).toISOString();
    const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();
    const demoKey = "search-v2:domain:stockx.com:exact:demo:all:page-1";
    const commercialKey =
      "search-v2:domain:stockx.com:exact:meta_library_browser:all:page-1";
    queryIn.mockResolvedValue([
      {
        cache_key: demoKey,
        fetched_at: demoFetchedAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [],
          source: "demo",
          provider: "demo",
        }),
      },
      {
        cache_key: commercialKey,
        fetched_at: commercialFetchedAt,
        expires_at: expiresAt,
        payload_json: JSON.stringify({
          ads: [{ domainMatch: { level: "registrable_domain" } }],
        }),
      },
    ]);

    const { getSneakerResaleTierByDomain } = await import(
      "~/lib/sneaker-resale-cohort.server"
    );

    const env = { DB: {} } as unknown as AppEnv;
    const tierByDomain = await getSneakerResaleTierByDomain(env, ["stockx.com"]);
    // The newest row is a demo payload; the still-fresh commercial row from
    // the same freshness window must win, not be silently discarded.
    expect(tierByDomain.get("stockx.com")).toEqual({
      verifiedCount: 1,
      likelyCount: 0,
      unmatchedCount: 0,
      hasCoverage: true,
      cacheStatus: "fresh",
    });
  });

  it("passes route_context='public_search' AND expires_at>now AND country='all' AND the cache_key list to queryIn", async () => {
    queryIn.mockResolvedValue([]);
    const { getSneakerResaleTierByDomain } = await import(
      "~/lib/sneaker-resale-cohort.server"
    );

    const env = { DB: {} } as unknown as AppEnv;
    await getSneakerResaleTierByDomain(env, ["stockx.com", "goat.com"]);

    expect(queryIn).toHaveBeenCalledTimes(1);
    const call = queryIn.mock.calls[0]?.[1];
    expect(call).toBeDefined();
    const sql = call.buildSql("?,?,?,?,?,?");
    expect(sql).toContain("FROM discovery_cache_entry");
    expect(sql).toContain("route_context = 'public_search'");
    expect(sql).toContain("country = 'all'");
    expect(sql).toContain("expires_at > ?");
    expect(sql).toContain("cache_key IN (?,?,?,?,?,?)");
    // prefix: [nowIso]; suffix: undefined; values: 2 domains × 3 providers = 6.
    expect(call.prefix).toHaveLength(1);
    expect(typeof call.prefix[0]).toBe("string");
    expect(call.values).toEqual([
      "search-v2:domain:stockx.com:exact:meta_api:all:page-1",
      "search-v2:domain:stockx.com:exact:meta_library_browser:all:page-1",
      "search-v2:domain:stockx.com:exact:demo:all:page-1",
      "search-v2:domain:goat.com:exact:meta_api:all:page-1",
      "search-v2:domain:goat.com:exact:meta_library_browser:all:page-1",
      "search-v2:domain:goat.com:exact:demo:all:page-1",
    ]);
  });
});