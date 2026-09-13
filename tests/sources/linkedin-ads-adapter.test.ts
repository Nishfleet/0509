import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import type { SourceSnapshotRecord, SourceSnapshotInput } from "~/lib/sources/types";
import { fetchAdsByAccountOwner, type LinkedInAdCard, type LinkedInAdLibraryFetchResult } from "~/lib/sources/linkedin-ads/linkedin-ad-library.server";

let budgetOk = true;
vi.mock("~/lib/decodo-budget.server", async (importOriginal) => ({
  // Spread the original so the #3196 registry/coverage import-graph (the
  // #2181 seam's other consumers) keeps its exports; only the helper the
  // adapter calls is overridden.
  ...(await importOriginal<typeof import("~/lib/decodo-budget.server")>()),
  reserveDecodoBudget: vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: budgetOk })),
}));

/**
 * Mock the fetch module so the adapter test isolates fetch-gate logic from
 * HTML parsing (covered in the fetch-module test file). `fetchResult` is the
 * value the mocked fetchAdsByAccountOwner returns.
 */
let fetchResult: LinkedInAdLibraryFetchResult = { unavailable: true, reason: "no_credentials" };
vi.mock("~/lib/sources/linkedin-ads/linkedin-ad-library.server", async (importOriginal) => ({
  // Spread the original so type-adjacent exports keep working; the mocked
  // fetch is the one network boundary these tests control.
  ...(await importOriginal<
    typeof import("~/lib/sources/linkedin-ads/linkedin-ad-library.server")
  >()),
  fetchAdsByAccountOwner: vi.fn(async (): Promise<LinkedInAdLibraryFetchResult> => fetchResult),
}));

// Imported after the mocks are registered.
const { linkedinAdsAdapter } = await import("~/lib/sources/linkedin-ads.server");

const envWithAuth = {
  DECODO_SCRAPER_AUTH: "dXNlcjpwYXNz",
} satisfies Partial<AppEnv> as AppEnv;

function ad(id: string, text: string, advertiser = "Notion"): LinkedInAdCard {
  return {
    id,
    advertiser,
    text,
    creativeImageUrl: `https://media.licdn.com/dms/image/ad${id}/creative`,
    detailUrl: `https://www.linkedin.com/ad-library/detail/${id}`,
  };
}

function snapshotPayload(ads: LinkedInAdCard[], accountOwner = "Notion"): SourceSnapshotInput {
  return { payload: { accountOwner, totalAds: ads.length, ambiguous: false, ads } };
}

function snapshotRecord(ads: LinkedInAdCard[], accountOwner = "Notion"): SourceSnapshotRecord {
  return {
    id: "snap-1",
    watchlistId: "wl-1",
    sourceId: "linkedin",
    fetchedAt: "2026-09-09T00:00:00Z",
    createdAt: "2026-09-09T00:00:00Z",
    payload: { accountOwner, totalAds: ads.length, ambiguous: false, ads },
  };
}

describe("linkedinAdsAdapter — contract", () => {
  it("is implemented, weekly, ads, and gated on DECODO_SCRAPER_AUTH", () => {
    expect(linkedinAdsAdapter.id).toBe("linkedin");
    expect(linkedinAdsAdapter.implemented).toBe(true);
    expect(linkedinAdsAdapter.cadence).toBe("weekly");
    expect(linkedinAdsAdapter.kind).toBe("ads");
    expect(linkedinAdsAdapter.requiresEnv(envWithAuth)).toBe(true);
    expect(linkedinAdsAdapter.requiresEnv({} as AppEnv)).toBe(false);
  });
});

