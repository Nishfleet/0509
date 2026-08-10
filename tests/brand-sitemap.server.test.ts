import { describe, expect, it, vi } from "vitest";

import { loadIndexableBrandPageDomains } from "~/lib/brand-page.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

function payloadJson(
  overrides: Partial<{ ads: unknown[]; source: string; provider: string }> = {},
) {
  return JSON.stringify({
    ads: [{ metaAdId: "meta-1", advertiser: "Brand", source: "meta_library_browser" }],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    ...overrides,
  });
}

/** A qualifying row exactly as the /ads loader would read it (v2 domain key). */
function qualifyingRow(overrides: Partial<{ cacheKey: string; fetchedAt: string; payloadJson: string }> = {}) {
  return {
    cache_key:
      overrides.cacheKey ?? "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
    payload_json: overrides.payloadJson ?? payloadJson(),
    fetched_at: overrides.fetchedAt ?? isoAgo(2 * DAY_MS),
  };
}

interface FakeDbResult {
  env: { DB: { prepare: ReturnType<typeof vi.fn> } };
  boundArgs: () => unknown[];
}

function fakeDb(rows: Array<ReturnType<typeof qualifyingRow>>): FakeDbResult {
  let boundArgs: unknown[] = [];
  const prepare = vi.fn(() => ({
    bind: (...args: unknown[]) => {
      boundArgs = args;
      return {
        all: vi.fn(async () => ({ results: rows })),
      };
    },
  }));
  return {
    env: { DB: { prepare } },
    boundArgs: () => boundArgs,
  };
}

vi.mock("~/lib/ad-source.server", () => ({
  resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
}));

describe("loadIndexableBrandPageDomains", () => {
  it("publishes domains with a loader-readable, indexable cache row", async () => {
    const { env, boundArgs } = fakeDb([qualifyingRow()]);

    const domains = await loadIndexableBrandPageDomains(env as never);

    expect(domains).toEqual(["nykaa.com"]);
    // The read is bounded to the 7-day indexing window and a row cap.
    expect(boundArgs()).toHaveLength(2);
    expect(env.DB.prepare).toHaveBeenCalledTimes(1);
  });

  it("deduplicates domains across countries and sorts the result", async () => {
    const { env } = fakeDb([
      qualifyingRow({ cacheKey: "search-v2:domain:meesho.com:exact:meta_library_browser:all:page-1" }),
      qualifyingRow({ cacheKey: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1" }),
      qualifyingRow({ cacheKey: "search-v2:domain:nykaa.com:exact:meta_library_browser:india:page-1" }),
    ]);

    const domains = await loadIndexableBrandPageDomains(env as never);

    expect(domains).toEqual(["meesho.com", "nykaa.com"]);
  });

  it("never sitemaps rows the /ads loader would not read", async () => {
    const { env } = fakeDb([
      // Legacy fingerprint keys carry no domain — excluded.
      qualifyingRow({ cacheKey: "meta_library_browser:fnv1a-abc:all:page-1" }),
      // Broader-scope searches are never read by the loader — excluded.
      qualifyingRow({ cacheKey: "search-v2:domain:amazon.in:broader:meta_library_browser:all:page-1" }),
      // Rows written under another provider are never read — excluded.
      qualifyingRow({ cacheKey: "search-v2:domain:flipkart.com:exact:meta_api:all:page-1" }),
      // Follow-up pages are never read (loader only asks for page-1) — excluded.
      qualifyingRow({ cacheKey: "search-v2:domain:myntra.com:exact:meta_library_browser:all:page-2" }),
      // Customer-scoped rows are never read by the public page — excluded.
      qualifyingRow({
        cacheKey:
          "search-v2:domain:ajio.com:exact:meta_library_browser:all:page-1:customer_meta:abc123",
      }),
      // Keys that are not valid /ads/:domain params — excluded.
      qualifyingRow({ cacheKey: "search-v2:domain:not a domain!:exact:meta_library_browser:all:page-1" }),
    ]);

    const domains = await loadIndexableBrandPageDomains(env as never);

    expect(domains).toEqual([]);
  });

  it("excludes rows that would render a noindex state", async () => {
    const { env } = fakeDb([
      // Older than the 7-day indexing window.
      qualifyingRow({ fetchedAt: isoAgo(8 * DAY_MS) }),
      // Demo-sourced payload.
      qualifyingRow({
        cacheKey: "search-v2:domain:demo-brand.com:exact:meta_library_browser:all:page-1",
        payloadJson: payloadJson({ source: "demo", provider: "demo" }),
      }),
      // No real ads.
      qualifyingRow({
        cacheKey: "search-v2:domain:empty-brand.com:exact:meta_library_browser:all:page-1",
        payloadJson: payloadJson({ ads: [] }),
      }),
      // Only demo creatives.
      qualifyingRow({
        cacheKey: "search-v2:domain:demo-ads.com:exact:meta_library_browser:all:page-1",
        payloadJson: payloadJson({
          ads: [{ metaAdId: "demo-1", source: "demo" }],
        }),
      }),
      // Unparsable payload.
      qualifyingRow({
        cacheKey: "search-v2:domain:corrupt.com:exact:meta_library_browser:all:page-1",
        payloadJson: "{not-json",
      }),
    ]);

    const domains = await loadIndexableBrandPageDomains(env as never);

    expect(domains).toEqual([]);
  });

  it("accepts rows from any country a visitor could land on", async () => {
    const { env } = fakeDb([
      qualifyingRow({ cacheKey: "search-v2:domain:india-brand.com:exact:meta_library_browser:india:page-1" }),
    ]);

    const domains = await loadIndexableBrandPageDomains(env as never);

    expect(domains).toEqual(["india-brand.com"]);
  });

  it("returns an empty list without a D1 binding or with a demo provider", async () => {
    expect(await loadIndexableBrandPageDomains({} as never)).toEqual([]);

    vi.mocked(
      (await import("~/lib/ad-source.server")).resolveCommercialDiscoveryProvider,
    ).mockReturnValueOnce("demo");
    expect(await loadIndexableBrandPageDomains({ DB: {} } as never)).toEqual([]);
  });

  it("degrades to an empty list when the cache read fails", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn(async () => {
              throw new Error("no such table: discovery_cache_entry");
            }),
          })),
        })),
      },
    };

    expect(await loadIndexableBrandPageDomains(env as never)).toEqual([]);
  });
});
