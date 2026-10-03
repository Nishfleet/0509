import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RowEvidence } from "../app/components/row-evidence";
import type { WeekEvidence } from "../app/lib/home-standing";

function item(overrides: Partial<WeekEvidence> & Pick<WeekEvidence, "id" | "sourceKind">): WeekEvidence {
  return {
    title: null,
    summary: null,
    url: null,
    evidenceUrl: null,
    observedAt: "2026-09-22T06:00:00.000Z",
    ...overrides,
  };
}

const SITE_LINKED = item({
  id: "ev-site-1",
  sourceKind: "site",
  title: "Pricing page copy",
  url: "https://rival.com/pricing",
  evidenceUrl: "https://rival.com/pricing.png",
});
const SITE_PLAIN = item({
  id: "ev-site-2",
  sourceKind: "site",
  title: "Nav gained a Store link",
  url: null,
  evidenceUrl: null,
});
const ADS = item({ id: "ev-ads-1", sourceKind: "ads", title: "Hire a designer" });
const MENTION = item({
  id: "ev-mentions-1",
  sourceKind: "mentions",
  summary: "Quoted on a podcast",
  url: "https://rival.com/podcast",
});
const HIRING = item({
  id: "ev-hiring-1",
  sourceKind: "hiring",
  title: "Head of content",
  url: "https://rival.com/careers/head-of-content",
});
const BLOG = item({ id: "ev-content-1", sourceKind: "content", title: "Why we price it that way" });

const WEEK: readonly WeekEvidence[] = [SITE_LINKED, SITE_PLAIN, ADS, MENTION, HIRING, BLOG];
const EVERY_KIND: readonly { kind: string; item: WeekEvidence }[] = [
  { kind: "site", item: SITE_LINKED },
  { kind: "ads", item: ADS },
  { kind: "mentions", item: MENTION },
  { kind: "hiring", item: HIRING },
  { kind: "content", item: BLOG },
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
    const selected = /aria-selected="(true|false)"/.exec(match[0])?.[1];
    expect(selected).toBeDefined();
    return { label: text(match[0]), selected: selected ?? "false" };
  });
}

function selectedLabels(html: string): string[] {
  return tabs(html)
    .filter((tab) => tab.selected === "true")
    .map((tab) => tab.label);
}

function panel(html: string): string {
  const start = /<div\b[^>]*role="tabpanel"/.exec(html);
  expect(start).not.toBeNull();
  const panelHtml = html.slice(start?.index ?? 0);
  expect(panelHtml).not.toContain('role="tab"');
  return panelHtml;
}

describe("the row evidence tabs", () => {
  it("draws the five kinds in order, each labelled with its own count", () => {
    expect(tabs(render(WEEK)).map((tab) => tab.label)).toEqual([
      "Site changes 2",
      "Ads 1",
      "Mentions 1",
      "Hiring 1",
      "Blog posts 1",
    ]);
  });

  it("counts zero for every kind it has no items for", () => {
    expect(tabs(render([MENTION])).map((tab) => tab.label)).toEqual([
      "Site changes 0",
      "Ads 0",
      "Mentions 1",
      "Hiring 0",
      "Blog posts 0",
    ]);
  });

  it("marks exactly one tab selected, and it is the first kind in tab order with an item", () => {
    expect(selectedLabels(render(WEEK))).toEqual(["Site changes 2"]);
    expect(selectedLabels(render([SITE_PLAIN, HIRING]))).toEqual(["Site changes 1"]);
    expect(selectedLabels(render([BLOG, MENTION]))).toEqual(["Mentions 1"]);
    expect(selectedLabels(render([BLOG, HIRING]))).toEqual(["Hiring 1"]);
  });

  it("falls back to Site changes and says so when the week is empty", () => {
    const html = render([]);
    expect(selectedLabels(html)).toEqual(["Site changes 0"]);
    expect(text(panel(html))).toBe("Nothing this week.");
  });
});

