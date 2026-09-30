import { describe, expect, it } from "vitest";

import { WATCHED_NOUNS } from "../../app/lib/coverage";
import { UNANSWERED_NOUNS, watchedClaims, type ClaimSource } from "../../app/lib/watched-claims";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const FRESH = "2026-09-29T06:00:00.000Z";
const STALE = "2026-09-20T06:00:00.000Z";

function row(key: string, fetchedAt: string, degradedReason: string | null = null): ClaimSource {
  return {
    source: { key, platform: "test", is_enabled: 1, degraded_reason: degradedReason },
    snapshot: { fetched_at: fetchedAt, item_count: 3 },
  };
}

const ALL_ANSWERING = [
  row("site.web", FRESH),
  row("gdelt.doc", FRESH),
  row("hn.algolia", FRESH),
  row("youtube.channel_rss", FRESH),
];

describe("watchedClaims", () => {
  it("claims every live kind while every source answers", () => {
    const claims = watchedClaims(ALL_ANSWERING, NOW);
    expect(claims.nouns).toBe(WATCHED_NOUNS);
    expect(claims.features).toContain("Mentions: News");
    expect(claims.features).toContain("Mentions: YouTube");
  });

  it("drops the mentions noun and features while every mention source is degraded", () => {
    const claims = watchedClaims(
      [
        row("site.web", FRESH),
        row("gdelt.doc", FRESH, "timed out"),
        row("hn.algolia", STALE),
        row("youtube.channel_rss", FRESH, "no data"),
      ],
      NOW,
    );
    expect(claims.nouns).not.toMatch(/mentions/);
    expect(claims.nouns).toMatch(/website changes/);
    expect(claims.features.filter((feature) => feature.startsWith("Mentions"))).toEqual([]);
    expect(claims.features).toContain("Site changes: Homepage");
  });

  it("keeps a kind while one of its sources still answers, and lists only that source", () => {
    const claims = watchedClaims([...ALL_ANSWERING.slice(0, 2), row("hn.algolia", STALE)], NOW);
    expect(claims.nouns).toMatch(/news mentions/);
    expect(claims.features).toContain("Mentions: News");
    expect(claims.features).not.toContain("Mentions: Hacker News");
  });

  it("names no source it has no registry row for, and never leaves the noun list empty", () => {
    const claims = watchedClaims([], NOW);
    expect(claims.nouns).toBe(UNANSWERED_NOUNS);
    expect(claims.features).toEqual(["Your own site: Breakage alerts"]);
  });
});
