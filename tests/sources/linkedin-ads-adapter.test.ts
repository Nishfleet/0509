import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";
import type { SourceSnapshotRecord, SourceSnapshotInput } from "~/lib/sources/types";
import { fetchAdsByAccountOwner, type LinkedInAdCard, type LinkedInAdLibraryFetchResult } from "~/lib/sources/linkedin-ads/linkedin-ad-library.server";

/**
 * Mock the Decodo budget helper so the adapter's budget gate is controllable
 * without a real KV namespace. `budgetOk` flips the gate per test.
 */
let budgetOk = true;
vi.mock("~/lib/decodo-budget.server", () => ({
  reserveDecodoBudget: vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: budgetOk })),
}));

/**
 * Mock the fetch module so the adapter test isolates fetch-gate logic from
 * HTML parsing (covered in the fetch-module test file). `fetchResult` is the
 * value the mocked fetchAdsByAccountOwner returns.
 */
let fetchResult: LinkedInAdLibraryFetchResult = { unavailable: true, reason: "no_credentials" };
vi.mock("~/lib/sources/linkedin-ads/linkedin-ad-library.server", () => ({
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
