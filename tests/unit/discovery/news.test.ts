import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { newsGenerator } from "../../../app/lib/discovery/generators/news";
import type { FetchedText, Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com" };

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/gdelt-gymshark.json"),
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

const MULTIBRAND_TITLE = "Gymshark, Adanola and Bratz launch activewear capsule";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("newsGenerator", () => {
  it("reads the live Gymshark fixture into candidates that each carry GDELT evidence", async () => {
    const candidates = await newsGenerator(SUBJECT, fetchTextWith(FIXTURE));
    console.log(
      "gymshark candidates:",
      candidates.map((candidate) => `${candidate.name} (${candidate.evidence.length})`).join(", "),
    );

    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
      for (const evidence of candidate.evidence) {
        expect(evidence.generator).toBe("news");
        expect(evidence.sourceUrl).toContain(".");
      }
      expect(candidate.name.toLowerCase()).not.toBe("gymshark");
    }
  });

  it("reads the co-mentioned brands out of one article with the publisher domain as evidence", async () => {
    const body = JSON.stringify({
      articles: [
        {
          url: "https://www.glamourmagazine.co.uk/style/gymshark-vs-vestiaire",
          title: "Gymshark, Vestiaire and Bratz lead activewear",
          seendate: "20260922T110000Z",
          domain: "glamourmagazine.co.uk",
        },
      ],
    });

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates.map((candidate) => candidate.name)).toEqual(["Vestiaire", "Bratz"]);
    for (const candidate of candidates) {
      expect(candidate.evidence[0]?.sourceUrl).toBe("glamourmagazine.co.uk");
      expect(candidate.evidence[0]?.excerpt).toBe(
        "Gymshark, Vestiaire and Bratz lead activewear",
      );
      expect(candidate.evidence[0]?.generator).toBe("news");
    }
  });

  it("keeps the publisher domain for each co-mentioned brand in the same article", async () => {
    const body = JSON.stringify({
      articles: [
        {
          url: "https://hypebae.com/gymshark-adanola-bratz",
          title: MULTIBRAND_TITLE,
          seendate: "20260920T070000Z",
          domain: "hypebae.com",
        },
      ],
    });

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.name)).toEqual(["Adanola", "Bratz"]);
    for (const candidate of candidates) {
      expect(candidate.evidence[0]?.sourceUrl).toBe("hypebae.com");
    }
  });

  it("still yields the co-mentioned rival when one article carries an empty title", async () => {
    const body = JSON.stringify({
      articles: [
        {
          url: "https://empty.example/untitled",
          title: "",
          seendate: "20260920T070000Z",
          domain: "empty.example",
        },
        {
          url: "https://hypebae.com/gymshark-adanola",
          title: "Gymshark and Adanola launch activewear capsule",
          seendate: "20260921T070000Z",
          domain: "hypebae.com",
        },
      ],
    });

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates.map((candidate) => candidate.name)).toEqual(["Adanola"]);
    expect(candidates[0]?.evidence[0]?.sourceUrl).toBe("hypebae.com");
  });

  it("drops an article that is not an http or https url", async () => {
    const body = JSON.stringify({
      articles: [
        {
          url: "javascript:alert(1)",
          title: "Gymshark, Adanola and Bratz announce partnership",
          seendate: "20260920T070000Z",
          domain: "evil.example",
        },
      ],
    });

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toEqual([]);
  });

  it("ignores an article that carries no publisher domain", async () => {
    const body = JSON.stringify({
      articles: [
        {
          url: "https://www.glamourmagazine.co.uk/style/gymshark-adanola",
          title: "Gymshark, Adanola and Bratz announce partnership",
          seendate: "20260920T070000Z",
          domain: null,
        },
      ],
    });

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toEqual([]);
  });

  it("merges the same co-mentioned brand across two articles into one candidate", async () => {
    const body = JSON.stringify({
      articles: [
        {
          url: "https://www.glamourmagazine.co.uk/style/gymshark-adanola-bratz",
          title: "Gymshark, Adanola and Bratz launch activewear capsule",
          seendate: "20260923T070000Z",
          domain: "glamourmagazine.co.uk",
        },
        {
          url: "https://hypebae.com/gymshark-adanola-bratz",
          title: "Gymshark, Adanola and Bratz launch capsule",
          seendate: "20260920T070000Z",
          domain: "hypebae.com",
        },
      ],
    });

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toHaveLength(2);
    const adanola = candidates.find((candidate) => candidate.name === "Adanola");
    expect(adanola?.evidence.map((evidence) => evidence.sourceUrl)).toEqual([
      "glamourmagazine.co.uk",
      "hypebae.com",
    ]);
  });

  it("requests one GDELT article list with the quoted subject and a 7d window", async () => {
    const urls: string[] = [];
    const record = (url: string): Promise<FetchedText> => {
      urls.push(url);
      return Promise.resolve({ ok: true, status: 200, url, contentType: "application/json", body: "{}" });
    };

    await newsGenerator(SUBJECT, record);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("api.gdeltproject.org");
    expect(urls[0]).toContain("mode=artlist");
    expect(urls[0]).toContain("format=json");
    expect(urls[0]).toContain("maxrecords=50");
    expect(urls[0]).toContain("timespan=7d");
    expect(urls[0]).toContain(encodeURIComponent('"Gymshark"'));
  });

  it("throws naming the generator and status when the request failed", async () => {
    await expect(newsGenerator(SUBJECT, fetchTextWith("", false))).rejects.toThrow(
      "news generator fetch failed with status 503",
    );
  });

  it("throws when the body is not json", async () => {
    await expect(newsGenerator(SUBJECT, fetchTextWith("not json"))).rejects.toThrow(
      "news generator got a non-JSON GDELT body",
    );
  });

  it("logs generator_empty with the article count when no rival is co-mentioned", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const body = JSON.stringify({
      articles: [
        {
          url: "https://example.com/a",
          title: "Gymshark opens a store",
          seendate: "20260920T070000Z",
          domain: "example.com",
        },
      ],
    });

    expect(await newsGenerator(SUBJECT, fetchTextWith(body))).toEqual([]);

    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "discovery.generator_empty", generator: "news", articles: 1 }),
    );
  });
});
