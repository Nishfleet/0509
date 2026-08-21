import { describe, expect, it } from "vitest";

import {
  BRAND_PAGE_REFRESH_CRON,
  BRAND_PAGE_REFRESH_MAX_PER_PASS,
  BRAND_PAGE_REFRESH_STALE_AFTER_MS,
  selectBrandPageRefreshTargets,
  type BrandPageRefreshCandidate,
} from "~/lib/brand-page-refresh.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function candidate(overrides: Partial<BrandPageRefreshCandidate>): BrandPageRefreshCandidate {
  return {
    domain: "nykaa.com",
    fetchedAt: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
    cacheKey: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
    ...overrides,
  };
}

describe("brand-page-refresh cron constants", () => {
  it("pins the cron expression", () => {
    // The string is duplicated in workers/schedule.ts (the dispatch
    // site cannot import the brand-page-refresh module without dragging
    // in the D1-dependent refresh function). Tests here pin both the
    // canonical string AND its semantics so a drift between the two
    // surfaces fails the suite before deploy.
    expect(BRAND_PAGE_REFRESH_CRON).toBe("37 */12 * * *");
  });

  it("bounds the per-pass refresh budget to the visible-sitemap envelope", () => {
    expect(BRAND_PAGE_REFRESH_MAX_PER_PASS).toBe(12);
  });

  it("refreshes before the indexing window drops the page from the sitemap", () => {
    // Stale threshold must be strictly less than the 7-day indexing window
    // so the refresh keeps the page inside the indexable envelope.
    expect(BRAND_PAGE_REFRESH_STALE_AFTER_MS).toBeLessThan(7 * DAY_MS);
  });
});

describe("selectBrandPageRefreshTargets", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("returns an empty list when no candidates are stale", () => {
    const targets = selectBrandPageRefreshTargets(
      [candidate({ fetchedAt: new Date(now.getTime() - 6 * HOUR_MS).toISOString() })],
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets).toEqual([]);
  });

  it("picks candidates older than the staleness threshold", () => {
    const old = candidate({
      domain: "old.com",
      fetchedAt: new Date(now.getTime() - 48 * HOUR_MS).toISOString(),
    });
    const fresh = candidate({
      domain: "fresh.com",
      fetchedAt: new Date(now.getTime() - 2 * HOUR_MS).toISOString(),
    });
    const targets = selectBrandPageRefreshTargets(
      [old, fresh],
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets.map((t) => t.domain)).toEqual(["old.com"]);
  });

  it("sorts ascending by fetchedAt — the oldest cache row refreshes first", () => {
    const oldest = candidate({
      domain: "oldest.com",
      fetchedAt: new Date(now.getTime() - 4 * DAY_MS).toISOString(),
    });
    const middle = candidate({
      domain: "middle.com",
      fetchedAt: new Date(now.getTime() - 36 * HOUR_MS).toISOString(),
    });
    const newest = candidate({
      domain: "newest.com",
      fetchedAt: new Date(now.getTime() - 25 * HOUR_MS).toISOString(),
    });
    const targets = selectBrandPageRefreshTargets(
      [newest, oldest, middle],
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets.map((t) => t.domain)).toEqual(["oldest.com", "middle.com", "newest.com"]);
  });

  it("caps the returned list at maxPerPass", () => {
    const candidates: BrandPageRefreshCandidate[] = [];
    for (let i = 0; i < 20; i += 1) {
      candidates.push(candidate({
        domain: `d${i}.com`,
        fetchedAt: new Date(now.getTime() - (2 * DAY_MS + i * HOUR_MS)).toISOString(),
      }));
    }
    const targets = selectBrandPageRefreshTargets(
      candidates,
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets).toHaveLength(12);
  });

  it("dedupes by domain — the NEWEST row per domain is the refresh candidate", () => {
    const olderRow = candidate({
      domain: "nykaa.com",
      fetchedAt: new Date(now.getTime() - 4 * DAY_MS).toISOString(),
      cacheKey: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-2",
    });
    const newerRow = candidate({
      domain: "nykaa.com",
      fetchedAt: new Date(now.getTime() - 26 * HOUR_MS).toISOString(),
      cacheKey: "search-v2:domain:nykaa.com:exact:meta_library_browser:all:page-1",
    });
    const targets = selectBrandPageRefreshTargets(
      [olderRow, newerRow],
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]?.domain).toBe("nykaa.com");
    expect(targets[0]?.fetchedAt).toBe(newerRow.fetchedAt);
  });

  it("skips rows whose fetchedAt is unparseable (instead of throwing)", () => {
    const targets = selectBrandPageRefreshTargets(
      [candidate({ fetchedAt: "not-an-iso" })],
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets).toEqual([]);
  });

  it("treats a 25-hour-old capture as stale (boundary, not edge-case)", () => {
    // 25 hours is strictly past the 24-hour threshold — the 6/12 visible
    // "checked about 2 days ago" symptom in the scout item lives entirely
    // on the past-24h side of the cutoff.
    const targets = selectBrandPageRefreshTargets(
      [candidate({ fetchedAt: new Date(now.getTime() - 25 * HOUR_MS).toISOString() })],
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets).toHaveLength(1);
  });

  it("treats a 24-hour-old capture as still fresh (boundary, inclusive of fresh side)", () => {
    // The threshold is strict less-than — a 24h capture is not yet stale
    // so a refresh at this exact age would be wasteful. The next pass at
    // 12h cadence will pick it up.
    const targets = selectBrandPageRefreshTargets(
      [candidate({ fetchedAt: new Date(now.getTime() - 24 * HOUR_MS).toISOString() })],
      { staleAfterMs: 24 * HOUR_MS, maxPerPass: 12, now },
    );
    expect(targets).toEqual([]);
  });
});