describe("linkedinAdsAdapter.fetch", () => {
  beforeEach(() => {
    budgetOk = true;
    fetchResult = { unavailable: true, reason: "no_credentials" };
    vi.mocked(fetchAdsByAccountOwner).mockClear();
  });

  it("returns unavailable quota when the Decodo budget denies", async () => {
    budgetOk = false;
    const result = await linkedinAdsAdapter.fetch(envWithAuth, {
      competitorId: "wl-1",
      competitorLabel: "Notion",
    });
    expect(result).toEqual({ unavailable: true, reason: "quota" });
    // The budget check runs BEFORE the request: a deny must not scrape.
    expect(vi.mocked(fetchAdsByAccountOwner)).not.toHaveBeenCalled();
  });

  it("passes the competitor label through as the account owner", async () => {
    fetchResult = {
      accountOwner: "Notion",
      totalAds: 1,
      ambiguous: false,
      ads: [ad("1001", "hello")],
    };
    const result = await linkedinAdsAdapter.fetch(envWithAuth, {
      competitorId: "wl-1",
      competitorLabel: "Notion",
    });
    expect("unavailable" in result).toBe(false);
    const payload = (result as SourceSnapshotInput).payload as { ads: LinkedInAdCard[]; totalAds: number };
    expect(payload.totalAds).toBe(1);
    expect(payload.ads).toHaveLength(1);
    expect(payload.ads[0]!.id).toBe("1001");
    // Account owner = the tracked competitor's display name, page 1, maxAds 25.
    expect(vi.mocked(fetchAdsByAccountOwner)).toHaveBeenCalledWith(envWithAuth, "Notion", {
      maxAds: 25,
    });
  });

  it("propagates unavailable from the fetch module (e.g. 613)", async () => {
    fetchResult = { unavailable: true, reason: "decodo_status_613" };
    const result = await linkedinAdsAdapter.fetch(envWithAuth, {
      competitorId: "wl-1",
      competitorLabel: "Notion",
    });
    expect(result).toEqual({ unavailable: true, reason: "decodo_status_613" });
  });
});

describe("linkedinAdsAdapter.diff", () => {
  it("emits ad_new for every ad when there is no previous snapshot", () => {
    const next = snapshotPayload([ad("1001", "a"), ad("1002", "b")]);
    const changes = linkedinAdsAdapter.diff(null, next);
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.eventType === "ad_new")).toBe(true);
    expect(changes.map((c) => c.metadata).map((m) => (m as { adId: string }).adId).sort()).toEqual(["1001", "1002"]);
  });

  it("emits ad_new for ids only in the next snapshot", () => {
    const prev = snapshotRecord([ad("1001", "a"), ad("1002", "b")]);
    const next = snapshotPayload([ad("1001", "a"), ad("1003", "c")]);
    const changes = linkedinAdsAdapter.diff(prev, next);
    const newChanges = changes.filter((c) => c.eventType === "ad_new");
    expect(newChanges).toHaveLength(1);
    expect((newChanges[0]!.metadata as { adId: string }).adId).toBe("1003");
  });

  it("emits ad_inactive for ids only in the previous snapshot", () => {
    const prev = snapshotRecord([ad("1001", "a"), ad("1002", "b")]);
    const next = snapshotPayload([ad("1001", "a")]);
    const changes = linkedinAdsAdapter.diff(prev, next);
    const gone = changes.filter((c) => c.eventType === "ad_inactive");
    expect(gone).toHaveLength(1);
    expect((gone[0]!.metadata as { adId: string }).adId).toBe("1002");
  });

  it("emits landing_page_headline_changed when copy changes on the same id", () => {
    const prev = snapshotRecord([ad("1001", "old copy")]);
    const next = snapshotPayload([ad("1001", "new copy")]);
    const changes = linkedinAdsAdapter.diff(prev, next);
    const copy = changes.filter((c) => c.eventType === "landing_page_headline_changed");
    expect(copy).toHaveLength(1);
    expect((copy[0]!.metadata as { before: string }).before).toBe("old copy");
    expect((copy[0]!.metadata as { after: string }).after).toBe("new copy");
  });

  it("emits no changes when the snapshots are identical", () => {
    const prev = snapshotRecord([ad("1001", "same"), ad("1002", "same2")]);
    const next = snapshotPayload([ad("1001", "same"), ad("1002", "same2")]);
    expect(linkedinAdsAdapter.diff(prev, next)).toEqual([]);
  });

  it("handles all three diff cases together", () => {
    const prev = snapshotRecord([ad("1001", "kept"), ad("1002", "gone"), ad("1003", "old text")]);
    const next = snapshotPayload([ad("1001", "kept"), ad("1003", "new text"), ad("1004", "brand new")]);
    const changes = linkedinAdsAdapter.diff(prev, next);
    const byType = {
      ad_new: changes.filter((c) => c.eventType === "ad_new").map((c) => (c.metadata as { adId: string }).adId),
      ad_inactive: changes.filter((c) => c.eventType === "ad_inactive").map((c) => (c.metadata as { adId: string }).adId),
      copy: changes.filter((c) => c.eventType === "landing_page_headline_changed").map((c) => (c.metadata as { adId: string }).adId),
    };
    expect(byType.ad_new).toEqual(["1004"]);
    expect(byType.ad_inactive).toEqual(["1002"]);
    expect(byType.copy).toEqual(["1003"]);
  });
});

