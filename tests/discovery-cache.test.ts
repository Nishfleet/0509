import { describe, expect, it } from "vitest";

import {
  buildDiscoveryCacheKey,
  resolveDiscoveryCacheTtlMs,
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
  });
});
