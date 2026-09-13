import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import { googleAdsAdapter } from "~/lib/sources/google-ads.server";
import { getSourceAdapter } from "~/lib/sources/registry.server";

/**
 * Adapter identity for the Google Ads source — issue #2189.
 *
 * The generic seam tests (tests/presence-source-coverage.test.ts) DERIVE
 * "configured" from `implemented` + `requiresEnv(env)` and quietly
 * reclassify the adapter instead of failing if `implemented` flips back to
 * false. These assertions live with the source, so a flip fails here. Shape
 * mirrors tests/sources/subdomains-adapter.test.ts.
 */

// The #3197 behavior tests import the real usage module and drive it through
// an in-memory KV double, so the /status capture-failure rate's numbers come
// from the same code path production uses. Only the module boundaries that
// need network/DB are overridden, and each mock spreads the original so other
// exports keep working.
vi.mock("~/lib/sources/google-ads/google-ads-transparency.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/sources/google-ads/google-ads-transparency.server")
  >()),
  fetchCreativesByDomain: vi.fn(),
}));
vi.mock("~/lib/data/watchlists-core.server", async (importOriginal) => ({
  ...(await importOriginal()),
  getWatchlist: vi.fn().mockResolvedValue({ targetId: "https://www.nike.com" }),
}));
vi.mock("~/lib/weekly-public-moves.server", async (importOriginal) => ({
  ...(await importOriginal()),
  domainFromWatchlistTargetId: () => "nike.com",
}));

/** Minimal in-memory KVNamespace stub — same shape as the #2181 test's. */
function makeKv() {
  const store = new Map<string, { value: string; expirationTtl?: number }>();
  return {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: options?.expirationTtl });
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

const COMPETITOR = { competitorId: "wl-nike", competitorLabel: "Nike" };

const FIXTURE_CREATIVES = [
  {
    advertiserId: "AR1",
    advertiserName: "Nike",
    creativeId: "CR1",
    format: "image" as const,
    domain: "nike.com",
    firstShownAt: "2026-08-15T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    lastShownAt: "2026-09-01T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    previewUrl: "https://example.com/preview.png",
  },
];

async function mockFetchCreatives(
  result:
    | { creatives: typeof FIXTURE_CREATIVES; truncated: boolean }
    | { unavailable: true; reason: string },
): Promise<void> {
  const { fetchCreativesByDomain } = await import(
    "~/lib/sources/google-ads/google-ads-transparency.server"
  );
  vi.mocked(fetchCreativesByDomain).mockResolvedValueOnce(result);
}

describe("googleAdsAdapter", () => {
  it("exports the id, label, implemented flag and requiresEnv the coverage rule depends on", () => {
    expect(googleAdsAdapter.id).toBe("google_ads");
    expect(googleAdsAdapter.label).toBe("Google Ads (Transparency Center)");
    expect(googleAdsAdapter.implemented).toBe(true);
    // No credentials: requiresEnv is true at the production posture (flag
    // unset or "0"), so coverage resolves to "configured" without any other
    // env var present.
    expect(googleAdsAdapter.requiresEnv({})).toBe(true);
  });

  it("is the adapter the registry resolves for google_ads", () => {
    expect(getSourceAdapter("google_ads")).toBe(googleAdsAdapter);
  });
});

