import { describe, expect, it } from "vitest";

import {
  appendSighting,
  canonicalAfterCollapse,
  isGoogleNewsUrl,
  normalizeTitle,
  packDuplicate,
} from "../../workers/jev/context-pack";

const GOOGLE = "https://news.google.com/rss/articles/story";
const PUBLISHER = "https://news.example.com/story";

describe("mention duplicate collapse", () => {
  it("treats a news.google.com host as provisional and a publisher URL as real", () => {
    expect(isGoogleNewsUrl(GOOGLE)).toBe(true);
    expect(isGoogleNewsUrl("https://news.google.com.evil.test/rss")).toBe(false);
    expect(isGoogleNewsUrl(PUBLISHER)).toBe(false);
    expect(canonicalAfterCollapse(GOOGLE, PUBLISHER)).toBe(PUBLISHER);
    expect(canonicalAfterCollapse(PUBLISHER, GOOGLE)).toBe(PUBLISHER);
    expect(canonicalAfterCollapse(PUBLISHER, "https://other.example.com/story")).toBe(PUBLISHER);
  });

  it("appends a sighting without dropping an existing publisher field", () => {
    const json = appendSighting(JSON.stringify({ publisher: "Example" }), {
      source_id: "src_mentions_gdelt",
      url: PUBLISHER,
      title: "Same story",
      seen_at: "2026-09-24T03:00:00.000Z",
    });
    expect(JSON.parse(json)).toEqual({
      publisher: "Example",
      sightings: [
        {
          source_id: "src_mentions_gdelt",
          url: PUBLISHER,
          title: "Same story",
          seen_at: "2026-09-24T03:00:00.000Z",
        },
      ],
    });
  });

  it("packs both items with their url and title hashes", () => {
    const pack = packDuplicate({
      subject: { name: "Zephyrwear", domain: "zephyrwear.example", role: "competitor" },
      item: {
        title: "Opens a flagship",
        publisher: null,
        url: PUBLISHER,
        published_at: null,
        reliability: "official_api",
        url_hash: "abc",
        title_hash: "def",
      },
      other: {
        id: "prior",
        kind: "mention",
        title: "Opens a flagship",
        url: GOOGLE,
        date: "2026-09-23T03:00:00.000Z",
        url_hash: "ghi",
        title_hash: "def",
      },
    });
    expect(pack.item.url_hash).toBe("abc");
    expect(pack.other.url_hash).toBe("ghi");
    expect(normalizeTitle("  Opens   a Flagship ")).toBe("opens a flagship");
  });
});