describe("linkedinAdsAdapter — #3196 kill flag", () => {
  it("stays on for the production posture when the #2193 credential is present (unset, 0, blank)", () => {
    expect(linkedinAdsAdapter.requiresEnv(envWithAuth)).toBe(true);
    expect(
      linkedinAdsAdapter.requiresEnv({ ...envWithAuth, LINKEDIN_ADS_SOURCE_DISABLED: "0" } as AppEnv),
    ).toBe(true);
    expect(
      linkedinAdsAdapter.requiresEnv({ ...envWithAuth, LINKEDIN_ADS_SOURCE_DISABLED: "" } as AppEnv),
    ).toBe(true);
  });

  it("reports killed for 1 / true / yes / on (credential still present)", () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(
        linkedinAdsAdapter.requiresEnv({ ...envWithAuth, LINKEDIN_ADS_SOURCE_DISABLED: value } as AppEnv),
      ).toBe(false);
    }
  });

  it("still requires the #2193 credential: without DECODO_SCRAPER_AUTH the source is off either way", () => {
    expect(linkedinAdsAdapter.requiresEnv({} as AppEnv)).toBe(false);
    expect(linkedinAdsAdapter.requiresEnv({ LINKEDIN_ADS_SOURCE_DISABLED: "0" } as AppEnv)).toBe(false);
  });

  it("drops the source from the scheduled-run path when killed (registry env filter)", async () => {
    const { getEnabledSources } = await import("~/lib/sources/registry.server");
    // scout grants all sources, so what changes between these two calls is
    // exactly the #3196 kill flag (the #2193 credential stays present).
    const enabled = getEnabledSources(
      { DECODO_SCRAPER_AUTH: "dXNlcjpwYXNz", LINKEDIN_ADS_SOURCE_DISABLED: "0" } as AppEnv,
      "scout",
    );
    const killed = getEnabledSources(
      { DECODO_SCRAPER_AUTH: "dXNlcjpwYXNz", LINKEDIN_ADS_SOURCE_DISABLED: "1" } as AppEnv,
      "scout",
    );
    expect(enabled.some((a) => a.id === "linkedin")).toBe(true);
    expect(killed.some((a) => a.id === "linkedin")).toBe(false);
  });

  it("keeps the docs coverage row honest: the connector posture plus the #3196 ads facts", async () => {
    const { presenceSourceCoverageForDocs } = await import(
      "~/lib/presence-source-coverage.server"
    );
    const row = presenceSourceCoverageForDocs().find((entry) => entry.sourceId === "linkedin");
    // The row's posture is the PRESENCE connector's (PRESENCE_LINKEDIN_ROLLOUT
    // gates it; #3196 does not flip it) — the #3196 ads facts ride the notes.
    expect(row?.productionStatus).toBe("gated");
    expect(row?.notes).toContain("LINKEDIN_ADS_SOURCE_DISABLED=1");
    expect(row?.notes).toContain("public LinkedIn Ad Library");
    expect(row?.notes).toContain("United States");
    expect(row?.notes).toContain("capture-failure rate");
  });
});

