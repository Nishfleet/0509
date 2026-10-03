import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RowEvidence } from "../app/components/row-evidence";
import type { WeekEvidence } from "../app/lib/home-standing";

// RowEvidence turns a raw week of evidence into the only thing a customer reads
// about their week, so every branch that decides what reaches the DOM is pinned
// here: the five labelled tabs with their per-kind counts, the tab chosen on
// the first render, the empty panel, the per-kind filter, and the two ways an
// item can reach for a URL (httpUrl gates both the source link and the image).
// Initial state only, so the render is a plain renderToStaticMarkup with no
// click simulation.
const WEEK: readonly WeekEvidence[] = [
  {
    id: "ev-site-1",
    sourceKind: "site",
    title: "Pricing page copy",
    summary: null,
    url: "https://rival.com/pricing",
    evidenceUrl: "https://rival.com/pricing.png",
    observedAt: "2026-09-22T06:00:00.000Z",
  },
  {
    id: "ev-site-2",
    sourceKind: "site",
    title: "Nav gained a Store link",
    summary: null,
    url: null,
    evidenceUrl: null,
    observedAt: "2026-09-23T06:00:00.000Z",
  },
  {
    id: "ev-ads-1",
    sourceKind: "ads",
    title: "Hire a designer",
    summary: null,
    url: "javascript:alert(1)",
    evidenceUrl: "javascript:alert(1)",
    observedAt: "2026-09-23T07:00:00.000Z",
  },
  {
    id: "ev-mentions-1",
    sourceKind: "mentions",
    title: null,
    summary: "Quoted on a podcast",
    url: "https://news.example/talk",
    evidenceUrl: null,
    observedAt: "2026-09-24T07:00:00.000Z",
  },
];

function render(evidence: readonly WeekEvidence[]): string {
  return renderToStaticMarkup(createElement(RowEvidence, { evidence }));
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tabs(html: string): { label: string; selected: string }[] {
  return [...html.matchAll(/<button\b[^>]*role="tab"[\s\S]*?<\/button>/g)].map((match) => {
    const button = match[0];
    const selected = /aria-selected="(true|false)"/.exec(button)?.[1];
    expect(selected).toBeDefined();
    return { label: text(button), selected: selected ?? "false" };
  });
}

function panel(html: string): string {
  const match = /<div role="tabpanel"[\s\S]*?<\/div>/.exec(html);
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

describe("the row evidence tabs", () => {
  it("draws the five kinds in order, each labelled with its own count", () => {
    expect(tabs(render(WEEK))).toEqual([
      { label: "Site changes 2", selected: "true" },
      { label: "Ads 1", selected: "false" },
      { label: "Mentions 1", selected: "false" },
      { label: "Hiring 0", selected: "false" },
      { label: "Blog posts 0", selected: "false" },
    ]);
  });

  it("counts zero for every kind it has no items for", () => {
    const html = render([WEEK[3] as WeekEvidence]);
    expect(tabs(html).map((tab) => tab.label)).toEqual([
      "Site changes 0",
      "Ads 0",
      "Mentions 1",
      "Hiring 0",
      "Blog posts 0",
    ]);
  });

  it("selects the first kind in tab order that has an item", () => {
    const onlyMentions = render([
      { ...(WEEK[3] as WeekEvidence), id: "ev-mentions-2" },
      { ...(WEEK[0] as WeekEvidence), id: "ev-site-3" },
    ]);
    const selected = tabs(onlyMentions).filter((tab) => tab.selected === "true");
    expect(selected).toEqual([{ label: "Site changes 1", selected: "true" }]);

    const adsFirst = render([WEEK[2] as WeekEvidence, WEEK[3] as WeekEvidence]);
    expect(tabs(adsFirst).filter((tab) => tab.selected === "true")).toEqual([{ label: "Ads 1", selected: "true" }]);
  });

  it("falls back to Site changes and says so when the week is empty", () => {
    const html = render([]);
    expect(tabs(html).filter((tab) => tab.selected === "true")).toEqual([
      { label: "Site changes 0", selected: "true" },
    ]);
    expect(text(panel(html))).toBe("Nothing this week.");
  });
});

describe("the row evidence panel", () => {
  it("lists only the items of the selected kind", () => {
    const html = render(WEEK);
    const shown = text(panel(html));
    expect(shown).toContain("Pricing page copy");
    expect(shown).toContain("Nav gained a Store link");
    expect(shown).not.toContain("Quoted on a podcast");
    expect(panel(html).match(/data-slot="evidence-row"/g)).toHaveLength(2);
  });

  it("names a titled item by its title and an untitled one by its summary", () => {
    const title = panel(render([WEEK[0] as WeekEvidence]));
    expect(text(title)).toContain("Pricing page copy");
    const summary = panel(render([WEEK[3] as WeekEvidence]));
    expect(text(summary)).toContain("Quoted on a podcast");
  });

  it("links an https item to its source in a new tab and never to itself", () => {
    const anchor = /<a\b[^>]*href="https:\/\/rival\.com\/pricing"[\s\S]*?<\/a>/.exec(panel(render(WEEK)))?.[0] ?? "";
    expect(anchor).toContain("Source");
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noreferrer"');
    expect(anchor).toContain('aria-label="Source: Pricing page copy (opens in a new tab)"');
  });

  it("draws no link for an item with no url, and none for a javascript: one", () => {
    const noUrl = panel(render([WEEK[1] as WeekEvidence]));
    expect(text(noUrl)).toContain("Nav gained a Store link");
    expect(noUrl).not.toContain("<a");
    expect(noUrl.match(/Source/g)).toBeNull();

    const script = panel(render([WEEK[2] as WeekEvidence]));
    expect(text(script)).toContain("Hire a designer");
    expect(script).not.toContain("<a");
    expect(script).not.toContain("javascript:");
  });

  it("draws the evidence image with an empty alt and a lazy load", () => {
    const image = panel(render([WEEK[0] as WeekEvidence])).match(/<img\b[^>]*>/)?.[0] ?? "";
    expect(image).toContain('src="https://rival.com/pricing.png"');
    expect(image).toContain('alt=""');
    expect(image).toContain('loading="lazy"');
  });

  it("draws no image when there is no evidence url, or when it is not http", () => {
    expect(panel(render([WEEK[1] as WeekEvidence]))).not.toContain("<img");
    expect(panel(render([WEEK[3] as WeekEvidence]))).not.toContain("<img");
    expect(panel(render([WEEK[2] as WeekEvidence]))).not.toContain("<img");
  });
});
