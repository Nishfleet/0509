import { describe, expect, it } from "vitest";

import {
  evidenceLine,
  GENERATOR_ORDER,
  SHORTLIST_TOP,
  nameKey,
  partitionShortlist,
  shortlist,
  type ShortlistEntry,
} from "../../../app/lib/discovery/shortlist";
import type { Candidate, Evidence, GeneratorKey } from "../../../app/lib/discovery/types";

function ev(sourceUrl: string, generator: GeneratorKey): Evidence {
  return { sourceUrl, excerpt: "", generator };
}

function candidate(name: string, generator: GeneratorKey, sourceUrl: string, domain?: string): Candidate {
  return { name, domain, evidence: [ev(sourceUrl, generator)] };
}

function dual(name: string, index: number): Candidate {
  return {
    name,
    evidence: [ev(`https://news.example.com/${index}`, "news"), ev(`https://hn.example.com/${index}`, "hn")],
  };
}

describe("shortlist", () => {
  it("merges two spellings of one name and orders generators by GENERATOR_ORDER", () => {
    const result = shortlist([
      candidate("Lush", "hn", "https://news.ycombinator.com/item?id=1"),
      candidate("lush ", "news", "https://news.google.com/articles/1"),
    ]);
    const merged: ShortlistEntry = result[0];
    expect(result).toHaveLength(1);
    expect(merged.name).toBe("Lush");
    expect(merged.nameKeys).toEqual([nameKey("lush ")]);
    expect(merged.generators).toEqual(GENERATOR_ORDER.slice(0, 2));
    expect(merged.evidence).toHaveLength(2);
  });

  it("counts an article once when two candidates name it (0509#4745)", () => {
    const url = "https://news.google.com/articles/same";
    const { entries } = partitionShortlist([
      candidate("Lush", "news", url),
      candidate("Lush", "news", url),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].evidence).toHaveLength(1);
  });

  it("returns every candidate the shortlist did not place as rest (0509#4745)", () => {
    const duals = Array.from({ length: 21 }, (_, index) => dual(`Cand${index}`, index));
    const hnOnly = candidate("Solo HN", "hn", "https://hn.example.com/solo");
    const newsOnly = candidate("Solo News", "news", "https://news.example.com/solo");
    const input = [...duals, hnOnly, newsOnly];
    const { entries, rest } = partitionShortlist(input);
    const entryNames = new Set(entries.map((entry) => entry.name));
    expect(rest.map((notPlaced) => notPlaced.name)).toEqual(
      input
        .filter((notPlaced) => !entryNames.has(notPlaced.name))
        .map((notPlaced) => notPlaced.name),
    );
    expect(entries.length + rest.length).toBe(
      new Set(input.map((each) => each.name)).size,
    );
  });

  it("merges two different names that resolve to one domain key", () => {
    const result = shortlist([
      candidate("Alpha Athletics", "news", "https://news.google.com/articles/2", "www.lush.com"),
      candidate("Lush Cosmetics", "hn", "https://news.ycombinator.com/item?id=2", "lush.com"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Athletics");
    expect(result[0].domain).toBe("www.lush.com");
  });

  it("counts one publisher once across its subdomains and groups a brand's subdomain with it (0509#4639)", () => {
    const result = shortlist([
      {
        name: "Lush",
        domain: "shop.lush.co.uk",
        evidence: [ev("https://edition.cnn.com/a", "news"), ev("https://www.cnn.com/b", "news")],
      },
      candidate("Lush UK", "hn", "https://news.ycombinator.com/item?id=3", "www.lush.co.uk"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].publishers).toEqual(["cnn.com", "ycombinator.com"]);
  });

  it("counts distinct publishers and tolerates an unparseable source URL", () => {
    const result = shortlist([
      {
        name: "Publisher",
        evidence: [
          ev("https://www.glamourmagazine.co.uk/a", "news"),
          ev("https://glamourmagazine.co.uk/b", "news"),
        ],
      },
      candidate("Bad Url", "news", "not a url"),
    ]);
    const publisher = result.find((entry) => entry.name === "Publisher");
    const badUrl = result.find((entry) => entry.name === "Bad Url");
    expect(publisher?.publishers).toEqual(["glamourmagazine.co.uk"]);
    expect(badUrl?.publishers).toEqual([]);
  });

  it("keeps a guaranteed slot per generator beyond the top twenty", () => {
    const duals = Array.from({ length: 25 }, (_, index) => dual(`Cand${index}`, index));
    const hnOnly = candidate("Solo HN", "hn", "https://hn.example.com/solo");
    const result = shortlist([...duals, hnOnly]);
    expect(result).toHaveLength(SHORTLIST_TOP + 1);
    expect(result.slice(0, SHORTLIST_TOP).every((entry) => entry.slot === "top")).toBe(true);
    expect(result[SHORTLIST_TOP].slot).toBe("guaranteed");
    expect(result[SHORTLIST_TOP].generators).toEqual(["hn"]);
    expect(result[SHORTLIST_TOP].evidence).toHaveLength(1);
  });

  it("adds no guarantee for a generator already inside the top twenty", () => {
    const duals = Array.from({ length: 5 }, (_, index) => dual(`Five${index}`, index));
    const hnOnly = candidate("Small HN", "hn", "https://hn.example.com/small");
    const result = shortlist([...duals, hnOnly]);
    expect(result).toHaveLength(6);
    expect(result.every((entry) => entry.slot === "top")).toBe(true);
    expect(result.some((entry) => entry.slot === "guaranteed")).toBe(false);
  });

  it("sorts a two-generator candidate above a one-generator, three-publisher one", () => {
    const twoGenerators: Candidate = {
      name: "Two Generators",
      evidence: [ev("https://a.example/1", "news"), ev("https://b.example/1", "hn")],
    };
    const threePublishers: Candidate = {
      name: "Three Publishers",
      evidence: [
        ev("https://p1.example/x", "news"),
        ev("https://p2.example/x", "news"),
        ev("https://p3.example/x", "news"),
      ],
    };
    const result = shortlist([twoGenerators, threePublishers]);
    expect(result[0].name).toBe("Two Generators");
    expect(result[1].name).toBe("Three Publishers");
  });

  it("keeps first-seen input order when the sort keys tie", () => {
    const result = shortlist([
      candidate("First Seen", "news", "https://x.example/a"),
      candidate("Second Seen", "news", "https://x.example/b"),
    ]);
    expect(result.map((entry) => entry.name)).toEqual(["First Seen", "Second Seen"]);
  });

  it("returns an empty list for no candidates", () => {
    expect(shortlist([])).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input: Candidate[] = [
      candidate("Lush", "news", "https://news.google.com/articles/3", "www.lush.com"),
      candidate("lush", "hn", "https://news.ycombinator.com/item?id=3", "lush.com"),
      { name: "", evidence: [] },
    ];
    const before = structuredClone(input);
    expect(shortlist(input)).toHaveLength(1);
    expect(input).toEqual(before);
  });

  it("builds an evidence line from news publishers and hn threads", () => {
    const entry: ShortlistEntry = {
      name: "Alpha",
      evidence: [
        ev("https://www.glamourmagazine.co.uk/a", "news"),
        ev("https://glamourmagazine.co.uk/b", "news"),
        ev("https://www.vogue.co.uk/c", "news"),
        ev("https://news.ycombinator.com/item?id=1", "hn"),
      ],
      generators: ["news", "hn"],
      publishers: ["glamourmagazine.co.uk", "vogue.co.uk"],
      slot: "top",
    };
    expect(evidenceLine(entry)).toBe(
      "named by 2 news publishers, mentioned in 1 Hacker News thread",
    );
  });

  it("builds an evidence line for ads-only entries", () => {
    const entry: ShortlistEntry = {
      name: "Beta",
      evidence: [{ sourceUrl: "https://ads.example.com", excerpt: "", generator: "ads" }],
      generators: ["ads"],
      publishers: [],
      slot: "top",
    };
    expect(evidenceLine(entry)).toBe("advertises in the same category");
  });
});
