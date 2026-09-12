import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import type { TiktokAd } from "~/lib/sources/tiktok-ads/tiktok-ad-library.server";

/**
 * TikTok Ads snapshot + diff (#2194). The library module and run.server are
 * mocked so the snapshot logic is isolated; D1 is a minimal fake chain.
 */

const competitorId = "wl-1";
const competitorLabel = "New Balance";
const baseEnv = {
  DECODO_SCRAPER_AUTH: "dGVzdC1hdXRo",
} as never;

// --- Mocks -------------------------------------------------------------

let latestSnapshot: SourceSnapshotRecord | null = null;
let storedAdvertiser: string | null = null;
let resolveResult:
  | { legalName: string; candidates: string[] }
  | { unavailable: true; reason: string } = {
  legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
  candidates: ["NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED"],
};
let fetchAdsResult:
  | { ads: TiktokAd[]; totalAds: number }
  | { unavailable: true; reason: string } = { ads: [], totalAds: 0 };

let fetchCalls = 0;
let resolveCalls = 0;
let fetchSpyCalls = 0;

vi.mock("~/lib/sources/run.server", () => ({
  getLatestSourceSnapshot: vi.fn(async () => latestSnapshot),
}));

vi.mock("~/lib/data/d1.server", () => ({
  ensureDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () =>
          storedAdvertiser === null
            ? { tiktok_advertiser: null }
            : { tiktok_advertiser: storedAdvertiser },
        ),
      })),
    })),
  })),
}));

vi.mock("~/lib/decodo-budget.server", () => ({
  reserveDecodoBudget: vi.fn().mockResolvedValue({ ok: true, reason: "no_kv" }),
}));

vi.mock("~/lib/sources/tiktok-ads/tiktok-ad-library.server", () => ({
  resolveAdvertiser: vi.fn(async () => {
    resolveCalls += 1;
    return resolveResult;
  }),
  fetchAds: vi.fn(async () => {
    fetchCalls += 1;
    return fetchAdsResult;
  }),
}));

// Stub globalThis.fetch so the library module (if it ever escapes the mock)
// does not hit the network.
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ content: { html: "" } }),
  } as Response);
});

const { fetchTiktokSnapshot, diffTiktokAds } = await import(
  "~/lib/sources/tiktok-ads/tiktok-ads-snapshot.server"
);
const { resolveAdvertiser, fetchAds } = await import(
  "~/lib/sources/tiktok-ads/tiktok-ad-library.server"
);

function resetMocks() {
  latestSnapshot = null;
  storedAdvertiser = null;
  resolveResult = {
    legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
    candidates: ["NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED"],
  };
  fetchAdsResult = { ads: [], totalAds: 0 };
  fetchCalls = 0;
  resolveCalls = 0;
  fetchSpyCalls = 0;
  vi.mocked(resolveAdvertiser).mockClear();
  vi.mocked(fetchAds).mockClear();
}

function makeAd(overrides: Partial<TiktokAd> = {}): TiktokAd {
  return {
    adId: "100000000001",
    advertiser: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
    firstShown: "01/15/2026",
    lastShown: "02/20/2026",
    uniqueUsers: "5000",
    thumbnail: null,
    ...overrides,
  };
}

function makeSnapshotRecord(payload: Record<string, unknown>, fetchedAt: string): SourceSnapshotRecord {
  return {
    id: "snap-1",
    watchlistId: competitorId,
    sourceId: "tiktok",
    fetchedAt,
    payload,
    createdAt: fetchedAt,
  };
}

