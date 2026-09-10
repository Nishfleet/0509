import { describe, expect, it } from "vitest";

import {
  buildSnapshotPayload,
  diffGoogleSerpSnapshots,
  type GoogleSerpSnapshotPayload,
} from "~/lib/sources/google-search/google-serp-snapshot.server";
import type { SerpAd, SerpOrganic } from "~/lib/sources/google-search/serp-provider";

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
