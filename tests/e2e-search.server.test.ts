import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "~/lib/env.server";

import {
  resolveE2EFixtureSearchResponse,
  resolveE2ELocalSearchContext,
  resolveE2ELocalSearchEnv,
} from "~/lib/e2e-search.server";

const baseEnv = { E2E_TEST_MODE: "1", SEARCH_ROLLOUT_MODE: "v2" } as AppEnv;

function request(url: string, enabled = true) {
  return new Request(url, {
    headers: enabled
      ? { "x-0509-e2e-test-mode": "1", "x-0509-e2e-search-rollout": "v2" }
      : { "x-0509-e2e-search-rollout": "v2" },
  });
}

describe("local E2E search rollout", () => {
  it("marks an eligible deny-mode request as cache-backed Meta-library fixture traffic", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => ({ enabled: 1 }) }),
      }),
    };
    const context = await resolveE2ELocalSearchContext(
      { ...baseEnv, DB: db as unknown as D1Database, E2E_PROVIDER_NETWORK_DENY: "1" },
      request("http://127.0.0.1:4189/search"),
    );
    expect(context).toMatchObject({ enabled: true, fixtureProvider: "meta_library_browser" });
  });

  it("reads only a fresh, correctly-labelled seeded cache row without invoking external fetch", async () => {
    const delegate = vi.fn();
    const payload = {
      ads: [{ metaAdId: "e2e-nykaa-live-1" }],
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "miss",
    };
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () =>
            sql.includes("discovery_cache_entry")
              ? {
                  provider: "meta_library_browser",
                  payload_json: JSON.stringify(payload),
                  expires_at: new Date(Date.now() + 60_000).toISOString(),
                }
              : { enabled: 1 },
          ),
        })),
      })),
    };

    const result = await resolveE2EFixtureSearchResponse(
      { ...baseEnv, DB: db as unknown as D1Database, E2E_PROVIDER_NETWORK_DENY: "1" },
      request("http://127.0.0.1:4189/search"),
      "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    });
    expect(delegate).not.toHaveBeenCalled();
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("provider = ?"));
  });

  it("preserves an honestly stale fixture result instead of upgrading it to a fresh hit", async () => {
    const payload = {
      ads: [],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoverySummary: "Fresh checks are delayed and no cached results are available.",
      discoveryFailureClass: "timeout",
    };
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () =>
            sql.includes("discovery_cache_entry")
              ? {
                  provider: "meta_library_browser",
                  payload_json: JSON.stringify(payload),
                  expires_at: new Date(Date.now() - 60_000).toISOString(),
                }
              : { enabled: 1 },
          ),
        })),
      })),
    };

    const result = await resolveE2EFixtureSearchResponse(
      { ...baseEnv, DB: db as unknown as D1Database, E2E_PROVIDER_NETWORK_DENY: "1" },
      request("http://127.0.0.1:4189/search"),
      "search-v2:domain:stale.example:exact:meta_library_browser:all:page-1",
    );

    expect(result).toMatchObject({
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "stale",
      discoveryStatus: "cache_only",
      discoveryFailureClass: "timeout",
    });
  });

  it.each([
    ["production host", "https://0509.io/search"],
    ["missing E2E header", "http://127.0.0.1:4189/search"],
  ])("rejects fixture cache resolution for %s", async (_label, url) => {
    const db = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue({ enabled: 1 }) })) })),
    };
    const testRequest = _label === "missing E2E header"
      ? request(url, false)
      : request(url);
    await expect(
      resolveE2EFixtureSearchResponse(
        { ...baseEnv, DB: db as unknown as D1Database, E2E_PROVIDER_NETWORK_DENY: "1" },
        testRequest,
        "cache-key",
      ),
    ).resolves.toBeNull();
  });

  it("uses V2 only for an explicitly marked localhost fixture request", async () => {
    expect((await resolveE2ELocalSearchEnv(baseEnv, request("http://127.0.0.1:4189/search"))).SEARCH_ROLLOUT_MODE).toBe("v2");
    await expect(resolveE2ELocalSearchContext(baseEnv, request("http://127.0.0.1:4189/search"))).resolves.toMatchObject({
      enabled: true,
      env: { SEARCH_ROLLOUT_MODE: "v2" },
    });
  });

  it.each([
    ["production host", request("https://0509.io/search")],
    ["missing request header", request("http://127.0.0.1:4189/search", false)],
  ])("keeps the configured v2 rollout for %s", async (_label, testRequest) => {
    expect((await resolveE2ELocalSearchEnv(baseEnv, testRequest)).SEARCH_ROLLOUT_MODE).toBe("v2");
  });

  it("does not enable fixture search unless the dedicated local rollout flag is exactly v2", async () => {
    expect((await resolveE2ELocalSearchEnv(baseEnv, request("http://127.0.0.1:4189/search"), "shadow")).SEARCH_ROLLOUT_MODE).toBe("v2");
    expect((await resolveE2ELocalSearchContext(baseEnv, request("http://127.0.0.1:4189/search"), "shadow")).enabled).toBe(false);
  });
});
