import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Cite, CompareCitationsFooter, type CompareCitations } from "~/components/compare-citations";

// Issue #2958: competitor comparison pages state hard facts (AdSpy $149/mo,
// 2.4/5 Trustpilot, no self-serve cancel) that go stale. Every claim's source
// in app/data/compare/*-citations.json must therefore carry a "checked" date
// — the date is rendered next to the claim as "as of <date>" by
// CompareCitationsFooter / <Cite>. This test fails when a claim has no date,
// a malformed date, a future date, or a date older than the re-verify window.
// It globs the directory, so a NEW citations file is covered automatically —
// no test registration step to forget. There is no timer: the staleness
// tripwire fires only when the suite runs (CI), which is the "lightweight way
// to re-verify" the issue asks for.

const root = join(__dirname, "..");
const CITATIONS_DIR = join(root, "app", "data", "compare");

// How long a "checked" date may age before the claim must be re-verified.
// Deliberately generous: the point is that dates cannot silently go ancient,
// not that someone must hand-recheck every fortnight.
const STALE_AFTER_DAYS = 120;

interface Source {
  id: string;
  href: string;
  label: string;
  claim: string;
  checked: string;
}

interface CitationsFile {
  competitor: string;
  productName: string;
  sources: Source[];
}

function citationFiles(): string[] {
  return readdirSync(CITATIONS_DIR)
    .filter((name) => name.endsWith("-citations.json"))
    .sort();
}

function ageInDays(iso: string): number {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  const now = Date.parse(new Date().toISOString().slice(0, 10));
  // Both edges are midnight-UTC of their date strings, so the difference is a
  // whole number of days; floor keeps the 120-day bound honest if either edge
  // ever gains a time-of-day (review round 1, issue #2958).
  return Math.floor((now - then) / 86_400_000);
}

describe("compare citations: every claim carries a checked date (issue #2958)", () => {
  it("discovers at least one citations file (rename guard)", () => {
    expect(
      citationFiles().length,
      "no *-citations.json found under app/data/compare — the glob may be pointing at a renamed directory",
    ).toBeGreaterThan(0);
  });

  for (const file of citationFiles()) {
    const citations = JSON.parse(readFileSync(join(CITATIONS_DIR, file), "utf8")) as CitationsFile;
    const competitor = `${citations.productName ?? citations.competitor} (${file})`;

    it(`${competitor} has at least one source`, () => {
      expect(citations.sources, `${competitor} sources`).not.toHaveLength(0);
    });

    for (const source of citations.sources) {
      it(`${competitor}: "${source.id}" has a source URL, a label, and a claim`, () => {
        expect(source.id, "stable citation id").toBeTruthy();
        expect(source.href, "source URL").toMatch(/^https:\/\//u);
        expect(source.label, "human link text").toBeTruthy();
        expect(source.claim, "the claim this source backs").toBeTruthy();
      });

      it(`${competitor}: "${source.id}" has a well-formed, current checked date`, () => {
        expect(source.checked, "checked must be present").toBeTruthy();
        expect(source.checked, "checked must be YYYY-MM-DD").toMatch(/^\d{4}-\d{2}-\d{2}$/u);
        const age = ageInDays(source.checked);
        expect(age, `checked (${source.checked}) must not be in the future`).toBeGreaterThanOrEqual(0);
        expect(
          age,
          `checked (${source.checked}) is ${age}d old — re-verify the source and bump the date`,
        ).toBeLessThanOrEqual(STALE_AFTER_DAYS);
      });
    }

    it(`${competitor}: citation ids are unique`, () => {
      const ids = citations.sources.map((source) => source.id);
      expect(new Set(ids).size, "duplicate citation ids").toBe(ids.length);
    });
  }
});

// The component-level half of the issue: the as-of date must actually survive
// rendering, not just exist in the JSON. Review round 1 (issue #2958): a
// regression that drops the date string from <Cite> while the footer keeps it
// would weaken claim-level attribution without any page-level test noticing.
describe("citation rendering shows the as-of date (issue #2958)", () => {
  const fixture: CompareCitations = {
    competitor: "adspy",
    productName: "AdSpy",
    sources: [
      { id: "pricing", href: "https://example.com/pricing", label: "Example pricing", claim: "a claim", checked: "2026-09-10" },
      { id: "reviews", href: "https://example.com/reviews", label: "Example reviews", claim: "another claim", checked: "2026-09-11" },
    ],
  };

  it("Cite appends (as of <date>) after the source link", () => {
    const markup = renderToStaticMarkup(createElement(Cite, { citations: fixture, id: "pricing" }));
    expect(markup).toContain('href="https://example.com/pricing"');
    expect(markup).toContain("(as of 2026-09-10)");
  });

  it("Cite renders nothing when the id is unknown (visible gap, not a throw)", () => {
    expect(renderToStaticMarkup(createElement(Cite, { citations: fixture, id: "missing" }))).toBe("");
  });

  it("footer shows as-of for every source", () => {
    const markup = renderToStaticMarkup(createElement(CompareCitationsFooter, { citations: fixture }));
    expect(markup).toContain("as of 2026-09-10");
    expect(markup).toContain("as of 2026-09-11");
  });
});