describe("the row evidence panel", () => {
  it("lists only the items of the selected kind", () => {
    const shown = text(panel(render(WEEK)));
    expect(shown).toContain("Pricing page copy");
    expect(shown).toContain("Nav gained a Store link");
    expect(shown).not.toContain("Quoted on a podcast");
    expect(shown).not.toContain("Head of content");
    expect(shown).not.toContain("Why we price it that way");
    expect(panel(render(WEEK)).match(/data-slot="evidence-row"/g)).toHaveLength(2);
  });

  it("selects and shows each kind on its own, whatever the order the items arrive in", () => {
    for (const { kind, item: only } of EVERY_KIND) {
      const html = render([only]);
      const open = tabs(html).findIndex((tab) => tab.selected === "true");
      expect(open).toBe(tabs(html).findIndex((tab) => tab.label.startsWith(EXPECTED_LABEL[kind] ?? "")));
      const shown = text(panel(html));
      expect(shown).toContain(EXPECTED_TITLE[kind] ?? "");
      for (const other of EVERY_KIND.filter((entry) => entry.kind !== kind)) {
        expect(shown).not.toContain(EXPECTED_TITLE[other.kind] ?? "\u0000");
      }
    }
  });

  it("names a titled item by its title and an untitled one by its summary", () => {
    expect(text(panel(render([SITE_LINKED])))).toContain("Pricing page copy");
    expect(text(panel(render([MENTION])))).toContain("Quoted on a podcast");
  });

  it("links an https item to its source in a new tab and never to itself", () => {
    const anchor =
      /<a\b[^>]*href="https:\/\/rival\.com\/pricing"[\s\S]*?<\/a>/.exec(panel(render([SITE_LINKED])))?.[0] ?? "";
    expect(anchor).toContain("Source");
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noreferrer"');
    expect(anchor).toContain('aria-label="Source: Pricing page copy (opens in a new tab)"');
    expect(panel(render([SITE_LINKED])).match(/<a\b/g)).toHaveLength(1);
  });

  it("draws no link for an item with no url, and none for a javascript: one", () => {
    const noUrl = panel(render([SITE_PLAIN]));
    expect(text(noUrl)).toContain("Nav gained a Store link");
    expect(noUrl).not.toContain("<a");
    expect(noUrl).not.toContain("Source");

    const script = panel(
      render([item({ id: "ev-ads-2", sourceKind: "ads", title: "Hire a designer", url: "javascript:alert(1)" })]),
    );
    expect(text(script)).toContain("Hire a designer");
    expect(script).not.toContain("<a");
    expect(script).not.toContain("javascript:");
  });

  it("draws the evidence image with an empty alt and a lazy load", () => {
    const image = panel(render([SITE_LINKED])).match(/<img\b[^>]*>/)?.[0] ?? "";
    expect(image).toContain('src="https://rival.com/pricing.png"');
    expect(image).toContain('alt=""');
    expect(image).toContain('loading="lazy"');
  });

  it("draws no image when there is no evidence url, or when it is not http", () => {
    expect(panel(render([SITE_PLAIN]))).not.toContain("<img");
    expect(panel(render([MENTION]))).not.toContain("<img");
    expect(
      panel(
        render([
          item({ id: "ev-ads-3", sourceKind: "ads", title: "Hire a designer", evidenceUrl: "javascript:alert(1)" }),
        ]),
      ),
    ).not.toContain("<img");
  });

  it("gates the source link and the image independently of each other", () => {
    const badImage = panel(
      render([
        item({
          id: "ev-ads-4",
          sourceKind: "ads",
          title: "Ads with a safe link",
          url: "https://rival.com/hire",
          evidenceUrl: "javascript:alert(1)",
        }),
      ]),
    );
    expect(badImage).toContain('href="https://rival.com/hire"');
    expect(badImage).not.toContain("<img");

    const badLink = panel(
      render([
        item({
          id: "ev-ads-5",
          sourceKind: "ads",
          title: "Ads with a safe image",
          url: "javascript:alert(1)",
          evidenceUrl: "https://rival.com/hire.png",
        }),
      ]),
    );
    expect(badLink).not.toContain("<a");
    expect(badLink).toContain('src="https://rival.com/hire.png"');
  });
});

const EXPECTED_LABEL: Record<string, string> = {
  site: "Site changes",
  ads: "Ads",
  mentions: "Mentions",
  hiring: "Hiring",
  content: "Blog posts",
};

const EXPECTED_TITLE: Record<string, string> = {
  site: "Pricing page copy",
  ads: "Hire a designer",
  mentions: "Quoted on a podcast",
  hiring: "Head of content",
  content: "Why we price it that way",
};
