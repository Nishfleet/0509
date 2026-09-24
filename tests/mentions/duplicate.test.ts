import { describe, expect, it } from "vitest";

import {
  appendSighting,
  canonicalAfterCollapse,
  isGoogleNewsUrl,
  normalizeTitle,
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

  it("treats case and extra spaces as the same headline", () => {
    expect(normalizeTitle("  Opens   a Flagship ")).toBe("opens a flagship");
    expect(normalizeTitle("OPENS A FLAGSHIP")).toBe(normalizeTitle("opens a flagship"));
    expect(normalizeTitle("Opens a flagship")).not.toBe(normalizeTitle("Opens a second store"));
  });

  it("leaves a stored engagement bag alone when it is not an object", () => {
    const sighting = {
      source_id: "src_mentions_gdelt",
      url: PUBLISHER,
      title: "Same story",
      seen_at: "2026-09-24T03:00:00.000Z",
    };
    expect(() => appendSighting("{", sighting)).toThrow(SyntaxError);
    expect(() => appendSighting("[]", sighting)).toThrow();
    expect(() => appendSighting("null", sighting)).toThrow();
  });

  it("refuses a value that is not a URL", () => {
    expect(() => isGoogleNewsUrl("not a url")).toThrow(TypeError);
  });
});
