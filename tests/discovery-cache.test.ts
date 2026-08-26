import { describe, expect, it, vi } from "vitest";

import {
  DISCOVERY_ADVERTISER_FILTER_EPOCH,
  toServableDiscoveryPayload,
  buildDiscoveryCacheKey,
  isDiscoveryCacheRouteCompatible,
  isDiscoveryCacheWithinMaxAge,
  isPublicSearchFamily,
  isStaleZeroResultDiscoveryCacheEntry,
  resolveDiscoveryCacheTtlMs,
  resolveScheduledScanCacheMaxAgeMs,
  toPersistedDiscoveryRouteContext,
  toTelemetryRouteContext,
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
    expect(resolveDiscoveryCacheTtlMs("public_search_warmup")).toBe(24 * 60 * 60 * 1000);
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

describe("isStaleZeroResultDiscoveryCacheEntry (advertiser-filter contract epoch)", () => {
  it("rejects an advertiser-mode zero without the current epoch — no matter how recent", () => {
    // The blocker scenario a timestamp cutoff can never close: a version-pinned
    // Workflow instance running the BROKEN filter may sleep/retry indefinitely
    // and write its wrong zero at ANY later wall-clock time. Writer version is
    // proven by the epoch stamp, never inferred from fetchedAt — so an
    // unstamped zero is rejected even if written "after noon" (or next week).
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, mode: "advertiser", filterEpoch: null }),
    ).toBe(true);
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, mode: "advertiser", filterEpoch: undefined }),
    ).toBe(true);
  });

  it("rejects a domain-mode zero carrying an OLD epoch", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({
        adCount: 0,
        mode: "domain",
        filterEpoch: "advertiser-evidence-filter-v0",
      }),
    ).toBe(true);
  });

  it("accepts an advertiser-mode zero stamped with the current epoch", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({
        adCount: 0,
        mode: "advertiser",
        filterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
      }),
    ).toBe(false);
  });

  it("never gates a keyword-mode zero (keyword never ran the broken advertiser filter)", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 0, mode: "keyword", filterEpoch: null }),
    ).toBe(false);
  });

  it("never gates a non-zero result (the broken filter could only wrongly empty, never wrongly fill)", () => {
    expect(
      isStaleZeroResultDiscoveryCacheEntry({ adCount: 5, mode: "advertiser", filterEpoch: null }),
    ).toBe(false);
  });

  it("pins the current epoch value", () => {
    expect(DISCOVERY_ADVERTISER_FILTER_EPOCH).toBe("advertiser-evidence-filter-v1");
  });
});

describe("toServableDiscoveryPayload (epoch stays persistence-private)", () => {
  it("strips the writer epoch and preserves everything else", () => {
    const served = toServableDiscoveryPayload({
      ads: [],
      nextCursor: null,
      discoveryEmptyReason: "no_results",
      discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
    });
    expect("discoveryFilterEpoch" in served).toBe(false);
    expect(served).toMatchObject({ ads: [], nextCursor: null, discoveryEmptyReason: "no_results" });
  });

  it("cache-only brand-page reads never expose the epoch", async () => {
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue({
        cacheKey: "meta_library_browser:fp:all:page-1",
        provider: "meta_library_browser",
        routeContext: "public_search",
        payload: {
          ads: [],
          nextCursor: null,
          discoveryEmptyReason: "no_results",
          discoveryFilterEpoch: DISCOVERY_ADVERTISER_FILTER_EPOCH,
        },
        fetchedAt: "2026-07-21T13:00:00.000Z",
        expiresAt: "2026-07-22T13:00:00.000Z",
      }),
    }));
    const { readDiscoveryCacheEntryCacheOnly } = await import("~/lib/discovery-cache.server");
    const entry = await readDiscoveryCacheEntryCacheOnly({ DB: {} } as never, {
      provider: "meta_library_browser",
      fingerprint: "fp",
      country: "all",
    });
    expect(entry).not.toBeNull();
    expect(entry && "discoveryFilterEpoch" in entry.payload).toBe(false);
    vi.doUnmock("~/lib/data.server");
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

  it("lets public search read panel-warmup entries and vice versa", () => {
    expect(isDiscoveryCacheRouteCompatible("public_search", "public_search_warmup")).toBe(true);
    expect(isDiscoveryCacheRouteCompatible("public_search_warmup", "public_search")).toBe(true);
    expect(isDiscoveryCacheRouteCompatible("public_search_warmup", "public_search_warmup")).toBe(true);
    expect(isDiscoveryCacheRouteCompatible("watchlist_scan", "public_search_warmup")).toBe(false);
    expect(isDiscoveryCacheRouteCompatible("public_search_warmup", "scheduled_warmup")).toBe(false);
  });
});

describe("public_search_warmup persist and telemetry mapping", () => {
  it("stores warmup as public_search so D1 CHECKs and readers accept it", () => {
    expect(toPersistedDiscoveryRouteContext("public_search_warmup")).toBe("public_search");
    expect(toPersistedDiscoveryRouteContext("public_search")).toBe("public_search");
    expect(toPersistedDiscoveryRouteContext("scheduled_warmup")).toBe("scheduled_warmup");
  });

  it("records warmup telemetry as scheduled_warmup", () => {
    expect(toTelemetryRouteContext("public_search_warmup")).toBe("scheduled_warmup");
    expect(toTelemetryRouteContext("public_search")).toBe("public_search");
  });

  it("groups public search and panel warmup as one cache family", () => {
    expect(isPublicSearchFamily("public_search")).toBe(true);
    expect(isPublicSearchFamily("public_search_warmup")).toBe(true);
    expect(isPublicSearchFamily("scheduled_warmup")).toBe(false);
  });
});
