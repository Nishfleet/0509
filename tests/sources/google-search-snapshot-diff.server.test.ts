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
