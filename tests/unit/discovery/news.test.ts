import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { newsGenerator } from "../../../app/lib/discovery/generators/news";
import type { FetchedText, Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com" };

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/gnews-gymshark.xml"),
  "utf8",
);

function fetchTextWith(body: string, ok = true): (url: string) => Promise<FetchedText> {
  return (url) =>
    Promise.resolve({
      ok,
      url,
      contentType: ok ? "application/rss+xml" : null,
      body,
    });
}

function fetchTextWithBodies(
  alternativesBody: string,
  plainBody: string,
): (url: string) => Promise<FetchedText> {
  return (url) =>
    Promise.resolve({
      ok: true,
      url,
      contentType: "application/rss+xml",
      body: url.includes("alternatives") ? alternativesBody : plainBody,
    });
}

const GLAMOUR_TITLE = "Gymshark vs Alphalete Athletics: which is better? - Glamour UK";

describe("newsGenerator", () => {
  it("reads the live Gymshark fixture into candidates that each carry news evidence", async () => {
    const candidates = await newsGenerator(SUBJECT, fetchTextWith(FIXTURE));
    console.log(
      "gymshark candidates:",
      candidates.map((candidate) => `${candidate.name} (${candidate.evidence.length})`).join(", "),
    );

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
      for (const evidence of candidate.evidence) {
        expect(evidence.generator).toBe("news");
        expect(evidence.sourceUrl.startsWith("https://")).toBe(true);
      }
      expect(candidate.name.toLowerCase()).not.toBe("gymshark");
    }
  });

  it("reads the co-mentioned brand out of one item with the publisher as evidence", async () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Gymshark news</title>
    <link>https://news.google.com/</link>
    <description>Google News</description>
    <item>
      <title>${GLAMOUR_TITLE}</title>
      <link>https://news.google.com/rss/articles/CBMi123</link>
      <pubDate>Mon, 22 Sep 2025 10:00:00 GMT</pubDate>
      <source url="https://www.glamourmagazine.co.uk">Glamour UK</source>
    </item>
  </channel>
</rss>`;

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("Alphalete Athletics");
    expect(candidates[0]?.evidence.length).toBeGreaterThan(0);
    for (const evidence of candidates[0]?.evidence ?? []) {
      expect(evidence.sourceUrl).toBe("https://www.glamourmagazine.co.uk");
      expect(evidence.excerpt).toBe(GLAMOUR_TITLE);
      expect(evidence.generator).toBe("news");
    }
  });

  it("ignores an entry that carries neither a publisher nor a link", async () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Gymshark news</title>
    <link>https://news.google.com/</link>
    <description>Google News</description>
    <item>
      <title>${GLAMOUR_TITLE}</title>
    </item>
  </channel>
</rss>`;

    const candidates = await newsGenerator(SUBJECT, fetchTextWith(body));

    expect(candidates).toEqual([]);
  });

  it("merges the same co-mentioned brand across the two feeds into one candidate", async () => {
    const alternativesBody = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Gymshark news</title>
    <link>https://news.google.com/</link>
    <description>Google News</description>
    <item>
      <title>${GLAMOUR_TITLE}</title>
      <link>https://news.google.com/rss/articles/CBMi123</link>
      <source url="https://www.glamourmagazine.co.uk">Glamour UK</source>
    </item>
  </channel>
</rss>`;
    const plainBody = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Gymshark news</title>
    <link>https://news.google.com/</link>
    <description>Google News</description>
    <item>
      <title>Gymshark and Alphalete Athletics in new collab</title>
      <link>https://news.google.com/rss/articles/CBMi456</link>
    </item>
  </channel>
</rss>`;

    const candidates = await newsGenerator(
      SUBJECT,
      fetchTextWithBodies(alternativesBody, plainBody),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("Alphalete Athletics");
    expect(candidates[0]?.evidence).toHaveLength(2);
    expect(candidates[0]?.evidence.map((evidence) => evidence.sourceUrl)).toEqual([
      "https://www.glamourmagazine.co.uk",
      "https://news.google.com/rss/articles/CBMi456",
    ]);
  });

  it("returns nothing when both feeds failed", async () => {
    const candidates = await newsGenerator(SUBJECT, fetchTextWith("", false));
    expect(candidates).toEqual([]);
  });

  it("returns nothing when the bodies are not xml", async () => {
    const candidates = await newsGenerator(SUBJECT, fetchTextWith("not xml"));
    expect(candidates).toEqual([]);
  });
});
