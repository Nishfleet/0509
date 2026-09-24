import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { hnGenerator } from "../../../app/lib/discovery/generators/hn";
import { newsGenerator } from "../../../app/lib/discovery/generators/news";
import { evidenceLine, shortlist } from "../../../app/lib/discovery/shortlist";
import type { Candidate, FetchedText, Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com" };

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

const HN_FIXTURE = readFileSync(join(FIXTURES_DIR, "hn-gymshark.json"), "utf8");
const NEWS_FIXTURE = readFileSync(join(FIXTURES_DIR, "gnews-gymshark.xml"), "utf8");

function fetchTextWith(body: string): (url: string) => Promise<FetchedText> {
  return (url) => Promise.resolve({ ok: true, url, contentType: null, body });
}

function publisherHost(sourceUrl: string): string | null {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
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

    type Grouped = {
      name: string;
      generators: Set<string>;
      publishers: Set<string>;
    };
    const grouped = new Map<string, Grouped>();
    for (const candidate of combined) {
      const key = candidate.name.toLowerCase();
      const existing = grouped.get(key);
      const record: Grouped =
        existing ?? { name: candidate.name, generators: new Set<string>(), publishers: new Set<string>() };
      for (const item of candidate.evidence) {
        record.generators.add(item.generator);
        if (item.generator !== "news") continue;
        const host = publisherHost(item.sourceUrl);
        if (host !== null) record.publishers.add(host);
      }
      grouped.set(key, record);
    }

    const shortlistedNames = new Set(lowercaseNames);
    const rows: Row[] = [];
    for (const [key, record] of grouped) {
      const entry = entries.find((item) => item.name.toLowerCase() === key);
      rows.push({
        candidate: record.name,
        generators: [...record.generators].join("+"),
        publishers: record.publishers.size,
        shortlisted: entry === undefined ? "no" : "yes",
        why: entry === undefined ? "outside top 20" : entry.slot,
        line: entry === undefined ? "" : evidenceLine(entry),
      });
    }

    console.table(rows, ["candidate", "generators", "publishers", "shortlisted", "why", "line"]);
  });
});
