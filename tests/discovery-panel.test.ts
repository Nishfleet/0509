import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DISCOVERY_EVAL_PANEL,
  DISCOVERY_EVAL_PANEL_DOMAINS,
  formatDiscoveryPanelCoverageReport,
  registrableDomainsFromSearchV2CacheKeys,
  scoreDiscoveryPanelCoverage,
  warmRecentPublicSearchDomains,
} from "~/lib/discovery-panel.server";

const SPIKE_V2_DOMAINS = [
  "allbirds.com",
  "notion.so",
  "ouraring.com",
  "nykaa.com",
  "gymshark.com",
  "hubspot.com",
  "ridgewallet.com",
  "bombayshavingcompany.com",
  "curofy.com",
  "mailchimp.com",
  "canva.com",
  "plausible.io",
] as const;

describe("discovery eval panel", () => {
  it("matches the spike-v2 12-domain panel in order", () => {
    expect(DISCOVERY_EVAL_PANEL_DOMAINS).toEqual([...SPIKE_V2_DOMAINS]);
    expect(DISCOVERY_EVAL_PANEL).toHaveLength(12);
  });

  it("keeps the coverage script on the same panel", () => {
    const script = readFileSync(
      new URL("../scripts/discovery-panel-coverage.mjs", import.meta.url),
      "utf8",
    );
    for (const domain of SPIKE_V2_DOMAINS) {
      expect(script).toContain(`"${domain}"`);
    }
  });
});

describe("scoreDiscoveryPanelCoverage", () => {
  it("counts a domain covered when the public search returned ≥1 ad", () => {
    const coverage = scoreDiscoveryPanelCoverage([
      { domain: "allbirds.com", adCount: 9 },
      { domain: "notion.so", adCount: 0 },
    ]);
    expect(coverage.total).toBe(12);
    expect(coverage.covered).toBe(1);
    expect(coverage.perDomain[0]).toMatchObject({
      domain: "allbirds.com",
      adCount: 9,
      covered: true,
    });
    expect(coverage.perDomain[1]).toMatchObject({
      domain: "notion.so",
      adCount: 0,
      covered: false,
    });
  });

  it("renders a per-domain markdown report", () => {
    const report = formatDiscoveryPanelCoverageReport(
      scoreDiscoveryPanelCoverage([{ domain: "allbirds.com", adCount: 3 }]),
      { generatedAt: "2026-08-26T00:00:00.000Z" },
    );
    expect(report).toContain("Covered: 1/12");
    expect(report).toContain("| allbirds.com | 3 | yes |");
    expect(report).toContain("| plausible.io | 0 | no |");
  });
});

describe("warmDiscoveryEvalPanel", () => {
  afterEach(() => {
    vi.doUnmock("~/lib/ad-source.server");
    vi.resetModules();
  });

  it("writes search-v2 domain keys with public_search_warmup purpose", async () => {
    vi.resetModules();
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
      ads: [{ metaAdId: "ad-1" }],
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    const hasFreshDiscoveryCacheEntry = vi.fn().mockResolvedValue(false);
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver,
      hasFreshDiscoveryCacheEntry,
    }));

    const { warmDiscoveryEvalPanel } = await import("~/lib/discovery-panel.server");
    const result = await warmDiscoveryEvalPanel({ DB: {} } as never);

    expect(result).toMatchObject({ attempted: 12, succeeded: 12, failed: 0, skipped: 0 });
    expect(searchAdsViaSourceResolver).toHaveBeenCalledTimes(12);
    expect(searchAdsViaSourceResolver).toHaveBeenNthCalledWith(
      1,
      { DB: {} },
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({ query: "allbirds.com", country: "all" }),
      }),
      null,
      expect.objectContaining({
        purpose: "public_search_warmup",
        cacheKeyOverride: expect.stringContaining("search-v2:domain:allbirds.com:exact:"),
        executionContext: null,
      }),
    );
  });

  it("skips panel domains that already have a fresh public-search cache entry", async () => {
    vi.resetModules();
    const searchAdsViaSourceResolver = vi.fn();
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver,
      hasFreshDiscoveryCacheEntry: vi.fn().mockResolvedValue(true),
    }));

    const { warmDiscoveryEvalPanel } = await import("~/lib/discovery-panel.server");
    const result = await warmDiscoveryEvalPanel({ DB: {} } as never);

    expect(result).toMatchObject({ attempted: 0, succeeded: 0, failed: 0, skipped: 12 });
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
  });
});

