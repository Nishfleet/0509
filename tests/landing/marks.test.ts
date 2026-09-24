import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Marks } from "../../app/components/landing/marks";
import {
  landingMarksFromChanges,
  pickLandingMarks,
  type LandingMarkInput,
} from "../../app/lib/landing-marks";

const NOW = new Date("2026-09-25T06:00:00.000Z");

function change(overrides: Partial<LandingMarkInput> & Pick<LandingMarkInput, "id">): LandingMarkInput {
  return {
    isSelf: false,
    url: "https://rival.example/pricing",
    capturedAt: "2026-09-24 02:10 UTC",
    headline: "Rival changed its pricing page",
    removed: "Plans from $10.",
    added: "Plans from $12.",
    before: { src: "/app/changes/x/before", capturedAt: "2026-09-22 02:00 UTC" },
    after: { src: "/app/changes/x/after", capturedAt: "2026-09-24 02:10 UTC" },
    ...overrides,
  };
}

const ROWS: LandingMarkInput[] = [
  change({ id: "sig-rival", capturedAt: "2026-09-24 02:10 UTC" }),
  change({
    id: "sig-own",
    isSelf: true,
    url: "https://own.example/",
    capturedAt: "2026-09-23 08:00 UTC",
    headline: "Your homepage changed",
    removed: "Page loads",
    added: "Error 503",
  }),
  change({
    id: "sig-ads",
    url: "https://other.example/home",
    capturedAt: "2026-09-22 11:00 UTC",
    headline: "Other changed its homepage",
    removed: "Built for teams",
    added: "Built for everyone",
  }),
  change({ id: "sig-fourth", capturedAt: "2026-09-21 01:00 UTC", removed: "Old line", added: "New line" }),
];

function markup(rows: readonly LandingMarkInput[]): string {
  return renderToStaticMarkup(createElement(Marks, { marks: landingMarksFromChanges(rows, NOW) }));
}

describe("pickLandingMarks", () => {
  it("keeps one own-site change first, then the newest others, and stops at three", () => {
    expect(pickLandingMarks(ROWS).map((row) => row.id)).toEqual(["sig-own", "sig-rival", "sig-ads"]);
  });

  it("drops a one-sided change, a blank line, a bad url and an unreadable time", () => {
    const picked = pickLandingMarks([
      change({ id: "one-sided", added: null }),
      change({ id: "blank", removed: "   " }),
      change({ id: "bad-url", url: "javascript:alert(1)" }),
      change({ id: "bad-time", capturedAt: "yesterday" }),
      change({ id: "kept" }),
    ]);
    expect(picked.map((row) => row.id)).toEqual(["kept"]);
  });

  it("renders what exists when fewer than three real marks are paired", () => {
    expect(pickLandingMarks([change({ id: "only" })]).map((row) => row.id)).toEqual(["only"]);
    expect(pickLandingMarks([])).toEqual([]);
  });
});

describe("landing marks", () => {
  it("draws up to three real marks at lg, each with its capture, source, captured-at and age", () => {
    const html = markup(ROWS);
    expect(html.match(/data-size="lg"/g)).toHaveLength(3);
    expect(html).toContain('data-signal-id="sig-own"');
    expect(html).toContain('data-own-site="true"');
    expect(html).toContain('data-captured-at="2026-09-23 08:00 UTC"');
    expect(html).toContain('href="https://own.example/"');
    expect(html).toContain('dateTime="2026-09-23T08:00:00.000Z"');
    expect(html).toContain("Page loads");
    expect(html).toContain("Error 503");
    expect(html).toContain("2 days ago");
    expect(html).toContain("/design/landing/changes/sig-own/after?w=208");
    expect(html).not.toContain("sig-fourth");
    expect(html).not.toContain("/app/changes/");

    const items = html.split('data-signal-id="').slice(1);
    expect(items[0]).toContain('loading="eager"');
    expect(items[0]).toContain('fetchPriority="high"');
    expect(items[1]).not.toContain('loading="eager"');
    expect(items[1]).toContain('loading="lazy"');
    expect(items[2]).toContain('loading="lazy"');
  });

  it("renders the marks that exist and never an invented one", () => {
    const two = markup([change({ id: "a" }), change({ id: "b", url: "https://b.example/" })]);
    expect(two.match(/data-signal-id=/g)).toHaveLength(2);
    expect(two).not.toContain("€29");
    expect(two.toLowerCase()).not.toContain("sample");
    expect(two.toLowerCase()).not.toContain("legend");

    const none = markup([]);
    expect(none).toContain('id="mark"');
    expect(none).not.toContain("<img");
    expect(none).not.toContain("data-signal-id");
    expect(none).not.toContain("€29");
    expect(none.toLowerCase()).not.toContain("sample");
    expect(none.toLowerCase()).not.toContain("legend");
  });
});