describe("linkedinAdsAdapter.fetch — counted attempts (#3196)", () => {
  /** The e2e fixture watchlist's tracked brand (e2e-watchlist-firstbrief). */
  const COMPETITOR = { competitorId: "e2e-watchlist-firstbrief", competitorLabel: "Rival Labs" };

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

  function fixtureAds(): LinkedInAdLibraryFetchResult {
    return {
      accountOwner: "Rival Labs",
      totalAds: 2,
      ambiguous: false,
      ads: [
        {
          id: "411191001",
          advertiser: "Rival Labs",
          text: "Rival Labs launches warm-handoff tracking for revenue teams.",
          creativeImageUrl: "https://media.licdn.com/dms/image/411191001/creative",
          detailUrl: "https://www.linkedin.com/ad-library/detail/411191001",
        },
        {
          id: "411191002",
          advertiser: "Rival Labs",
          text: "See every competitor motion the week it happens.",
          creativeImageUrl: null,
          detailUrl: "https://www.linkedin.com/ad-library/detail/411191002",
        },
      ],
    };
  }

  beforeEach(() => {
    budgetOk = true;
    vi.mocked(fetchAdsByAccountOwner).mockClear();
  });

  it("counts a successful capture and returns its payload (>=1 LinkedIn ad for the e2e fixture watchlist's tracked brand)", async () => {
    const kv = makeKv();
    fetchResult = fixtureAds();
    const { getLinkedInAdsCaptureStats24h } = await import(
      "~/lib/sources/linkedin-ads/linkedin-ads-usage.server"
    );

    const result = await linkedinAdsAdapter.fetch(
      { ...envWithAuth, DECODO_BUDGET: kv } as AppEnv,
      { competitorId: "e2e-watchlist-firstbrief", competitorLabel: "Rival Labs" },
    );

    expect("unavailable" in result).toBe(false);
    const payload = (result as { payload: { ads: unknown[] } }).payload;
    expect(payload.ads.length).toBeGreaterThanOrEqual(1);

    const stats = await getLinkedInAdsCaptureStats24h({ DECODO_BUDGET: kv } as AppEnv);
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.rate).toBe(0);
  });

  it("counts a failed capture and returns unavailable before anything is diffed (#2873 posture)", async () => {
    const kv = makeKv();
    fetchResult = { unavailable: true, reason: "decodo_status_613" };
    const { getLinkedInAdsCaptureStats24h } = await import(
      "~/lib/sources/linkedin-ads/linkedin-ads-usage.server"
    );

    const result = await linkedinAdsAdapter.fetch(
      { ...envWithAuth, DECODO_BUDGET: kv } as AppEnv,
      { competitorId: "e2e-watchlist-firstbrief", competitorLabel: "Rival Labs" },
    );

    expect(result).toEqual({ unavailable: true, reason: "decodo_status_613" });

    const stats = await getLinkedInAdsCaptureStats24h({ DECODO_BUDGET: kv } as AppEnv);
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.rate).toBe(1);
  });

  it("still returns the capture result when no KV binding is wired (counter no-ops)", async () => {
    fetchResult = fixtureAds();
    const result = await linkedinAdsAdapter.fetch(envWithAuth, {
      competitorId: "e2e-watchlist-firstbrief",
      competitorLabel: "Rival Labs",
    });

    expect("unavailable" in result).toBe(false);
  });

  it("does not count the #2193 quota-deny: it returns before any Library read", async () => {
    const kv = makeKv();
    budgetOk = false;
    fetchResult = fixtureAds(); // would succeed — proves the deny precedes the read
    const { getLinkedInAdsCaptureStats24h } = await import(
      "~/lib/sources/linkedin-ads/linkedin-ads-usage.server"
    );

    const result = await linkedinAdsAdapter.fetch(
      { ...envWithAuth, DECODO_BUDGET: kv } as AppEnv,
      { competitorId: "e2e-watchlist-firstbrief", competitorLabel: "Rival Labs" },
    );

    expect(result).toEqual({ unavailable: true, reason: "quota" });

    const stats = await getLinkedInAdsCaptureStats24h({ DECODO_BUDGET: kv } as AppEnv);
    expect(stats.counted).toBe(true);
    expect(stats.attempted).toBe(0);
    expect(stats.rate).toBeNull();
  });
});
