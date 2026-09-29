import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { hnGenerator } from "../../../app/lib/discovery/generators/hn";
import type { FetchedText, Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com" };

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/hn-gymshark.json"),
  "utf8",
);

function fetchTextWith(body: string, ok = true): (url: string) => Promise<FetchedText> {
  return (url) =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 503,
      url,
      contentType: ok ? "application/json" : null,
      body,
    });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hnGenerator", () => {
  it("reads the live Gymshark fixture into candidates that each carry HN evidence", async () => {
    const candidates = await hnGenerator(SUBJECT, fetchTextWith(FIXTURE));
    console.log(
      "gymshark candidates:",
      candidates.map((candidate) => `${candidate.name} (${candidate.evidence.length})`).join(", "),
    );

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
      for (const evidence of candidate.evidence) {
        expect(evidence.generator).toBe("hn");
        expect(evidence.sourceUrl.startsWith("https://news.ycombinator.com/item?id=")).toBe(true);
      }
      expect(candidate.name.toLowerCase()).not.toBe("gymshark");
    }
  });

  it("reads the two co-mentioned brands out of one hit in first-seen order", async () => {
    const body = JSON.stringify({
      hits: [
        {
          objectID: "42603967",
          title: "Uniqlo, Gymshark and Lush stop hiring UK workers via gig economy apps",
          story_title: null,
        },
      ],
    });

    const candidates = await hnGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toEqual([
      {
        name: "Uniqlo",
        evidence: [
          {
            sourceUrl: "https://news.ycombinator.com/item?id=42603967",
            excerpt: "Uniqlo, Gymshark and Lush stop hiring UK workers via gig economy apps",
            generator: "hn",
          },
        ],
      },
      {
        name: "Lush",
        evidence: [
          {
            sourceUrl: "https://news.ycombinator.com/item?id=42603967",
            excerpt: "Uniqlo, Gymshark and Lush stop hiring UK workers via gig economy apps",
            generator: "hn",
          },
        ],
      },
    ]);
  });

  it("merges the same brand across hits into one candidate with both evidence items", async () => {
    const body = JSON.stringify({
      hits: [
        {
          objectID: "42603967",
          title: "Lush and Gymshark stop hiring UK workers",
          story_title: null,
        },
        {
          objectID: "42603968",
          title: null,
          story_title: "Gymshark vs Lush: which is greener?",
        },
      ],
    });

    const candidates = await hnGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("Lush");
    expect(candidates[0]?.evidence).toHaveLength(2);
    expect(candidates[0]?.evidence.map((evidence) => evidence.sourceUrl)).toEqual([
      "https://news.ycombinator.com/item?id=42603967",
      "https://news.ycombinator.com/item?id=42603968",
    ]);
  });

  it("throws naming the generator and status when the search did not succeed", async () => {
    await expect(hnGenerator(SUBJECT, fetchTextWith("", false))).rejects.toThrow(
      "hn generator fetch failed with status 503",
    );
  });

  it("returns nothing when the body is not JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await hnGenerator(SUBJECT, fetchTextWith("not json"))).toEqual([]);
  });

  it("logs generator_empty with the headline count when no rival is co-mentioned", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const body = JSON.stringify({
      hits: [
        { objectID: "1", title: "Gymshark opens a store", story_title: null },
        { objectID: "2", title: null, story_title: null },
      ],
    });

    expect(await hnGenerator(SUBJECT, fetchTextWith(body))).toEqual([]);

    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "discovery.generator_empty", generator: "hn", articles: 1 }),
    );
  });
});