describe("googleAdsAdapter — #3197 kill flag", () => {
  it("stays on for the production posture (unset, 0, blank)", () => {
    expect(googleAdsAdapter.requiresEnv({})).toBe(true);
    expect(googleAdsAdapter.requiresEnv({ GOOGLE_ADS_SOURCE_DISABLED: "0" })).toBe(true);
    expect(googleAdsAdapter.requiresEnv({ GOOGLE_ADS_SOURCE_DISABLED: "" })).toBe(true);
  });

  it("reports killed for 1 / true / yes / on", () => {
    expect(googleAdsAdapter.requiresEnv({ GOOGLE_ADS_SOURCE_DISABLED: "1" })).toBe(false);
    expect(googleAdsAdapter.requiresEnv({ GOOGLE_ADS_SOURCE_DISABLED: "true" })).toBe(false);
    expect(googleAdsAdapter.requiresEnv({ GOOGLE_ADS_SOURCE_DISABLED: "yes" })).toBe(false);
    expect(googleAdsAdapter.requiresEnv({ GOOGLE_ADS_SOURCE_DISABLED: "on" })).toBe(false);
  });

  it("drops the source from the scheduled-run path when killed (registry env filter)", async () => {
    const { getEnabledSources } = await import("~/lib/sources/registry.server");
    // plan "scout" grants all sources (free grants meta only), so what changes
    // between these two calls is exactly the #3197 kill flag.
    const enabled = getEnabledSources(
      { GOOGLE_ADS_SOURCE_DISABLED: "0" } as AppEnv,
      "scout",
    );
    const killed = getEnabledSources(
      { GOOGLE_ADS_SOURCE_DISABLED: "1" } as AppEnv,
      "scout",
    );
    expect(getEnabledSources({} as AppEnv, "scout").some((a) => a.id === "google_ads")).toBe(true);
    expect(getEnabledSources(enabled, "scout").some((a) => a.id === "google_ads")).toBe(true);
    expect(killed.some((a) => a.id === "google_ads")).toBe(false);
  });

  it("resolves the coverage policy accordingly: configured when on, coming_soon when killed", async () => {
    const { evaluatePresenceSourceCoverage } = await import(
      "~/lib/presence-source-coverage.server"
    );
    const enabled = await evaluatePresenceSourceCoverage({} as AppEnv, "google_ads", "competitor");
    expect(enabled.status).toBe("configured");
    expect(enabled.coverageLabel).toBe("OFFICIAL_PUBLIC_API");
    expect(enabled.reasonCode).toBeNull();

    const killed = await evaluatePresenceSourceCoverage(
      { GOOGLE_ADS_SOURCE_DISABLED: "1" } as AppEnv,
      "google_ads",
      "competitor",
    );
    expect(killed.status).toBe("coming_soon");
    expect(killed.coverageLabel).toBe("UNAVAILABLE");
  });

  it("keeps the docs coverage table honest: active, flag posture and coverage facts", async () => {
    const { presenceSourceCoverageForDocs } = await import(
      "~/lib/presence-source-coverage.server"
    );
    const row = presenceSourceCoverageForDocs().find((entry) => entry.sourceId === "google_ads");
    expect(row?.productionStatus).toBe("active");
    expect(row?.notes).toContain("GOOGLE_ADS_SOURCE_DISABLED=1");
    expect(row?.notes).toContain("no official-API key");
    expect(row?.notes).toContain("no country filter is pinned");
    expect(row?.notes).toContain("capture-failure rate");
  });
});

describe("googleAdsAdapter.fetch — counted attempts (#3197)", () => {
  it("counts a successful capture and returns its payload (>=1 creative for the fixture domain)", async () => {
    const kv = makeKv();
    await mockFetchCreatives({ creatives: FIXTURE_CREATIVES, truncated: false });
    const { googleAdsAdapter } = await import("~/lib/sources/google-ads.server");
    const { getGoogleAdsCaptureStats24h } = await import(
      "~/lib/sources/google-ads/google-ads-usage.server"
    );

    const result = await googleAdsAdapter.fetch({ DECODO_BUDGET: kv } as AppEnv, COMPETITOR);

    expect("unavailable" in result).toBe(false);
    const payload = (result as { payload: { creatives: unknown[] } }).payload;
    expect(payload.creatives.length).toBeGreaterThanOrEqual(1);

    const stats = await getGoogleAdsCaptureStats24h({ DECODO_BUDGET: kv } as AppEnv);
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.rate).toBe(0);
  });

  it("counts a failed capture and returns unavailable before anything is diffed (#2873 posture)", async () => {
    const kv = makeKv();
    await mockFetchCreatives({ unavailable: true, reason: "http_503" });
    const { googleAdsAdapter } = await import("~/lib/sources/google-ads.server");
    const { getGoogleAdsCaptureStats24h } = await import(
      "~/lib/sources/google-ads/google-ads-usage.server"
    );

    const result = await googleAdsAdapter.fetch({ DECODO_BUDGET: kv } as AppEnv, COMPETITOR);

    expect(result).toEqual({ unavailable: true, reason: "http_503" });

    const stats = await getGoogleAdsCaptureStats24h({ DECODO_BUDGET: kv } as AppEnv);
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.rate).toBe(1);
  });

  it("still returns the capture result when no KV binding is wired (counter no-ops)", async () => {
    await mockFetchCreatives({ unavailable: true, reason: "fetch_error" });
    const { googleAdsAdapter } = await import("~/lib/sources/google-ads.server");

    const result = await googleAdsAdapter.fetch({} as AppEnv, COMPETITOR);
    expect(result).toEqual({ unavailable: true, reason: "fetch_error" });
  });
});
