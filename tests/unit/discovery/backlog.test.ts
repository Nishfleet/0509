import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { withBacklog } from "../../../app/lib/discovery/run.server";
import { nameKey } from "../../../app/lib/discovery/shortlist";
import type { Candidate, Evidence, GeneratorKey } from "../../../app/lib/discovery/types";

function ev(sourceUrl: string, generator: GeneratorKey): Evidence {
  return { sourceUrl, excerpt: "", generator };
}

function candidate(name: string, generator: GeneratorKey, sourceUrl: string): Candidate {
  return { name, evidence: [ev(sourceUrl, generator)] };
}

function dual(name: string, index: number): Candidate {
  return {
    name,
    evidence: [
      ev(`https://news.example.com/${index}`, "news"),
      ev(`https://hn.example.com/${index}`, "hn"),
    ],
  };
}

const twentyDuals = Array.from({ length: 20 }, (_, index) => dual(`Cand${index}`, index));

const BACKLOG_NEWS = {
  name: "Backlog News",
  evidence: [ev("https://news.example.com/backlog", "news")],
} satisfies Candidate;

const STRONGER_FRESH_NEWS: Candidate = {
  name: "Fresh Sole News",
  evidence: [ev("https://first.example/1", "news"), ev("https://second.example/2", "news")],
};

describe("withBacklog", () => {
  it("keeps a backlog candidate with no new source in rest and out of promoted", () => {
    const { entries, rest, promoted } = withBacklog([...twentyDuals, STRONGER_FRESH_NEWS], [BACKLOG_NEWS]);
    expect(entries.some((entry) => entry.name === BACKLOG_NEWS.name)).toBe(false);
    expect(rest.find((row) => row.name === BACKLOG_NEWS.name)?.nameKey).toBe(nameKey(BACKLOG_NEWS.name));
    expect(promoted).not.toContain(nameKey(BACKLOG_NEWS.name));
  });

  it("promotes a backlog candidate once a second source names it", () => {
    const { entries, rest, promoted } = withBacklog(
      [...twentyDuals, candidate("Backlog News", "hn", "https://hn.example.com/backlog")],
      [BACKLOG_NEWS],
    );
    const merged = entries.find((entry) => entry.name === BACKLOG_NEWS.name);
    expect(merged?.generators).toEqual(["news", "hn"]);
    expect(merged?.evidence).toHaveLength(2);
    expect(promoted).toContain(nameKey(BACKLOG_NEWS.name));
    expect(rest.some((row) => row.name === BACKLOG_NEWS.name)).toBe(false);
  });

  it("returns a fresh candidate that made no shortlist slot in rest with its nameKey", () => {
    const freshUnplaced = dual("Fresh Unplaced", 99);
    const { entries, rest } = withBacklog(
      [...twentyDuals, STRONGER_FRESH_NEWS, freshUnplaced],
      [BACKLOG_NEWS],
    );
    expect(entries.some((entry) => entry.name === freshUnplaced.name)).toBe(false);
    expect(rest.find((row) => row.name === freshUnplaced.name)?.nameKey).toBe(nameKey(freshUnplaced.name));
  });

  it("fills the sole-generator guarantee slot with a backlog candidate", () => {
    const { entries, rest, promoted } = withBacklog(twentyDuals, [BACKLOG_NEWS]);
    const guaranteed = entries.find((entry) => entry.name === BACKLOG_NEWS.name);
    expect(guaranteed?.slot).toBe("guaranteed");
    expect(promoted).toEqual([nameKey(BACKLOG_NEWS.name)]);
    expect(rest.some((row) => row.name === BACKLOG_NEWS.name)).toBe(false);
  });
});
