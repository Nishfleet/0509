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

  it("expires an advertiser-mode zero-result entry scraped before the cutoff (forces a fresh scrape)", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: beforeCutoff, mode: "advertiser" }),
    ).toBe(true);
  });

  it("expires a domain-mode zero-result entry scraped before the cutoff", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: beforeCutoff, mode: "domain" }),
    ).toBe(true);
  });

  it("never expires a keyword-mode zero (keyword never ran the broken advertiser filter)", () => {
    // PR #376's broken filter did not affect keyword search — keyword zeros must
    // be honored regardless of when they were scraped.
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: beforeCutoff, mode: "keyword" }),
    ).toBe(false);
  });

  it("honors an advertiser-mode zero-result entry scraped at or after the cutoff", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: afterCutoff, mode: "advertiser" }),
    ).toBe(false);
    expect(
      isStaleZeroResultDiscoveryCacheEntry({
        adCount: 0,
        fetchedAt: STALE_ZERO_RESULT_CUTOFF,
        mode: "advertiser",
      }),
    ).toBe(false);
  });

  it("honors a non-zero-result advertiser entry scraped before the cutoff (never affected)", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 5, fetchedAt: beforeCutoff, mode: "advertiser" }),
    ).toBe(false);
  });

  it("does not special-case entries with an unparseable timestamp", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, fetchedAt: "not-a-date", mode: "advertiser" }),
    ).toBe(false);
  });

  it("expires a zero written during the old-worker drain window (post-flip, pre-cutoff)", () => {
    // Blocker scenario: a request served by the BROKEN worker (in-flight at the
    // 08:14:30Z alias flip, or a version-pinned Workflow instance) finishes
    // later and writes its zero with a post-flip fetchedAt. That write must
    // still be treated as stale.
    expect(
      isStaleZeroResultDiscoveryCacheEntry({
        adCount: 0,
        fetchedAt: "2026-07-21T08:30:00.000Z",
        mode: "advertiser",
      }),
    ).toBe(true);
  });

  it("pins the cutoff past the maximum old-worker drain window (12:00:00Z)", () => {
    // The alias flip (08:14:30Z, run 29812131936) is not enough: in-flight
    // requests and version-pinned Workflow scan instances started on the broken
    // worker can WRITE zero-result entries with a post-flip fetchedAt. The
    // cutoff must sit hours past the flip so no broken-worker write survives.
    expect(STALE_ZERO_RESULT_CUTOFF).toBe("2026-07-21T12:00:00.000Z");
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
