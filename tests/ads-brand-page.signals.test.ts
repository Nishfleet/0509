import { describe, expect, it } from "vitest";

import {
  buildBrandChangeFeed,
  computeBrandPageAggressionScore,
} from "~/lib/brand-page.server";
import type { AdRecord } from "~/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-21T12:00:00.000Z");

function isoAgo(ms: number) {
  return new Date(NOW.getTime() - ms).toISOString();
}

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    body: "Run through summer.",
    previewHeadline: "Run through summer with gear that can take the heat.",
    previewSubhead: "",
    hook: "Shop Now",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/launch",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(20 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

describe("computeBrandPageAggressionScore", () => {
  it("computes a score from real ad fields when the observed window clears the evidence floor", () => {
    const ads = [
      ad({ metaAdId: "a1", firstSeenAt: isoAgo(60 * DAY_MS), variantCount: 4 }),
      ad({ metaAdId: "a2", firstSeenAt: isoAgo(40 * DAY_MS), variantCount: 2 }),
      ad({ metaAdId: "a3", firstSeenAt: isoAgo(10 * DAY_MS) }),
      ad({ metaAdId: "a4", firstSeenAt: isoAgo(3 * DAY_MS) }),
    ];

    const result = computeBrandPageAggressionScore(ads, NOW);

    expect(result).not.toBeNull();
    expect(result?.windowDays).toBe(60);
    // Components always sum exactly to the displayed score (no hidden weighting).
    const { velocity, testing, freshness, persistence } = result!.components;
    expect(velocity + testing + freshness + persistence).toBe(result!.score);
    expect(result?.adCount).toBe(4);
    expect(result?.activeCount).toBe(4);
    expect(result?.bandLabel).toBeTruthy();
  });

  it("returns null below the 14-day evidence floor rather than scoring thin evidence", () => {
    const ads = [ad({ firstSeenAt: isoAgo(5 * DAY_MS) })];
    expect(computeBrandPageAggressionScore(ads, NOW)).toBeNull();
  });

  it("returns null when no ad carries a first-seen date", () => {
    const ads = [ad({ firstSeenAt: null }), ad({ metaAdId: "a2", firstSeenAt: null })];
    expect(computeBrandPageAggressionScore(ads, NOW)).toBeNull();
  });

  it("returns null for an empty ad set", () => {
    expect(computeBrandPageAggressionScore([], NOW)).toBeNull();
  });
});

describe("buildBrandChangeFeed", () => {
  it("surfaces only ads first observed inside the recent window, newest first", () => {
    const ads = [
      ad({ metaAdId: "old", firstSeenAt: isoAgo(40 * DAY_MS) }),
      ad({ metaAdId: "recent", firstSeenAt: isoAgo(3 * DAY_MS), variantCount: 3 }),
      ad({ metaAdId: "today", firstSeenAt: isoAgo(2 * 60 * 60 * 1000) }),
    ];

    const feed = buildBrandChangeFeed(ads, NOW);

    expect(feed.map((event) => event.id)).toEqual(["today", "recent"]);
    expect(feed[0]?.isToday).toBe(true);
    expect(feed[0]?.dayLabel).toBe("Today");
    expect(feed[1]?.variantCount).toBe(3);
    expect(feed[1]?.why).toContain("3 variants");
    // Every row carries a real capture source.
    expect(feed.every((event) => event.source === "AD LIBRARY")).toBe(true);
  });

  it("returns an empty feed when nothing was newly observed (section hides, no fake card)", () => {
    const ads = [
      ad({ metaAdId: "old-1", firstSeenAt: isoAgo(40 * DAY_MS) }),
      ad({ metaAdId: "old-2", firstSeenAt: isoAgo(90 * DAY_MS) }),
    ];
    expect(buildBrandChangeFeed(ads, NOW)).toEqual([]);
  });

  it("ignores ads without a parseable first-seen date", () => {
    const ads = [ad({ metaAdId: "null-seen", firstSeenAt: null })];
    expect(buildBrandChangeFeed(ads, NOW)).toEqual([]);
  });
});
