import { describe, expect, it } from "vitest";

import {
  buildSnapshotPayload,
  diffGoogleSerpSnapshots,
  type GoogleSerpSnapshotPayload,
} from "~/lib/sources/google-search/google-serp-snapshot.server";
import type { SerpAd, SerpOrganic } from "~/lib/sources/google-search/serp-provider";
import { WATCH_EVENT_TYPES } from "~/lib/types";

function organicRow(overrides: Partial<SerpOrganic> = {}): SerpOrganic {
  return {
    position: overrides.position ?? 1,
    domain: overrides.domain ?? "nike.com",
    title: overrides.title ?? "Nike Official",
    url: overrides.url ?? "https://nike.com/",
    snippet: overrides.snippet ?? "Just do it.",
  };
}

function adRow(overrides: Partial<SerpAd> = {}): SerpAd {
  return {
    position: overrides.position ?? 1,
    advertiser_domain: overrides.advertiser_domain ?? "adidas.com",
    title: overrides.title ?? "Adidas",
    url: overrides.url ?? "https://adidas.com/",
    snippet: overrides.snippet ?? "",
  };
}

/** Build a payload through the real builder, with test defaults. */
function payload(
  input: {
    domain?: string;
    query?: string;
    provider?: string;
    fetchedAt?: string;
    ads?: SerpAd[];
    organic?: SerpOrganic[];
    prev?: GoogleSerpSnapshotPayload | null;
  } = {},
): GoogleSerpSnapshotPayload {
  return buildSnapshotPayload({
    domain: input.domain ?? "nike.com",
    query: input.query ?? "nike",
    provider: input.provider ?? "decodo",
    fetchedAt: input.fetchedAt ?? "2026-09-10T00:00:00.000Z",
    ads: input.ads ?? [],
    organic: input.organic ?? [],
    prev: input.prev ?? null,
  });
}

/** The categories a diff produced, in emission order. */
function categories(changes: ReturnType<typeof diffGoogleSerpSnapshots>): string[] {
  return changes.map((change) => String((change.metadata as { category?: unknown }).category));
}

