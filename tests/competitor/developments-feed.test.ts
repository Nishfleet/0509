import { createChangeEventDetails } from "@base-ui/react/internals/createBaseUIEventDetails";
import { REASONS } from "@base-ui/react/internals/reasons";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type * as ReactRouterModule from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DevelopmentsFeed } from "../../app/components/developments-feed";
import type { SiteChangeItemData } from "../../app/components/site-change-item";
import type { DevelopmentItem } from "../../app/lib/developments";
import type * as ToggleGroupModule from "../../app/components/ui/toggle-group";

type ToggleGroupPrimitive = typeof ToggleGroupModule.ToggleGroup;

type ToggleGroupProps = ComponentProps<ToggleGroupPrimitive>;

const feedFilterHarness = vi.hoisted(() => ({
  params: new URLSearchParams(),
  onValueChange: null as ToggleGroupProps["onValueChange"] | null,
  setSearchParams: null as ((next: URLSearchParamsInit, options?: unknown) => void) | null,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<ReactRouterModule>();
  return {
    ...actual,
    useSearchParams: () => [
      feedFilterHarness.params,
      (next: URLSearchParamsInit, options?: unknown) => feedFilterHarness.setSearchParams?.(next, options),
    ] as const,
  };
});

vi.mock("../../app/components/ui/toggle-group", async (importOriginal) => {
  const actual = await importOriginal<ToggleGroupModule>();
  return {
    ...actual,
    ToggleGroup: ({ children, onValueChange, ...props }: ToggleGroupProps) => {
      feedFilterHarness.onValueChange = onValueChange ?? null;
      return createElement("div", { "aria-label": props["aria-label"], "data-slot": "toggle-group" }, children);
    },
    ToggleGroupItem: ({ children, value }: ComponentProps<typeof actual.ToggleGroupItem>) =>
      createElement("button", { type: "button", "data-slot": "toggle-group-item", value }, children),
  };
});

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

const CHANGES: readonly SiteChangeItemData[] = [];

function renderWith(rows: readonly FeedRow[], changes: readonly SiteChangeItemData[], url = "/"): string {
  feedFilterHarness.params = new URLSearchParams(new URL(url, "https://example.test").search);
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [url] }, createElement(DevelopmentsFeed, { items: rows, changes })),
  );
}

function render(url: string, rows: readonly FeedRow[] = ROWS): string {
  return renderWith(rows, CHANGES, url);
}

function chips(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/data-slot="toggle-group-item"[\s\S]*?<\/button>/g)) {
    const block = match[0];
    const openEnd = block.indexOf(">");
    const closeStart = block.lastIndexOf("</button>");
    if (openEnd === -1 || closeStart === -1) continue;
    const inner = block.slice(openEnd + 1, closeStart);
    const chip = inner.match(/^([^<]+)<span class="font-mono text-meta">(\d+)<\/span>$/);
    if (chip && chip[1] !== undefined && chip[2] !== undefined) out.push(`${chip[1]}${chip[2]}`);
  }
  return out;
}

function kinds(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/data-kind="([^"]+)"/g)) {
    const kind = match[1];
    if (typeof kind === "string") out.push(kind);
  }
  return out;
}

function sourcePill(html: string): string {
  const match = html.match(/data-slot="source-pill"[^>]*>([^<]*)</);
  return match && match[1] !== undefined ? match[1] : "";
}

describe("the developments feed", () => {
  beforeEach(() => {
    feedFilterHarness.onValueChange = null;
    feedFilterHarness.setSearchParams = null;
  });

  it("lists every row under five labelled count chips on the bare page", () => {
    const html = render("/");
    expect(kinds(html)).toEqual(["hiring", "ad", "change", "mention", "hiring"]);
    expect(html.match(/data-kind=/g)).toHaveLength(5);
    expect(chips(html)).toEqual(["All5", "Ads1", "Site changes1", "Mentions1", "Hiring2"]);
    expect(html).toContain('aria-label="Filter developments"');
    expect(html).toContain('data-slot="developments-list"');
    expect(html).toContain('data-slot="source-pill"');
    expect(html).toContain('data-testid="development"');
  });

  it("shows only the kind the URL asks for and leaves the chip counts alone", () => {
    const html = render("/?kind=hiring");
    expect(html.match(/data-kind=/g)).toHaveLength(2);
    expect(kinds(html)).toEqual(["hiring", "hiring"]);
    expect(chips(html)).toEqual(["All5", "Ads1", "Site changes1", "Mentions1", "Hiring2"]);
  });

  it("falls back to the whole feed for an unknown kind", () => {
    const html = render("/?kind=bogus");
    expect(html.match(/data-kind=/g)).toHaveLength(5);
    expect(kinds(html)).toEqual(["hiring", "ad", "change", "mention", "hiring"]);
    expect(chips(html)).toEqual(["All5", "Ads1", "Site changes1", "Mentions1", "Hiring2"]);
  });

  it("keeps one list element for every filter, empty rows included", () => {
    for (const url of ["/", "/?kind=ad", "/?kind=change", "/?kind=mention", "/?kind=hiring", "/?kind=bogus"]) {
      expect(render(url).match(/data-slot="developments-list"/g)).toHaveLength(1);
    }
    const empty = render("/?kind=ad", HIRING_ONLY);
    expect(empty.match(/data-slot="developments-list"/g)).toHaveLength(1);
    expect(empty).not.toContain('data-testid="development"');
    expect(empty).toContain("Nothing of this kind in the last 90 days.");
  });

  it("titles a row by title, then summary, then the source label", () => {
    const titled = render("/?kind=hiring");
    expect(titled).toContain(">Staff engineer, billing<");
    const summaryOnly: readonly FeedRow[] = [{ ...HIRING_FIRST, title: null, summary: "Summary carries the name" }];
    expect(render("/?kind=hiring", summaryOnly)).toContain(">Summary carries the name<");
    const bare: readonly FeedRow[] = [{ ...HIRING_FIRST, title: null, summary: null }];
    expect(render("/?kind=hiring", bare)).toContain(">Careers page<");
  });

  it("prints a summary only beside a title, and the source pill and age every row", () => {
    const ad = render("/?kind=ad");
    expect(ad).toContain("Runs the compare-against-us line again.");
    expect(ad).toContain('data-slot="source-pill"');
    expect(sourcePill(ad)).toBe("Ad library");
    expect(ad).toContain("13 Sept");
    const change = render("/?kind=change");
    expect(change.match(/<p[ >]/g)).toBeNull();
    expect(sourcePill(change)).toBe("Website");
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

  it("takes the first toggled kind and clears the kind param for all", () => {
    const updates: URLSearchParamsInit[] = [];
    feedFilterHarness.setSearchParams = (next) => updates.push(next);
    render("/?kind=ad");
    const details = createChangeEventDetails(REASONS.none);
    feedFilterHarness.onValueChange?.(["hiring", "ad"], details);
    expect(updates).toEqual([{ kind: "hiring" }]);
    feedFilterHarness.onValueChange?.([], details);
    expect(updates).toEqual([{ kind: "hiring" }, {}]);
  });
});
