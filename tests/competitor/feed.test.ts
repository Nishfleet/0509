import { describe, expect, it } from "vitest";

import {
  FEED_FILTERS,
  FEED_KINDS,
  countByKind,
  filterFeed,
  isFeedKind,
  parseFeedFilter,
  type DevelopmentItem,
  type FeedKind,
} from "../../app/lib/developments";

const ITEMS: readonly DevelopmentItem[] = [
  { id: "a1", kind: "change", title: "Homepage copy", summary: null, url: null, observedAt: "2026-09-01T00:00:00Z" },
  { id: "a2", kind: "hiring", title: "Staff engineer", summary: null, url: null, observedAt: "2026-09-02T00:00:00Z" },
  { id: "a3", kind: "ad", title: "New creative", summary: null, url: null, observedAt: "2026-09-03T00:00:00Z" },
  { id: "a4", kind: "change", title: "Pricing page", summary: null, url: null, observedAt: "2026-09-04T00:00:00Z" },
  { id: "a5", kind: "mention", title: "Hacker News thread", summary: null, url: null, observedAt: "2026-09-05T00:00:00Z" },
  { id: "a6", kind: "hiring", title: "Designer", summary: null, url: null, observedAt: "2026-09-06T00:00:00Z" },
];

describe("FEED_KINDS", () => {
  it("names the four kinds in filter order", () => {
    expect([...FEED_KINDS]).toEqual(["ad", "change", "mention", "hiring"]);
  });
});

describe("isFeedKind", () => {
  it("accepts only the four kinds", () => {
    expect(FEED_KINDS.every((kind) => isFeedKind(kind))).toBe(true);
    expect(isFeedKind("all")).toBe(false);
    expect(isFeedKind("")).toBe(false);
    expect(isFeedKind("ads")).toBe(false);
  });
});

describe("parseFeedFilter", () => {
  it("returns all for null, empty, all and unknown values", () => {
    expect(parseFeedFilter(null)).toBe("all");
    expect(parseFeedFilter("")).toBe("all");
    expect(parseFeedFilter("all")).toBe("all");
    expect(parseFeedFilter("bogus")).toBe("all");
  });

  it("returns each kind unchanged", () => {
    for (const kind of FEED_KINDS) {
      expect(parseFeedFilter(kind)).toBe(kind);
    }
  });
});

describe("filterFeed", () => {
  it("keeps input order for all", () => {
    expect(filterFeed(ITEMS, "all").map((item) => item.id)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
  });

  it("keeps input order for a kind", () => {
    expect(filterFeed(ITEMS, "hiring").map((item) => item.id)).toEqual(["a2", "a6"]);
  });

  it("returns a new array for all and for a kind", () => {
    expect(filterFeed(ITEMS, "all")).not.toBe(ITEMS);
    expect(filterFeed(ITEMS, "change")).not.toBe(ITEMS);
  });

  it("returns only the requested kind", () => {
    expect(filterFeed(ITEMS, "change").map((item) => item.id)).toEqual(["a1", "a4"]);
    expect(filterFeed(ITEMS, "ad").map((item) => item.id)).toEqual(["a3"]);
    expect(filterFeed(ITEMS, "mention").map((item) => item.id)).toEqual(["a5"]);
  });
});

describe("countByKind", () => {
  it("counts every kind plus all", () => {
    expect(countByKind(ITEMS)).toEqual({ all: 6, ad: 1, change: 2, mention: 1, hiring: 2 });
  });

  it("returns all-zero counts for an empty list", () => {
    const empty: readonly { kind: FeedKind }[] = [];
    expect(countByKind(empty)).toEqual({ all: 0, ad: 0, change: 0, mention: 0, hiring: 0 });
  });
});

describe("FEED_FILTERS", () => {
  it("lists the labels in order", () => {
    expect(FEED_FILTERS.map((filter) => filter.label)).toEqual(["All", "Ads", "Site changes", "Mentions", "Hiring"]);
  });
});
