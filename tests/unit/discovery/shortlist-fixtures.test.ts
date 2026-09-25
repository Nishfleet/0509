import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getDomain } from "tldts";
import { describe, expect, it } from "vitest";

import { hnGenerator } from "../../../app/lib/discovery/generators/hn";
import { newsGenerator } from "../../../app/lib/discovery/generators/news";
import { evidenceLine, shortlist } from "../../../app/lib/discovery/shortlist";
import type { Candidate, FetchedText, Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com" };

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

const HN_FIXTURE = readFileSync(join(FIXTURES_DIR, "hn-gymshark.json"), "utf8");
const NEWS_FIXTURE = readFileSync(join(FIXTURES_DIR, "gdelt-gymshark.json"), "utf8");

function fetchTextWith(body: string): (url: string) => Promise<FetchedText> {
  return (url) => Promise.resolve({ ok: true, url, contentType: null, body });
}

interface Grouped {
  name: string;
  generators: Set<string>;
  publishers: Set<string>;
}

interface Row {
  candidate: string;
  generators: string;
  publishers: number;
  shortlisted: string;
  why: string;
  line: string;
}

describe("shortlist fixtures", () => {
  it("builds a shortlist from real generator output and every entry has an evidence line", async () => {
    const newsCandidates = await newsGenerator(SUBJECT, fetchTextWith(NEWS_FIXTURE));
    const hnCandidates = await hnGenerator(SUBJECT, fetchTextWith(HN_FIXTURE));
    const combined: Candidate[] = [...newsCandidates, ...hnCandidates];
    const entries = shortlist(combined);

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.length).toBeLessThanOrEqual(23);

    const lowercaseNames = entries.map((entry) => entry.name.toLowerCase());
    expect(new Set(lowercaseNames).size).toBe(lowercaseNames.length);

    for (const entry of entries) {
      expect(evidenceLine(entry).length).toBeGreaterThan(0);
    }

    const grouped = new Map(
      [...new Set(combined.map((candidate) => candidate.name.toLowerCase()))].map(
        (key): [string, Grouped] => {
          const evidence = combined
            .filter((item) => item.name.toLowerCase() === key)
            .flatMap((item) => item.evidence);
          const name = combined.find((item) => item.name.toLowerCase() === key)?.name ?? key;
          return [
            key,
            {
              name,
              generators: new Set(evidence.map((item) => item.generator)),
              publishers: new Set(
                evidence.flatMap((item) => {
                  if (item.generator !== "news") return [];
                  const publisher = getDomain(item.sourceUrl);
                  return publisher === null ? [] : [publisher];
                }),
              ),
            },
          ];
        },
      ),
    );

    const shortlistedNames = new Set(lowercaseNames);
    const rows: Row[] = [...grouped].map(([key, record]) => {
      const entry = entries.find((item) => item.name.toLowerCase() === key);
      return {
        candidate: record.name,
        generators: [...record.generators].join("+"),
        publishers: record.publishers.size,
        shortlisted: shortlistedNames.has(key) ? "yes" : "no",
        why: entry === undefined ? "outside top 20" : entry.slot,
        line: entry === undefined ? "" : evidenceLine(entry),
      };
    });

    console.table(rows, ["candidate", "generators", "publishers", "shortlisted", "why", "line"]);
  });
});