describe("google-serp-snapshot buildSnapshotPayload", () => {
  it("dedupes sponsored advertisers preserving first-seen order, lowercased, www stripped", () => {
    const built = payload({
      ads: [
        adRow({ advertiser_domain: "WWW.Adidas.com" }),
        adRow({ advertiser_domain: "adidas.com" }),
        adRow({ advertiser_domain: "Puma.com" }),
        adRow({ advertiser_domain: " " }),
        adRow({ advertiser_domain: "puma.com" }),
        adRow({ advertiser_domain: "reebok.com" }),
      ],
    });
    expect(built.sponsoredAdvertisers).toEqual(["adidas.com", "puma.com", "reebok.com"]);
  });

  it("keeps only the top 10 organic rows, sorted by position", () => {
    // Fed out of order, and with 12 rows so the cap and the position <= 10
    // filter both have to do work.
    const organic = Array.from({ length: 12 }, (_unused, index) =>
      organicRow({ position: 12 - index, domain: `site${12 - index}.com`, url: `https://site${12 - index}.com/` }),
    );
    const built = payload({ organic });
    expect(built.organic).toHaveLength(10);
    expect(built.organic.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(built.organic.map((row) => row.domain)).toEqual([
      "site1.com",
      "site2.com",
      "site3.com",
      "site4.com",
      "site5.com",
      "site6.com",
      "site7.com",
      "site8.com",
      "site9.com",
      "site10.com",
    ]);
    // The field set the brand page reads survives the mapping.
    expect(built.organic[0]).toEqual({
      position: 1,
      domain: "site1.com",
      title: "Nike Official",
      url: "https://site1.com/",
      snippet: "Just do it.",
      prevPosition: null,
    });
  });

  it("fills prevPosition from the previous payload by url match, null when unmatched or no prev", () => {
    const prev = payload({
      organic: [
        organicRow({ position: 4, domain: "nike.com", url: "https://nike.com/" }),
        organicRow({ position: 7, domain: "adidas.com", url: "https://adidas.com/" }),
      ],
      fetchedAt: "2026-09-09T00:00:00.000Z",
    });

    const next = payload({
      prev,
      organic: [
        organicRow({ position: 1, domain: "nike.com", url: "https://nike.com/" }),
        organicRow({ position: 2, domain: "adidas.com", url: "https://adidas.com/sale" }),
      ],
      fetchedAt: "2026-09-10T00:00:00.000Z",
    });

    expect(next.organic.map((row) => [row.url, row.prevPosition])).toEqual([
      ["https://nike.com/", 4],
      ["https://adidas.com/sale", null],
    ]);

    // No previous snapshot: every prevPosition is null.
    const first = payload({ organic: [organicRow({ position: 3 })] });
    expect(first.organic.map((row) => row.prevPosition)).toEqual([null]);
  });

  it("matches a previous url by its canonical form, host case-insensitively and path case-sensitively", () => {
    const prev = payload({
      organic: [
        organicRow({ position: 2, domain: "nike.com", url: "https://Nike.com" }),
        organicRow({ position: 5, domain: "adidas.com", url: "https://adidas.com/Sale" }),
      ],
      fetchedAt: "2026-09-09T00:00:00.000Z",
    });

    const next = payload({
      prev,
      organic: [
        // Same page as the previous row: host casing differs and Google
        // dropped the trailing slash.
        organicRow({ position: 1, domain: "nike.com", url: "https://nike.com/" }),
        // NOT the same page: a url path is case-sensitive, so the lowercased
        // path is reported as an unmatched url rather than a match.
        organicRow({ position: 4, domain: "adidas.com", url: "https://adidas.com/sale" }),
      ],
    });

    expect(next.organic.map((row) => [row.url, row.prevPosition])).toEqual([
      ["https://nike.com/", 2],
      ["https://adidas.com/sale", null],
    ]);
  });

  it("does not mutate or reorder the caller's rows", () => {
    const organic = [
      organicRow({ position: 9, domain: "b.com", url: "https://b.com/" }),
      organicRow({ position: 2, domain: "a.com", url: "https://a.com/" }),
    ];
    const ads = [adRow({ advertiser_domain: "Adidas.com" })];

    const built = payload({ organic, ads });

    expect(organic.map((row) => row.position)).toEqual([9, 2]);
    expect(organic[0]).not.toHaveProperty("prevPosition");
    expect(Object.keys(organic[1])).toEqual(["position", "domain", "title", "url", "snippet"]);
    expect(ads[0]?.advertiser_domain).toBe("Adidas.com");
    expect(built.organic.map((row) => row.position)).toEqual([2, 9]);
    expect(built.ads).toEqual(ads);
  });

  it("breaks a position tie deterministically by domain, without reordering the caller's array", () => {
    const tied = [
      organicRow({ position: 1, domain: "zeta.com", url: "https://zeta.com/" }),
      organicRow({ position: 1, domain: "alpha.com", url: "https://alpha.com/" }),
    ];
    expect(payload({ organic: tied }).organic.map((row) => row.domain)).toEqual(["alpha.com", "zeta.com"]);
    expect(tied.map((row) => row.domain)).toEqual(["zeta.com", "alpha.com"]);
  });

  it("ranks the top 10 by rank order, not by the absolute position number", () => {
    // The live fixture (tests/fixtures/google-search/decodo-lawyer-query.json)
    // stores `pos` 1..9 with `pos_overall` 3..11. When `pos` is absent the
    // mapper stores `pos_overall`, so the positions are 3..11: nine organic
    // rows, all nine of them the top 10. A numeric `position <= 10` cutoff
    // would keep only the first eight.
    const positions = [3, 4, 5, 6, 7, 8, 9, 10, 11];
    const liveRows = positions.map((position) =>
      organicRow({ position, domain: `site${position}.com`, url: `https://site${position}.com/` }),
    );

    const built = payload({ organic: liveRows });
    expect(built.organic.map((row) => row.position)).toEqual(positions);
    expect(built.organic).toHaveLength(9);

    // Membership is the same set on the diff side: the own domain at page rank
    // 11 is the ninth organic result, so losing it is a real "left the top 10"
    // (the numeric cutoff would have missed it).
    const ownAt11 = [
      ...liveRows.slice(0, 8),
      organicRow({ position: 11, domain: "nike.com", url: "https://nike.com/" }),
    ];

    const left = diffGoogleSerpSnapshots(payload({ organic: ownAt11 }), payload({ organic: liveRows }));
    expect(categories(left)).toEqual(["own_domain_left_top10", "new_top10_domains"]);
    expect(left[0]?.metadata).toEqual({ category: "own_domain_left_top10", domain: "nike.com", from: 11 });
    expect(left[1]?.metadata).toEqual({ category: "new_top10_domains", domains: ["site11.com"] });

    const entered = diffGoogleSerpSnapshots(payload({ organic: liveRows }), payload({ organic: ownAt11 }));
    expect(categories(entered)).toEqual(["own_domain_entered_top10"]);
    expect(entered[0]?.metadata).toEqual({ category: "own_domain_entered_top10", domain: "nike.com", to: 11 });
  });

  it("never stores or diffs a row with position 0", () => {
    // The mapper can emit 0 (a provider row with `pos: 0`). Zero is not a rank,
    // so it is neither stored nor diffable.
    const built = payload({
      organic: [
        organicRow({ position: 0, domain: "zero.com", url: "https://zero.com/" }),
        organicRow({ position: 1, domain: "nike.com", url: "https://nike.com/" }),
      ],
    });
    expect(built.organic.map((row) => row.domain)).toEqual(["nike.com"]);

    // A stored 0 row (hand-written, or written by an older mapper) is not a
    // previous position either: the row is not read at all.
    const zeroOnly = payload({ organic: [] });
    zeroOnly.organic = [
      {
        position: 0,
        domain: "nike.com",
        title: "Nike Official",
        url: "https://nike.com/",
        snippet: "Just do it.",
        prevPosition: null,
      },
    ];
    const afterZero = payload({
      prev: zeroOnly,
      organic: [organicRow({ position: 1, domain: "nike.com", url: "https://nike.com/" })],
    });
    expect(afterZero.organic.map((row) => [row.domain, row.prevPosition])).toEqual([["nike.com", null]]);

    // ...and the diff's top-10 set ignores it too: with the 0 row dropped the
    // own domain is absent from the previous top 10, so this reads as an entry
    // (#5), not as a five-position move from #0.
    const zeroRowPrev = payload({
      organic: [organicRow({ position: 1, domain: "other.com", url: "https://other.com/" })],
    });
    zeroRowPrev.organic = [
      {
        position: 0,
        domain: "nike.com",
        title: "Nike Official",
        url: "https://nike.com/",
        snippet: "Just do it.",
        prevPosition: null,
      },
      ...zeroRowPrev.organic,
    ];
    const entered = diffGoogleSerpSnapshots(
      zeroRowPrev,
      payload({ organic: [organicRow({ position: 5, domain: "nike.com", url: "https://nike.com/" })] }),
    );
    expect(categories(entered)).toEqual(["own_domain_entered_top10"]);
    expect(entered[0]?.metadata).toEqual({
      category: "own_domain_entered_top10",
      domain: "nike.com",
      to: 5,
    });

    // A 0 row is not part of the stored domain set either: dropping it is
    // silent.
    const prev = payload({
      organic: [
        organicRow({ position: 0, domain: "zero.com", url: "https://zero.com/" }),
        organicRow({ position: 2, domain: "nike.com", url: "https://nike.com/" }),
      ],
    });
    const next = payload({
      prev,
      organic: [organicRow({ position: 2, domain: "nike.com", url: "https://nike.com/" })],
    });
    expect(next.organic.map((row) => [row.domain, row.prevPosition])).toEqual([["nike.com", 2]]);
    expect(diffGoogleSerpSnapshots(prev, next)).toEqual([]);
  });

  it("ignores a previous organic row that is not in the top 10", () => {
    // The builder and the diff must agree on the top-10 set: an 11th-ranked row
    // in a stored payload is not a previous position and is not a top-10
    // domain, so the own domain reads as newly entered, not as moved.
    const sites = Array.from({ length: 10 }, (_unused, index) =>
      organicRow({
        position: index + 1,
        domain: `site${index + 1}.com`,
        url: `https://site${index + 1}.com/`,
      }),
    );
    const stored = payload({ organic: sites });
    // A hand-written or older stored payload can carry an 11th row...
    stored.organic = [
      ...stored.organic,
      {
        position: 12,
        domain: "nike.com",
        title: "Nike Official",
        url: "https://nike.com/",
        snippet: "Just do it.",
        prevPosition: null,
      },
    ];
    expect(stored.organic).toHaveLength(11);

    const next = payload({
      prev: stored,
      organic: [organicRow({ position: 1, domain: "nike.com", url: "https://nike.com/" })],
    });

    // ...and it is not used as a previous position.
    expect(next.organic).toEqual([
      {
        position: 1,
        domain: "nike.com",
        title: "Nike Official",
        url: "https://nike.com/",
        snippet: "Just do it.",
        prevPosition: null,
      },
    ]);

    // ...nor as a top-10 domain, so this is an entry, not a move.
    const changes = diffGoogleSerpSnapshots(stored, next);
    expect(categories(changes)).toEqual(["own_domain_entered_top10"]);
    expect(changes[0]?.metadata).toEqual({
      category: "own_domain_entered_top10",
      domain: "nike.com",
      to: 1,
    });
  });

  it("falls back to a host+path match when the exact url differs, and prefers the exact match", () => {
    const prev = payload({
      organic: [
        organicRow({ position: 2, domain: "nike.com", url: "https://nike.com/shoes" }),
        organicRow({ position: 5, domain: "adidas.com", url: "https://adidas.com/sale" }),
      ],
    });

    const next = payload({
      prev,
      organic: [
        // The same result, with a tracking param and a scroll-to-text fragment
        // Google attached: no exact match, but host and path are unchanged.
        organicRow({
          position: 1,
          domain: "nike.com",
          url: "https://nike.com/shoes?utm_source=google#:~:text=Nike",
        }),
        // A different path is NOT the same page: the fallback does not merge
        // these and prevPosition stays null.
        organicRow({ position: 4, domain: "adidas.com", url: "https://adidas.com/air" }),
      ],
    });

    expect(next.organic.map((row) => [row.url, row.prevPosition])).toEqual([
      ["https://nike.com/shoes?utm_source=google#:~:text=Nike", 2],
      ["https://adidas.com/air", null],
    ]);

    // Documented trade-off: when both an exact and a path match exist, the
    // exact one is used, even though the path fallback points at a better rank.
    const twoKeys = payload({
      organic: [
        organicRow({ position: 2, domain: "nike.com", url: "https://nike.com/shoes?variant=a" }),
        organicRow({ position: 5, domain: "nike.com", url: "https://nike.com/shoes" }),
      ],
    });
    const exactNext = payload({
      prev: twoKeys,
      organic: [organicRow({ position: 1, domain: "nike.com", url: "https://nike.com/shoes" })],
    });
    expect(exactNext.organic.map((row) => row.prevPosition)).toEqual([5]);
  });
});

describe("google-serp-snapshot diffGoogleSerpSnapshots", () => {
  it("returns no changes on the first snapshot (no baseline)", () => {
    const next = payload({
      ads: [adRow()],
      organic: [organicRow({ position: 1 })],
    });
    expect(diffGoogleSerpSnapshots(null, next)).toEqual([]);
  });

  it("returns no changes when the snapshot is identical", () => {
    const rows = [organicRow({ position: 1, domain: "nike.com" }), organicRow({ position: 4, domain: "adidas.com" })];
    const ads = [adRow({ advertiser_domain: "adidas.com" })];
    const prev = payload({ organic: rows, ads });
    const next = payload({ organic: rows, ads, fetchedAt: "2026-09-11T00:00:00.000Z" });
    expect(diffGoogleSerpSnapshots(prev, next)).toEqual([]);
  });

  it("detects a new sponsored advertiser domain", () => {
    const prev = payload({ ads: [adRow({ advertiser_domain: "adidas.com" })] });
    const next = payload({
      ads: [adRow({ advertiser_domain: "adidas.com" }), adRow({ advertiser_domain: "reebok.com" })],
    });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.eventType).toBe("ad_new");
    expect(changes[0]?.metadata).toEqual({
      category: "new_sponsored_advertisers",
      advertiserDomains: ["reebok.com"],
    });
    expect(categories(changes)).toEqual(["new_sponsored_advertisers"]);
    expect(changes[0]?.title).toContain("nike.com");
    expect(changes[0]?.summary).toContain("reebok.com");
  });

  it("detects a removed sponsored advertiser domain", () => {
    const prev = payload({
      ads: [adRow({ advertiser_domain: "adidas.com" }), adRow({ advertiser_domain: "puma.com" })],
    });
    const next = payload({ ads: [adRow({ advertiser_domain: "adidas.com" })] });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.eventType).toBe("ad_inactive");
    expect(changes[0]?.metadata).toEqual({
      category: "removed_sponsored_advertisers",
      advertiserDomains: ["puma.com"],
    });
    expect(categories(changes)).toEqual(["removed_sponsored_advertisers"]);
    expect(changes[0]?.title).toContain("nike.com");
    expect(changes[0]?.summary).toContain("puma.com");
  });

  it("stays silent when the sponsored advertiser set is only reordered", () => {
    const prev = payload({
      ads: [adRow({ advertiser_domain: "adidas.com" }), adRow({ advertiser_domain: "puma.com" })],
    });
    const next = payload({
      ads: [adRow({ advertiser_domain: "puma.com" }), adRow({ advertiser_domain: "adidas.com" })],
      fetchedAt: "2026-09-11T00:00:00.000Z",
    });
    expect(diffGoogleSerpSnapshots(prev, next)).toEqual([]);
  });

  it("normalizes a stored sponsored advertiser list before comparing it", () => {
    // A hand-written or older stored payload can hold casing, a "www." prefix,
    // blanks and duplicates. Compared as stored, "WWW.Adidas.com" beside
    // "adidas.com" would emit ad_new AND ad_inactive for one domain in one run.
    const row = organicRow({ position: 1, domain: "nike.com" });
    const prev = payload({ organic: [row] });
    prev.sponsoredAdvertisers = ["adidas.com", " ADIDAS.com ", "WWW.Adidas.com", "adidas.com", "", "   "];
    const next = payload({ organic: [row], fetchedAt: "2026-09-11T00:00:00.000Z" });
    next.sponsoredAdvertisers = ["adidas.com"];
    expect(diffGoogleSerpSnapshots(prev, next)).toEqual([]);

    // A genuinely new advertiser is still reported, normalized.
    next.sponsoredAdvertisers = ["adidas.com", "Puma.com"];
    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(categories(changes)).toEqual(["new_sponsored_advertisers"]);
    expect(changes[0]?.metadata).toEqual({
      category: "new_sponsored_advertisers",
      advertiserDomains: ["puma.com"],
    });
  });

  it("fires when the own domain drops 3 organic positions (1 -> 4)", () => {
    const prev = payload({ organic: [organicRow({ position: 1, domain: "nike.com" })] });
    const next = payload({ organic: [organicRow({ position: 4, domain: "nike.com" })] });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.eventType).toBe("website_page_changed");
    expect(changes[0]?.metadata).toEqual({
      category: "own_domain_move",
      domain: "nike.com",
      from: 1,
      to: 4,
      delta: 3,
    });
    expect(categories(changes)).toEqual(["own_domain_move"]);
    expect(changes[0]?.title).toContain("nike.com");
    expect(changes[0]?.title).toContain("3");
  });

  it("stays silent when the own domain moves only 2 positions (1 -> 3)", () => {
    const prev = payload({ organic: [organicRow({ position: 1, domain: "nike.com" })] });
    const next = payload({ organic: [organicRow({ position: 3, domain: "nike.com" })] });
    expect(diffGoogleSerpSnapshots(prev, next)).toEqual([]);
  });

  it("fires when the own domain moves up 3 organic positions (6 -> 3)", () => {
    const prev = payload({ organic: [organicRow({ position: 6, domain: "nike.com" })] });
    const next = payload({ organic: [organicRow({ position: 3, domain: "nike.com" })] });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.eventType).toBe("website_page_changed");
    expect(changes[0]?.metadata).toEqual({
      category: "own_domain_move",
      domain: "nike.com",
      from: 6,
      to: 3,
      delta: -3,
    });
    expect(categories(changes)).toEqual(["own_domain_move"]);
    expect(changes[0]?.title).toContain("up");
    expect(changes[0]?.title).toContain("3");
  });

  it("fires when the own domain drops out of the top 10", () => {
    const prev = payload({
      organic: [organicRow({ position: 6, domain: "nike.com" }), organicRow({ position: 8, domain: "adidas.com" })],
    });
    const next = payload({ organic: [organicRow({ position: 8, domain: "adidas.com" })] });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.eventType).toBe("website_page_removed");
    expect(changes[0]?.metadata).toEqual({
      category: "own_domain_left_top10",
      domain: "nike.com",
      from: 6,
    });
    expect(categories(changes)).toEqual(["own_domain_left_top10"]);
    expect(changes[0]?.summary).toContain("nike.com");
  });

  it("fires when the own domain enters the top 10 at 8", () => {
    const prev = payload({ organic: [organicRow({ position: 3, domain: "adidas.com" })] });
    const next = payload({
      organic: [organicRow({ position: 3, domain: "adidas.com" }), organicRow({ position: 8, domain: "nike.com" })],
    });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.eventType).toBe("website_page_added");
    expect(changes[0]?.metadata).toEqual({
      category: "own_domain_entered_top10",
      domain: "nike.com",
      to: 8,
    });
    expect(categories(changes)).toEqual(["own_domain_entered_top10"]);
    expect(changes[0]?.summary).toContain("nike.com");
  });

  it("does not also report the own domain entering as a new_top10_domain", () => {
    const prev = payload({ organic: [organicRow({ position: 2, domain: "old.com" })] });
    const next = payload({
      organic: [
        organicRow({ position: 1, domain: "adidas.com" }),
        organicRow({ position: 8, domain: "nike.com" }),
        organicRow({ position: 9, domain: "old.com" }),
      ],
    });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(categories(changes)).toEqual(["own_domain_entered_top10", "new_top10_domains"]);
    const newDomains = changes.find(
      (change) => (change.metadata as { category?: string }).category === "new_top10_domains",
    );
    // adidas.com is the only genuinely new other domain; nike.com (the own
    // domain) is excluded, and old.com was already there.
    expect(newDomains?.metadata).toEqual({
      category: "new_top10_domains",
      domains: ["adidas.com"],
    });
    expect(newDomains?.eventType).toBe("website_page_added");
  });

  it("detects another domain entering the top 10", () => {
    const prev = payload({
      organic: [organicRow({ position: 1, domain: "nike.com" }), organicRow({ position: 5, domain: "old.com" })],
    });
    const next = payload({
      organic: [
        organicRow({ position: 1, domain: "nike.com" }),
        organicRow({ position: 4, domain: "new.com" }),
        organicRow({ position: 5, domain: "old.com" }),
      ],
    });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.eventType).toBe("website_page_added");
    expect(changes[0]?.metadata).toEqual({ category: "new_top10_domains", domains: ["new.com"] });
    expect(categories(changes)).toEqual(["new_top10_domains"]);
  });

  it("matches the own domain case-insensitively across snapshots", () => {
    // Same domain, different casing and a "www." prefix on the previous side.
    // A case-sensitive match would read "Nike.com" as gone and "nike.com" as
    // newly arrived, emitting two changes. The documented choice is a
    // case-insensitive (and www-insensitive) domain match, so this is a
    // no-change transition.
    const prev = payload({
      domain: "Nike.com",
      organic: [
        organicRow({ position: 1, domain: "NIKE.COM" }),
        organicRow({ position: 4, domain: "adidas.com" }),
      ],
    });
    const next = payload({
      domain: "nike.com",
      organic: [
        organicRow({ position: 1, domain: "Nike.com" }),
        organicRow({ position: 4, domain: "adidas.com" }),
      ],
    });
    expect(diffGoogleSerpSnapshots(prev, next)).toEqual([]);

    // ...and a real move across that casing difference still fires.
    const moved = payload({
      domain: "nike.com",
      organic: [organicRow({ position: 4, domain: "Nike.com" }), organicRow({ position: 5, domain: "adidas.com" })],
    });
    const moveChanges = diffGoogleSerpSnapshots(prev, moved);
    expect(categories(moveChanges)).toEqual(["own_domain_move"]);
    expect(moveChanges[0]?.metadata).toEqual({
      category: "own_domain_move",
      domain: "nike.com",
      from: 1,
      to: 4,
      delta: 3,
    });

    // A previous row stored with a "www." prefix is the same domain too.
    const wwwPrev = payload({
      domain: "nike.com",
      organic: [
        organicRow({ position: 2, domain: "www.nike.com" }),
        organicRow({ position: 4, domain: "adidas.com" }),
      ],
    });
    expect(diffGoogleSerpSnapshots(wwwPrev, next)).toEqual([]);
  });

  it("returns no changes and never throws when the next payload is malformed", () => {
    // A well-formed `next` produces three changes against this previous payload
    // (a new advertiser, the own domain moving, a new top-10 domain); a
    // malformed `next` may produce none of them.
    const prev = payload({
      ads: [adRow({ advertiser_domain: "adidas.com" })],
      organic: [
        organicRow({ position: 1, domain: "nike.com" }),
        organicRow({ position: 6, domain: "old.com" }),
      ],
    });
    const moving = {
      ads: [adRow({ advertiser_domain: "adidas.com" }), adRow({ advertiser_domain: "reebok.com" })],
      organic: [organicRow({ position: 4, domain: "nike.com" }), organicRow({ position: 5, domain: "new.com" })],
    };
    expect(diffGoogleSerpSnapshots(prev, payload(moving))).toHaveLength(3);

    const missingOrganic = payload(moving);
    delete (missingOrganic as { organic?: unknown }).organic;
    expect(diffGoogleSerpSnapshots(prev, missingOrganic)).toEqual([]);

    const missingAdvertisers = payload(moving);
    delete (missingAdvertisers as { sponsoredAdvertisers?: unknown }).sponsoredAdvertisers;
    expect(diffGoogleSerpSnapshots(prev, missingAdvertisers)).toEqual([]);

    const wrongTypes = payload(moving);
    (wrongTypes as { organic: unknown }).organic = "not-an-array";
    (wrongTypes as { sponsoredAdvertisers: unknown }).sponsoredAdvertisers = { a: 1 };
    expect(diffGoogleSerpSnapshots(prev, wrongTypes)).toEqual([]);
  });

  it("guards the previous payload per category instead of all-or-nothing", () => {
    const ads = [adRow({ advertiser_domain: "adidas.com" })];
    const rows = [
      organicRow({ position: 1, domain: "nike.com" }),
      organicRow({ position: 5, domain: "other.com" }),
    ];

    // Usable advertisers, no organic block: the advertiser change still fires,
    // and the missing organic list is not read as the own domain vanishing.
    const noOrganic = payload({ ads, organic: rows });
    delete (noOrganic as { organic?: unknown }).organic;
    const adOnly = diffGoogleSerpSnapshots(
      noOrganic,
      payload({
        ads: [...ads, adRow({ advertiser_domain: "reebok.com" })],
        organic: [organicRow({ position: 4, domain: "nike.com" }), organicRow({ position: 5, domain: "new.com" })],
      }),
    );
    expect(categories(adOnly)).toEqual(["new_sponsored_advertisers"]);
    expect(adOnly[0]?.metadata).toEqual({
      category: "new_sponsored_advertisers",
      advertiserDomains: ["reebok.com"],
    });

    // Usable organic, no advertiser block: the organic change still fires, and
    // the missing advertiser list is not read as every advertiser leaving.
    const noAdvertisers = payload({ ads, organic: rows });
    delete (noAdvertisers as { sponsoredAdvertisers?: unknown }).sponsoredAdvertisers;
    const organicOnly = diffGoogleSerpSnapshots(
      noAdvertisers,
      payload({
        ads: [...ads, adRow({ advertiser_domain: "reebok.com" })],
        organic: [organicRow({ position: 4, domain: "nike.com" }), organicRow({ position: 5, domain: "other.com" })],
      }),
    );
    expect(categories(organicOnly)).toEqual(["own_domain_move"]);
    expect(organicOnly[0]?.metadata).toEqual({
      category: "own_domain_move",
      domain: "nike.com",
      from: 1,
      to: 4,
      delta: 3,
    });
  });

  it("treats a subdomain of the own domain as the own domain", () => {
    // The watchlist domain is the registrable domain while an organic row
    // stores the raw host, so an exact match would read the own subdomain as a
    // different domain.
    const storeAt1 = payload({
      organic: [organicRow({ position: 1, domain: "store.nike.com", url: "https://store.nike.com/" })],
    });
    const storeAt4 = payload({
      organic: [organicRow({ position: 4, domain: "store.nike.com", url: "https://store.nike.com/" })],
    });
    const move = diffGoogleSerpSnapshots(storeAt1, storeAt4);
    expect(categories(move)).toEqual(["own_domain_move"]);
    expect(move[0]?.metadata).toEqual({
      category: "own_domain_move",
      domain: "nike.com",
      from: 1,
      to: 4,
      delta: 3,
    });

    // Entering and leaving are the own domain's rules too.
    const absent = payload({ organic: [organicRow({ position: 2, domain: "adidas.com" })] });
    const present = payload({
      organic: [
        organicRow({ position: 2, domain: "adidas.com" }),
        organicRow({ position: 7, domain: "store.nike.com" }),
      ],
    });
    const entered = diffGoogleSerpSnapshots(absent, present);
    expect(categories(entered)).toEqual(["own_domain_entered_top10"]);
    expect(entered[0]?.metadata).toEqual({
      category: "own_domain_entered_top10",
      domain: "nike.com",
      to: 7,
    });
    const gone = diffGoogleSerpSnapshots(present, absent);
    expect(categories(gone)).toEqual(["own_domain_left_top10"]);
    expect(gone[0]?.metadata).toEqual({ category: "own_domain_left_top10", domain: "nike.com", from: 7 });

    // ...and the subdomain is excluded from the new_top10_domains list.
    const withOtherNewDomain = diffGoogleSerpSnapshots(
      absent,
      payload({
        organic: [
          organicRow({ position: 2, domain: "adidas.com" }),
          organicRow({ position: 7, domain: "store.nike.com" }),
          organicRow({ position: 9, domain: "new.com" }),
        ],
      }),
    );
    expect(categories(withOtherNewDomain)).toEqual(["own_domain_entered_top10", "new_top10_domains"]);
    expect(withOtherNewDomain[1]?.metadata).toEqual({
      category: "new_top10_domains",
      domains: ["new.com"],
    });
  });

  it("does not throw and excludes nothing when next.domain is blank", () => {
    const prev = payload({ organic: [organicRow({ position: 2, domain: "adidas.com" })] });
    const next = payload({
      domain: "",
      organic: [
        organicRow({ position: 1, domain: "adidas.com" }),
        organicRow({ position: 3, domain: "new.com" }),
      ],
    });

    let changes: ReturnType<typeof diffGoogleSerpSnapshots> = [];
    expect(() => {
      changes = diffGoogleSerpSnapshots(prev, next);
    }).not.toThrow();
    // With no own domain there is nothing to exclude, so every domain that
    // arrived is reported.
    expect(categories(changes)).toEqual(["new_top10_domains"]);
    expect(changes[0]?.metadata).toEqual({ category: "new_top10_domains", domains: ["new.com"] });
  });

  it("emits only event types the watch event contract allows, one entry per category", () => {
    const prev = payload({
      ads: [adRow({ advertiser_domain: "adidas.com" }), adRow({ advertiser_domain: "puma.com" })],
      organic: [
        organicRow({ position: 1, domain: "nike.com" }),
        organicRow({ position: 6, domain: "old.com" }),
      ],
    });
    const next = payload({
      ads: [adRow({ advertiser_domain: "adidas.com" }), adRow({ advertiser_domain: "reebok.com" })],
      organic: [
        organicRow({ position: 3, domain: "new.com" }),
        organicRow({ position: 5, domain: "nike.com" }),
      ],
    });

    const changes = diffGoogleSerpSnapshots(prev, next);
    expect(categories(changes)).toEqual([
      "new_sponsored_advertisers",
      "removed_sponsored_advertisers",
      "own_domain_move",
      "new_top10_domains",
    ]);
    expect(changes).toHaveLength(4);
    for (const change of changes) {
      expect(WATCH_EVENT_TYPES).toContain(change.eventType);
      expect(change.title.length).toBeGreaterThan(0);
      expect(change.summary.length).toBeGreaterThan(0);
    }

    // The other two allowed event types come out of the enter/leave rules.
    // other.com stays in the top 10 on both sides, so the own domain leaving
    // is its own entry, and third.com arriving is a separate one.
    const left = diffGoogleSerpSnapshots(
      payload({
        organic: [
          organicRow({ position: 2, domain: "nike.com" }),
          organicRow({ position: 5, domain: "other.com" }),
        ],
      }),
      payload({
        organic: [
          organicRow({ position: 2, domain: "other.com" }),
          organicRow({ position: 5, domain: "third.com" }),
        ],
      }),
    );
    expect(left.map((change) => change.eventType)).toEqual([
      "website_page_removed",
      "website_page_added",
    ]);
    expect(left[0]?.metadata).toEqual({ category: "own_domain_left_top10", domain: "nike.com", from: 2 });
    expect(left[1]?.metadata).toEqual({ category: "new_top10_domains", domains: ["third.com"] });
    for (const change of left) expect(WATCH_EVENT_TYPES).toContain(change.eventType);

    const entered = diffGoogleSerpSnapshots(
      payload({ organic: [organicRow({ position: 2, domain: "other.com" })] }),
      payload({ organic: [organicRow({ position: 2, domain: "nike.com" })] }),
    );
    expect(entered.map((change) => change.eventType)).toEqual(["website_page_added"]);
    expect(entered[0]?.metadata).toEqual({ category: "own_domain_entered_top10", domain: "nike.com", to: 2 });
    expect(WATCH_EVENT_TYPES).toContain(entered[0]?.eventType);
  });
});
