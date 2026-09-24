import { describe, expect, it } from "vitest";

import { COVERAGE, FEATURES, LIVE_COVERAGE, WATCHED_NOUNS, WATCHED_ORIGINS, isLive, joinList } from "../../app/lib/coverage";
import { FAQ } from "../../app/lib/faq";
import { llmsTxt } from "../../app/lib/public-routes";
import { softwareApplicationJsonLd } from "../../app/lib/structured-data";

// The homepage, the FAQ, /llms.txt and the JSON-LD featureList all claim
// coverage from one list, app/lib/coverage.ts. A source reaches the public copy
// only once it is marked live there, and tests/integration/coverage.integration.test.ts
// ties "live" to an enabled source row. Launch checklist §3: claim only what works.

const notLive = COVERAGE.filter((group) => group.sources.every((source) => !source.live));

function claims(text: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase}\\b`, "i").test(text);
}

describe("coverage", () => {
  it("keeps only live sources, and drops a kind with none", () => {
    for (const group of LIVE_COVERAGE) {
      expect(group.sources.length).toBeGreaterThan(0);
      for (const source of group.sources) expect(source.live).toBe(true);
    }
    expect(LIVE_COVERAGE.map((group) => group.kind)).not.toEqual(expect.arrayContaining(notLive.map((g) => g.kind)));
  });

  it("gives every source a unique id", () => {
    const ids = COVERAGE.flatMap((group) => group.sources.map((source) => source.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("answers isLive from the live flag", () => {
    for (const group of COVERAGE) {
      for (const source of group.sources) expect(isLive(source.id)).toBe(source.live);
    }
  });

  it("joins lists the way the copy reads", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["ads"])).toBe("ads");
    expect(joinList(["ads", "hiring"])).toBe("ads and hiring");
    expect(joinList(["ads", "website changes", "hiring"])).toBe("ads, website changes, and hiring");
  });

  it("names a watched kind in the summary copy", () => {
    expect(WATCHED_NOUNS).not.toBe("");
    expect(WATCHED_ORIGINS).not.toBe("");
  });

  it("claims no kind that has no live source, in the FAQ, llms.txt or JSON-LD", () => {
    const copy = [
      ...FAQ.flatMap((entry) => [entry.question, entry.answer]),
      llmsTxt("https://0509.io"),
      JSON.stringify(softwareApplicationJsonLd()),
    ].join("\n");
    for (const group of notLive) {
      for (const phrase of [group.kind, group.noun ?? group.kind]) {
        expect(claims(copy, phrase), `"${phrase}" is claimed but ${group.kind} has no live source`).toBe(false);
      }
    }
  });

  it("lists every live source in the JSON-LD featureList", () => {
    expect(softwareApplicationJsonLd().featureList).toEqual(FEATURES);
    expect(FEATURES).toHaveLength(LIVE_COVERAGE.flatMap((group) => group.sources).length);
  });
});
