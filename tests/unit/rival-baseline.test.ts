import { describe, expect, it } from "vitest";

import { firstBriefLine } from "../../app/lib/quiet-week";
import { baselineLines, type RivalFacts } from "../../app/lib/rival-baseline";

const EMPTY: RivalFacts = {
  description: null,
  pages: 0,
  reads: 0,
  firstReadAt: null,
  changes: 0,
  lastChangeAt: null,
  roles: [],
  kinds: [],
  feed: null,
};

describe("where a rival stands today", () => {
  it("states its own words, what we found on its site, how long we have watched and what it published", () => {
    expect(
      baselineLines(
        {
          ...EMPTY,
          description: "  Training   apparel for people who lift. ",
          pages: 3,
          reads: 11,
          firstReadAt: "2026-10-02T21:00:00Z",
          changes: 2,
          lastChangeAt: "2026-10-08T21:00:00Z",
          roles: ["careers", "pricing", "other"],
          kinds: [
            { kind: "mention", count: 9, latestTitle: "Review", latestAt: "2026-10-12T00:00:00Z" },
            { kind: "hiring", count: 1, latestTitle: "Designer", latestAt: "2026-10-01T00:00:00Z" },
          ],
          feed: { posts: 12, latestTitle: "Autumn drop is live", latestAt: "2026-10-03T09:00:00Z" },
        },
        "UTC",
      ),
    ).toEqual([
      "In its own words: Training apparel for people who lift.",
      "Found on its site: pricing page, careers page.",
      "Watched since Oct 2: 11 reads, 2 changes recorded (last Oct 8).",
      "Blog feed: 12 posts, latest “Autumn drop is live” (Oct 3). Last 30 days: 1 job post, 9 mentions.",
    ]);
  });

  it("still gives a rival with only a site read two true lines", () => {
    expect(
      baselineLines({ ...EMPTY, pages: 2, reads: 2, firstReadAt: "2026-10-14T10:00:00Z", roles: ["pricing"] }, "UTC"),
    ).toEqual(["Found on its site: pricing page.", "Watched since Oct 14: 2 reads, no changes yet."]);
  });

  it("says nothing it cannot back", () => {
    expect(baselineLines(EMPTY, "UTC")).toEqual([]);
    expect(baselineLines({ ...EMPTY, feed: { posts: 0, latestTitle: null, latestAt: null } }, "UTC")).toEqual([]);
  });

  it("drops the watched line where the page already states reads", () => {
    const facts = { ...EMPTY, reads: 3, firstReadAt: "2026-10-14T10:00:00Z", roles: ["blog"] };
    expect(baselineLines(facts, "UTC", { watched: false })).toEqual(["Found on its site: blog."]);
  });

  it("shortens a long description and survives a bad timezone", () => {
    const lines = baselineLines(
      { ...EMPTY, description: "x".repeat(300), reads: 1, firstReadAt: "2026-10-03T09:00:00Z" },
      "Not/AZone",
    );
    expect(lines[0]).toHaveLength("In its own words: ".length + 140);
    expect(lines[1]).toBe("Watched since Oct 3: 1 read, no changes yet.");
  });

  it("introduces the first brief as a starting point, never as a change", () => {
    expect(firstBriefLine(1)).toContain("where your rival stands today");
    expect(firstBriefLine(4)).toBe(
      "This is your starting point: where your 4 rivals stand today, before anything changes. We'll tell you the moment one moves.",
    );
  });
});