describe("fetchTiktokSnapshot", () => {
  beforeEach(resetMocks);

  it("returns not_configured when DECODO_SCRAPER_AUTH is absent", async () => {
    const result = await fetchTiktokSnapshot({} as never, {
      competitorId,
      competitorLabel,
    });
    expect(result).toEqual({ unavailable: true, reason: "not_configured" });
    expect(fetchCalls).toBe(0);
    expect(resolveCalls).toBe(0);
  });

  it("returns cadence when the latest snapshot is less than 7 days old", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    latestSnapshot = makeSnapshotRecord({ ads: [], totalAds: 0, legalName: "x" }, threeDaysAgo);
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect(result).toEqual({ unavailable: true, reason: "cadence" });
    expect(fetchCalls).toBe(0);
    expect(resolveCalls).toBe(0);
  });

  it("proceeds when the latest snapshot is 8 days old", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    latestSnapshot = makeSnapshotRecord({ ads: [], totalAds: 0, legalName: "x" }, eightDaysAgo);
    storedAdvertiser = "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED";
    fetchAdsResult = { ads: [makeAd()], totalAds: 1 };
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    expect(fetchCalls).toBe(1);
  });

  it("resolves then fetches when no stored advertiser, returning competitorUpdate", async () => {
    storedAdvertiser = null;
    fetchAdsResult = { ads: [makeAd()], totalAds: 1 };
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.payload.legalName).toBe("NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect(result.payload.totalAds).toBe(1);
    expect(result.competitorUpdate).toEqual({
      tiktok_advertiser: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
    });
    expect(resolveCalls).toBe(1);
    expect(fetchCalls).toBe(1);
  });

  it("returns no_advertiser when resolve finds no_match", async () => {
    storedAdvertiser = null;
    resolveResult = { unavailable: true, reason: "no_match" };
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect(result).toEqual({ unavailable: true, reason: "no_advertiser" });
  });

  it("returns payload without competitorUpdate when stored advertiser has ads", async () => {
    storedAdvertiser = "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED";
    fetchAdsResult = { ads: [makeAd()], totalAds: 1 };
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.payload.legalName).toBe("NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect(result.competitorUpdate).toBeUndefined();
    expect(resolveCalls).toBe(0);
  });

  it("re-resolves on real-zero (totalAds 0) and returns competitorUpdate with the new name", async () => {
    storedAdvertiser = "OLD NAME LIMITED";
    // First fetchAds (stored name) returns real zero.
    // Second fetchAds (re-resolved name) returns ads.
    let call = 0;
    vi.mocked(fetchAds).mockImplementation(async () => {
      call += 1;
      if (call === 1) return { ads: [], totalAds: 0 };
      return { ads: [makeAd({ advertiser: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED" })], totalAds: 1 };
    });
    resolveResult = {
      legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
      candidates: ["NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED"],
    };
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.payload.legalName).toBe("NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED");
    expect(result.competitorUpdate).toEqual({
      tiktok_advertiser: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
    });
    expect(resolveCalls).toBe(1);
    expect(call).toBe(2);
  });

  it("returns empty result with stored name when re-resolve finds no_match", async () => {
    storedAdvertiser = "OLD NAME LIMITED";
    vi.mocked(fetchAds).mockResolvedValueOnce({ ads: [], totalAds: 0 });
    resolveResult = { unavailable: true, reason: "no_match" };
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect("unavailable" in result).toBe(false);
    if ("unavailable" in result) throw new Error("unreachable");
    expect(result.payload).toEqual({ ads: [], totalAds: 0, legalName: "OLD NAME LIMITED" });
    expect(result.competitorUpdate).toBeUndefined();
  });

  it("surfaces unavailable from fetchAds (stored name path)", async () => {
    storedAdvertiser = "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED";
    vi.mocked(fetchAds).mockResolvedValueOnce({ unavailable: true, reason: "quota" });
    const result = await fetchTiktokSnapshot(baseEnv, {
      competitorId,
      competitorLabel,
    });
    expect(result).toEqual({ unavailable: true, reason: "quota" });
  });
});

describe("diffTiktokAds", () => {
  beforeEach(resetMocks);

  it("emits only new-ad entries on the first snapshot (prev null)", () => {
    const next: SourceSnapshotInput = {
      payload: {
        ads: [makeAd({ adId: "1" }), makeAd({ adId: "2" })],
        totalAds: 2,
        legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
      },
    };
    const changes = diffTiktokAds(null, next);
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.eventType === "ad_new")).toBe(true);
    expect(changes[0].title).toContain("New TikTok ad from");
    expect(changes[0].metadata).toEqual({
      sourceId: "tiktok",
      adId: "1",
      advertiser: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
    });
  });

  it("emits ad_new for new ad ids and a total change", () => {
    const prev = makeSnapshotRecord(
      {
        ads: [makeAd({ adId: "1" })],
        totalAds: 1,
        legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
      },
      "2026-01-01T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    );
    const next: SourceSnapshotInput = {
      payload: {
        ads: [makeAd({ adId: "1" }), makeAd({ adId: "2" })],
        totalAds: 2,
        legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
      },
    };
    const changes = diffTiktokAds(prev, next);
    // One new-ad entry for adId "2" + one total-ads change (ad_new).
    const newAds = changes.filter((c) => c.title.startsWith("New TikTok ad"));
    expect(newAds).toHaveLength(1);
    expect(newAds[0].metadata).toMatchObject({ adId: "2" });
    const totalChange = changes.find((c) => c.title === "TikTok total ads changed");
    expect(totalChange).toBeDefined();
    expect(totalChange?.eventType).toBe("ad_new");
    expect(totalChange?.summary).toContain("1 → 2");
    expect(totalChange?.metadata).toEqual({
      sourceId: "tiktok",
      totalAdsBefore: 1,
      totalAdsAfter: 2,
    });
  });

  it("emits ad_inactive for an ad paused 14+ days (same lastShown in both)", () => {
    // lastShown 01/10/2026 — well over 14 days before "now" in the test env.
    const oldAd = makeAd({ adId: "1", lastShown: "01/10/2026", firstShown: "01/01/2026" });
    const prev = makeSnapshotRecord(
      {
        ads: [oldAd],
        totalAds: 1,
        legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
      },
      "2026-01-01T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    );
    const next: SourceSnapshotInput = {
      payload: {
        ads: [oldAd],
        totalAds: 1,
        legalName: "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED",
      },
    };
    const changes = diffTiktokAds(prev, next);
    const paused = changes.filter((c) => c.eventType === "ad_inactive" && c.title === "TikTok ad paused");
    expect(paused).toHaveLength(1);
    expect(paused[0].summary).toContain("inactive 14+ days");
    expect(paused[0].metadata).toMatchObject({
      sourceId: "tiktok",
      adId: "1",
      lastShown: "01/10/2026",
    });
    // No total change (1 → 1).
    expect(changes.find((c) => c.title === "TikTok total ads changed")).toBeUndefined();
  });

  it("does not emit paused when lastShown changed between snapshots", () => {
    const prevAd = makeAd({ adId: "1", lastShown: "02/20/2026" });
    const nextAd = makeAd({ adId: "1", lastShown: "02/25/2026" });
    const prev = makeSnapshotRecord(
      { ads: [prevAd], totalAds: 1, legalName: "x" },
      "2026-02-20T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    );
    const next: SourceSnapshotInput = {
      payload: { ads: [nextAd], totalAds: 1, legalName: "x" },
    };
    const changes = diffTiktokAds(prev, next);
    expect(changes.find((c) => c.title === "TikTok ad paused")).toBeUndefined();
  });

  it("emits an ad_inactive total change when totalAds decreases", () => {
    const prev = makeSnapshotRecord(
      { ads: [makeAd({ adId: "1" }), makeAd({ adId: "2" })], totalAds: 2, legalName: "x" },
      "2026-01-01T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
    );
    const next: SourceSnapshotInput = {
      payload: { ads: [makeAd({ adId: "1" })], totalAds: 1, legalName: "x" },
    };
    const changes = diffTiktokAds(prev, next);
    const totalChange = changes.find((c) => c.title === "TikTok total ads changed");
    expect(totalChange?.eventType).toBe("ad_inactive");
    expect(totalChange?.summary).toContain("2 → 1");
  });
});
