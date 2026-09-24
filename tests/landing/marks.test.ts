import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Marks } from "../../app/components/landing/marks";
import { pickLandingMarks, type SiteChangeView } from "../../app/lib/site-change";

const NOW = "2026-09-25T06:00:00.000Z";

function view(overrides: Partial<SiteChangeView> & Pick<SiteChangeView, "id">): SiteChangeView {
  return {
    entityId: overrides.id,
    isSelf: false,
    headline: "Rival changed its pricing page",
    page: "pricing page",
    url: "https://rival.example/pricing",
    observedAt: "2026-09-24T02:10:00.000Z",
    capturedAt: "2026-09-24 02:10 UTC",
    wordsChanged: 2,
    sentence: "1 word added, 1 word removed.",
    mark: { removed: "Plans from $10.", added: "Plans from $12." },
    before: { src: `/app/changes/${overrides.id}/before`, capturedAt: "2026-09-22 02:00 UTC" },
    after: { src: `/app/changes/${overrides.id}/after`, capturedAt: "2026-09-24 02:10 UTC" },
    ...overrides,
  };
}

const ROWS: SiteChangeView[] = [
  view({ id: "sig-rival", capturedAt: "2026-09-24 02:10 UTC" }),
  view({
    id: "sig-own",
    isSelf: true,
    url: "https://own.example/",
    capturedAt: "2026-09-23 06:00 UTC",
    headline: "Your homepage changed",
    mark: { removed: "Page loads", added: "Error 503" },
  }),
  view({
    id: "sig-ads",
    url: "https://other.example/home",
    capturedAt: "2026-09-22 11:00 UTC",
    headline: "Other changed its homepage",
    mark: { removed: "Built for teams", added: "Built for everyone" },
  }),
  view({ id: "sig-fourth", capturedAt: "2026-09-21 01:00 UTC", mark: { removed: "Old line", added: "New line" } }),
];

function markup(rows: readonly SiteChangeView[]): string {
  return renderToStaticMarkup(createElement(Marks, { marks: pickLandingMarks(rows), now: NOW }));
}

describe("pickLandingMarks", () => {
  it("keeps one own-site change first, then the newest others, and stops at three", () => {
    expect(pickLandingMarks(ROWS).map((row) => row.id)).toEqual(["sig-own", "sig-rival", "sig-ads"]);
  });

  it("drops a one-sided change, a blank line, a bad url and an unreadable time", () => {
    const picked = pickLandingMarks([
      view({ id: "one-sided", mark: { removed: "Plans from $10.", added: null } }),
      view({ id: "blank", mark: { removed: "   ", added: "Plans from $12." } }),
      view({ id: "bad-url", url: "javascript:alert(1)" }),
      view({ id: "bad-time", capturedAt: "yesterday" }),
      view({ id: "kept" }),
    ]);
    expect(picked.map((row) => row.id)).toEqual(["kept"]);
  });

  it("renders what exists when fewer than three real marks are paired", () => {
    expect(pickLandingMarks([view({ id: "only" })]).map((row) => row.id)).toEqual(["only"]);
    expect(pickLandingMarks([])).toEqual([]);
  });
});

describe("landing marks", () => {
  it("draws up to three real marks at lg, each with its capture, source, captured-at and age", () => {
    const html = markup(ROWS);
    expect(html.match(/data-size="lg"/g)).toHaveLength(3);
    expect(html).toContain('data-signal-id="sig-own"');
    expect(html).toContain('data-own-site="true"');
    expect(html).toContain('data-captured-at="2026-09-23 06:00 UTC"');
    expect(html).toContain('href="https://own.example/"');
    expect(html).toContain('dateTime="2026-09-23T06:00:00.000Z"');
    expect(html).toContain("Page loads");
    expect(html).toContain("Error 503");
    expect(html).toContain("2 days ago");
    expect(html).toContain("/app/changes/sig-own/after?w=208");
    expect(html).not.toContain("sig-fourth");
    expect(html).not.toContain("/design/landing/changes/");

    const items = html.split('data-signal-id="').slice(1);
    expect(items[0]).toContain('loading="eager"');
    expect(items[0]).toContain('fetchPriority="high"');
    expect(items[1]).not.toContain('loading="eager"');
    expect(items[1]).toContain('loading="lazy"');
    expect(items[2]).toContain('loading="lazy"');
  });

  it("renders the marks that exist and never an invented one", () => {
    const two = markup([view({ id: "a" }), view({ id: "b", url: "https://b.example/" })]);
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