describe("registrableDomainsFromSearchV2CacheKeys", () => {
  it("extracts distinct registrable domains from search-v2 domain keys in recency order", () => {
    expect(
      registrableDomainsFromSearchV2CacheKeys([
        "search-v2:domain:canva.com:exact:meta_library_browser:all:",
        "search-v2:domain:allbirds.com:exact:meta_library_browser:all:",
        "search-v2:domain:canva.com:exact:meta_library_browser:in:",
        "search-v2:domain:allbirds.com:exact:meta_library_browser:all:",
        "search-v2:fingerprint:abc123:",
      ]),
    ).toEqual(["canva.com", "allbirds.com"]);
  });

  it("drops malformed keys and honors the limit", () => {
    expect(
      registrableDomainsFromSearchV2CacheKeys(
        [
          "search-v2:domain:a.com:exact:p:all:",
          "search-v2:domain::exact:p:all:",
          "search-v2:domain:b.com:exact:p:all:",
          "search-v2:domain:c.com:exact:p:all:",
        ],
        2,
      ),
    ).toEqual(["a.com", "b.com"]);
  });
});

describe("warmRecentPublicSearchDomains", () => {
  afterEach(() => {
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/data/d1.server");
    vi.resetModules();
  });

  it("warms the top distinct domains from recent public_search cache rows", async () => {
    vi.resetModules();
    const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
      ads: [{ metaAdId: "ad-1" }],
      cacheStatus: "miss",
      discoveryStatus: "healthy",
    });
    const hasFreshDiscoveryCacheEntry = vi.fn().mockResolvedValue(false);
    const queryAll = vi
      .fn()
      .mockResolvedValue([
        { cache_key: "search-v2:domain:canva.com:exact:meta_library_browser:all:" },
        { cache_key: "search-v2:domain:allbirds.com:exact:meta_library_browser:all:" },
      ]);
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver,
      hasFreshDiscoveryCacheEntry,
    }));
    vi.doMock("~/lib/data/d1.server", () => ({ queryAll }));

    const { warmRecentPublicSearchDomains } = await import(
      "~/lib/discovery-panel.server"
    );
    const result = await warmRecentPublicSearchDomains({ DB: {} } as never);

    expect(result).toMatchObject({ attempted: 2, succeeded: 2, failed: 0, skipped: 0 });
    expect(queryAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("route_context = 'public_search'"),
      "search-v2:domain:%",
      200,
    );
    expect(searchAdsViaSourceResolver).toHaveBeenNthCalledWith(
      1,
      { DB: {} },
      expect.objectContaining({
        mode: "advertiser",
        filters: expect.objectContaining({ query: "canva.com" }),
      }),
      null,
      expect.objectContaining({
        purpose: "public_search_warmup",
        cacheKeyOverride: expect.stringContaining("search-v2:domain:canva.com:exact:"),
      }),
    );
  });

  it("skips already-fresh domains and returns empty when the cache read fails", async () => {
    vi.resetModules();
    const searchAdsViaSourceResolver = vi.fn();
    const hasFreshDiscoveryCacheEntry = vi.fn().mockResolvedValue(true);
    const queryAll = vi.fn().mockRejectedValue(new Error("no such table"));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver,
      hasFreshDiscoveryCacheEntry,
    }));
    vi.doMock("~/lib/data/d1.server", () => ({ queryAll }));

    const { warmRecentPublicSearchDomains } = await import(
      "~/lib/discovery-panel.server"
    );

    expect(await warmRecentPublicSearchDomains({ DB: {} } as never)).toMatchObject({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });
    expect(searchAdsViaSourceResolver).not.toHaveBeenCalled();
  });
});
