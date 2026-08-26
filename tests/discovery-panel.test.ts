import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DISCOVERY_EVAL_PANEL,
  DISCOVERY_EVAL_PANEL_DOMAINS,
  formatDiscoveryPanelCoverageReport,
  scoreDiscoveryPanelCoverage,
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
        filters: expect.objectContaining({ query: "allbirds", country: "all" }),
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
