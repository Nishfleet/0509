import { describe, expect, it } from "vitest";

import { normalizeTitle, normalizeUrl, normUrlHash, titleHash } from "../../app/lib/mentions/normalize";
import { duplicateSignalState, type DuplicateSide } from "../../app/lib/mentions/questions";

describe("normalizeUrl", () => {
  it("lowercases the host, drops www, utm params, fragment and trailing slash", () => {
    expect(normalizeUrl("https://WWW.Example.com/Story/?utm_source=a&utm_medium=b#top")).toBe("example.com/Story");
  });

  it("keeps other query params and treats http and https alike", () => {
    expect(normalizeUrl("http://example.com/p?id=7&utm_campaign=x")).toBe("example.com/p?id=7");
    expect(normalizeUrl("http://example.com/p?id=7")).toBe(normalizeUrl("https://example.com/p?id=7"));
  });

  it("falls back to the trimmed lowercase text when the url does not parse", () => {
    expect(normalizeUrl("  Not A Url ")).toBe("not a url");
  });
});

describe("normalizeTitle", () => {
  it("lowercases and collapses punctuation and whitespace", () => {
    expect(normalizeTitle("  Quillon:  Opens -- a London   Flagship! ")).toBe("quillon opens a london flagship");
  });

  it("keeps letters and digits from any script", () => {
    expect(normalizeTitle("Café 24/7 東京")).toBe("café 24 7 東京");
  });
});

describe("hashes", () => {
  it("are 64 hex chars and equal for equal normal forms", async () => {
    expect(await titleHash("A, b!")).toMatch(/^[0-9a-f]{64}$/);
    expect(await titleHash("A, b!")).toBe(await titleHash("a b"));
    expect(await normUrlHash("https://www.x.com/a/")).toBe(await normUrlHash("https://x.com/a"));
  });
});

describe("duplicateSignalState", () => {
  const first: DuplicateSide = {
    id: "sig-b",
    title: "T",
    url: "https://x.com/b",
    publishedAt: null,
    publisher: "B Daily",
    source: "gdelt.doc",
  };
  const second: DuplicateSide = { ...first, id: "sig-a", url: "https://y.com/a", publisher: "A Post" };

  it("orders the pair by id so both directions give the same state, and carries no id or body", () => {
    const one = duplicateSignalState({ subject: { name: "Quillon", domain: "q.com" }, first, second });
    const two = duplicateSignalState({ subject: { name: "Quillon", domain: "q.com" }, first: second, second: first });
    expect(one).toEqual(two);
    expect(JSON.stringify(one)).not.toContain("sig-");
    expect(Object.keys((one as { a: object }).a).sort()).toEqual([
      "published_at",
      "publisher",
      "source",
      "title",
      "url",
    ]);
    expect((one as { a: { publisher: string } }).a.publisher).toBe("A Post");
  });
});
