import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { DevelopmentsFeed } from "../../app/components/developments-feed";
import type { SiteChangeItemData } from "../../app/components/site-change-item";
import type { DevelopmentItem } from "../../app/lib/developments";

type FeedRow = DevelopmentItem & { when: string };

const ROWS: readonly FeedRow[] = [
  { id: "d1", kind: "hiring", title: "Staff engineer, billing", summary: null, url: null, observedAt: "2026-09-11T08:00:00Z", when: "14 Sept" },
  { id: "d2", kind: "ad", title: "New creative: launch", summary: "Runs the compare-against-us line again.", url: "https://library.example/ad/1", observedAt: "2026-09-12T09:30:00Z", when: "13 Sept" },
  { id: "d3", kind: "change", title: "Pricing copy moved", summary: null, url: null, observedAt: "2026-09-13T10:00:00Z", when: "12 Sept" },
  { id: "d4", kind: "mention", title: "Designer role posted", summary: "Placeholder mention text", url: "https://forum.example/t/1", observedAt: "2026-09-14T11:00:00Z", when: "11 Sept" },
  { id: "d5", kind: "hiring", title: "Designer", summary: null, url: null, observedAt: "2026-09-15T12:00:00Z", when: "10 Sept" },
];

const HIRING_FIRST: FeedRow = ROWS[0];

const HIRING_ONLY: readonly FeedRow[] = ROWS.filter((row) => row.kind === "hiring");

const MATCHED_CHANGE: SiteChangeItemData = {
  id: "d3",
  entityId: "comp-1",
  isSelf: false,
  headline: "Pricing copy moved",
  page: "pricing",
  url: "https://example.com/pricing",
  observedAt: "2026-09-13T10:00:00Z",
  capturedAt: "2026-09-13T10:05:00Z",
  wordsChanged: 8,
  sentence: "The compare table moved above the fold.",
  mark: { removed: "Facts and numbers", added: "Now with anecdotes" },
  before: { src: "https://shots.example/before.png", capturedAt: "2026-09-12T10:05:00Z" },
  after: { src: "https://shots.example/after.png", capturedAt: "2026-09-13T10:05:00Z" },
  whyFlagged: null,
  when: "12 Sept",
};

const CHANGES: readonly [] = [];

function renderWith(rows: readonly FeedRow[], changes: readonly SiteChangeItemData[], url = "/"): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [url] }, createElement(DevelopmentsFeed, { items: rows, changes })),
  );
}

function render(url: string, rows: readonly FeedRow[] = ROWS): string {
  return renderWith(rows, CHANGES, url);
}

function plain(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function chipTexts(html: string): string[] {
  return (html.match(/data-slot="toggle-group-item"[\s\S]*?<\/button>/g) ?? []).map((chip) =>
    plain(chip.slice(chip.indexOf(">") + 1, chip.lastIndexOf("</button>"))),
  );
}

function rowKinds(html: string): string[] {
  const kinds: string[] = [];
  for (const match of html.matchAll(/data-kind="([^"]+)"/g)) {
    const kind = match[1];
    if (typeof kind === "string") kinds.push(kind);
  }
  return kinds;
}

const CHIPS = ["All5", "Ads1", "Site changes1", "Mentions1", "Hiring2"];

describe("the developments feed", () => {
  it("lists every row under five labelled count chips on the bare page", () => {
    const html = render("/");
    expect(rowKinds(html)).toEqual(["hiring", "ad", "change", "mention", "hiring"]);
    expect(html.match(/data-kind=/g)).toHaveLength(5);
    expect(chipTexts(html)).toEqual(CHIPS);
    expect(html).toContain('aria-label="Filter developments"');
    expect(html).toContain('data-slot="developments-list"');
    expect(html).toContain('data-slot="source-pill"');
    expect(html).toContain('data-testid="development"');
  });

  it("shows only the kind the URL asks for and leaves the chip counts alone", () => {
    const html = render("/?kind=hiring");
    expect(html.match(/data-kind=/g)).toHaveLength(2);
    expect(rowKinds(html)).toEqual(["hiring", "hiring"]);
    expect(chipTexts(html)).toEqual(CHIPS);
  });

  it("falls back to the whole feed for an unknown kind", () => {
    const html = render("/?kind=bogus");
    expect(html.match(/data-kind=/g)).toHaveLength(5);
    expect(rowKinds(html)).toEqual(["hiring", "ad", "change", "mention", "hiring"]);
    expect(chipTexts(html)).toEqual(CHIPS);
  });

  it("keeps one list element for every filter, empty rows included", () => {
    for (const url of ["/", "/?kind=ad", "/?kind=change", "/?kind=mention", "/?kind=hiring", "/?kind=bogus"]) {
      expect(render(url).match(/data-slot="developments-list"/g)).toHaveLength(1);
    }
    const empty = render("/?kind=ad", HIRING_ONLY);
    expect(empty.match(/data-slot="developments-list"/g)).toHaveLength(1);
    expect(empty).not.toContain('data-testid="development"');
    expect(plain(empty)).toContain("Nothing of this kind in the last 90 days.");
  });

  it("titles a row by title, then summary, then the source label", () => {
    const titled = render("/?kind=hiring");
    expect(plain(titled)).toContain("Staff engineer, billing");
    const summaryOnly: readonly FeedRow[] = [{ ...HIRING_FIRST, title: null, summary: "Summary carries the name" }];
    expect(plain(render("/?kind=hiring", summaryOnly))).toContain("Summary carries the name");
    const bare: readonly FeedRow[] = [{ ...HIRING_FIRST, title: null, summary: null }];
    expect(plain(render("/?kind=hiring", bare))).toContain("Careers page");
  });

  it("prints a summary only beside a title, and the source pill and age every row", () => {
    const ad = render("/?kind=ad");
    expect(plain(ad)).toContain("Runs the compare-against-us line again.");
    expect(ad).toContain("Ad library");
    expect(ad).toContain("13 Sept");
    const change = render("/?kind=change");
    expect(change.match(/<p[ >]/g)).toBeNull();
    expect(change).toContain("Website");
    expect(change).toContain("12 Sept");
  });

  it("hands a change row whose id matches to the site-change item, which carries the mark", () => {
    const html = renderWith([ROWS[2]], [MATCHED_CHANGE]);
    expect(html).toContain('data-testid="site-change"');
    expect(html).not.toContain('data-testid="development"');
    expect(html).not.toContain('data-slot="source-pill"');
    expect(html).toContain("Now with anecdotes");
    expect(html).toContain("Facts and numbers");
  });

  it("falls back to the plain card when the change list has no matching id", () => {
    const html = renderWith([ROWS[2]], []);
    expect(html).toContain('data-testid="development"');
    expect(html).not.toContain('data-testid="site-change"');
  });
});
