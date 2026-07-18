import { describe, expect, it } from "vitest";

import {
  buildDiscoveryCacheKey,
  isDiscoveryCacheWithinMaxAge,
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
