import { describe, expect, it } from "vitest";

import {
  STALE_ZERO_RESULT_CUTOFF,
  buildDiscoveryCacheKey,
  isDiscoveryCacheRouteCompatible,
  isDiscoveryCacheWithinMaxAge,
  isStaleZeroResultDiscoveryCacheEntry,
  resolveDiscoveryCacheTtlMs,
  resolveScheduledScanCacheMaxAgeMs,
} from "~/lib/discovery-cache.server";

describe("buildDiscoveryCacheKey", () => {
  it("includes provider, fingerprint, country, and cursor state", () => {
    const key = buildDiscoveryCacheKey({
      provider: "meta_library_browser",
      fingerprint: "fp-nykaa",
      country: "India",
      cursor: "after:2",
    });

    expect(key).toContain("meta_library_browser");
    expect(key).toContain("fp-nykaa");
    expect(key).toContain("india");
    expect(key).toContain("after:2");
  });
});

describe("resolveDiscoveryCacheTtlMs", () => {
  it("uses shorter TTLs for public search than watchlist scans", () => {
    expect(resolveDiscoveryCacheTtlMs("public_search")).toBe(15 * 60 * 1000);
    expect(resolveDiscoveryCacheTtlMs("watchlist_scan")).toBe(24 * 60 * 60 * 1000);
    expect(resolveDiscoveryCacheTtlMs("scheduled_warmup")).toBe(24 * 60 * 60 * 1000);
  });
});

describe("resolveScheduledScanCacheMaxAgeMs", () => {
  it("maps plan cadences to shared reuse windows", () => {
    expect(resolveScheduledScanCacheMaxAgeMs("every_3h")).toBe(3 * 60 * 60 * 1000);
    expect(resolveScheduledScanCacheMaxAgeMs("every_6h")).toBe(6 * 60 * 60 * 1000);
    expect(resolveScheduledScanCacheMaxAgeMs("none")).toBeNull();
  });
});

describe("isDiscoveryCacheWithinMaxAge", () => {
  it("accepts entries fetched within the cadence window only", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    const within3h = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const outside3h = new Date(now - 4 * 60 * 60 * 1000).toISOString();

    expect(isDiscoveryCacheWithinMaxAge(within3h, 3 * 60 * 60 * 1000, now)).toBe(true);
    expect(isDiscoveryCacheWithinMaxAge(outside3h, 3 * 60 * 60 * 1000, now)).toBe(false);
    expect(isDiscoveryCacheWithinMaxAge("not-a-date", 3 * 60 * 60 * 1000, now)).toBe(false);
    expect(isDiscoveryCacheWithinMaxAge(within3h, 0, now)).toBe(false);
  });
});

describe("isStaleZeroResultDiscoveryCacheEntry (broken-advertiser-filter cutoff)", () => {
  const cutoffMs = Date.parse(STALE_ZERO_RESULT_CUTOFF);
  const beforeCutoff = new Date(cutoffMs - 60 * 60 * 1000).toISOString();
  const afterCutoff = new Date(cutoffMs + 60 * 60 * 1000).toISOString();

  it("expires a zero-result entry scraped before the cutoff (forces a fresh scrape)", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: beforeCutoff }),
    ).toBe(true);
  });

  it("honors a zero-result entry scraped at or after the cutoff", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: afterCutoff }),
    ).toBe(false);
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: STALE_ZERO_RESULT_CUTOFF }),
    ).toBe(false);
  });

  it("honors a non-zero-result entry scraped before the cutoff (never affected)", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 5, fetchedAt: beforeCutoff }),
    ).toBe(false);
  });

  it("does not special-case entries with an unparseable timestamp", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: "not-a-date" }),
    ).toBe(false);
  });
});

describe("isDiscoveryCacheRouteCompatible (FIX-1)", () => {
  it("keeps scheduled scans off public_search deep entries", () => {
    expect(isDiscoveryCacheRouteCompatible("watchlist_scan", "public_search")).toBe(false);
    expect(isDiscoveryCacheRouteCompatible("watchlist_scan", "watchlist_scan")).toBe(true);
    expect(isDiscoveryCacheRouteCompatible("watchlist_scan", "scheduled_warmup")).toBe(true);
    expect(isDiscoveryCacheRouteCompatible("scheduled_warmup", "watchlist_scan")).toBe(true);
  });

  it("keeps interactive search off shallow scan/warmup entries", () => {
    expect(isDiscoveryCacheRouteCompatible("public_search", "watchlist_scan")).toBe(false);
    expect(isDiscoveryCacheRouteCompatible("public_search", "scheduled_warmup")).toBe(false);
    expect(isDiscoveryCacheRouteCompatible("public_search", "public_search")).toBe(true);
  });
});
