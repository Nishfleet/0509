import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { HowRankedSheet, HowRankedTable } from "../../app/components/how-ranked-sheet";
import type { HowRanked } from "../../app/lib/how-ranked";

const RANKED: HowRanked = {
  weekStartAt: "2026-09-21",
  weights: [
    { key: "mention_matters", label: "Mentions that matter", weight: 3 },
    { key: "mention_normal", label: "Mentions", weight: 1 },
    { key: "site_change_noteworthy", label: "Noteworthy site changes", weight: 4 },
    { key: "ad_new_creative", label: "New ad creatives", weight: 2 },
    { key: "ad_copy_change", label: "Ad copy or offer changes", weight: 3 },
    { key: "hiring_new_role", label: "New roles", weight: 1 },
  ],
  multipliers: [
    { reliability: "official_api", label: "Official API", value: 1 },
    { reliability: "rss", label: "RSS feed", value: 0.9 },
    { reliability: "scraped_page", label: "Scraped page", value: 0.6 },
    { reliability: "best_effort", label: "Best effort", value: 0.5 },
  ],
  brands: [
    {
      entityId: "brand-1",
      name: "Kindred",
      lines: [
        {
          bucket: "mention_matters",
          reliability: "rss",
          n: 2,
          weight: 3,
          multiplier: 0.9,
          points: 5.4,
        },
      ],
      total: 5.4,
    },
    {
      entityId: "brand-2",
      name: "Quiet",
      lines: [],
      total: 0,
    },
  ],
};

function renderTable(): string {
  return renderToStaticMarkup(createElement(HowRankedTable, { howRanked: RANKED }));
}

function renderSheet(): string {
  return renderToStaticMarkup(createElement(HowRankedSheet, { howRanked: RANKED }));
}

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sheetSource = readFileSync(
  join(REPO_ROOT, "app/components/how-ranked-sheet.tsx"),
  "utf8",
);

describe("HowRankedTable", () => {
  it("renders every weight label and value", () => {
    const html = renderTable();
    expect(html).toContain("What each signal is worth");
    expect(html).toContain("Mentions that matter");
    expect(html).toContain("Noteworthy site changes");
    expect(html).toContain("New ad creatives");
    expect(html).toContain("Ad copy or offer changes");
    expect(html).toContain("New roles");
    expect(html).toContain(">3<");
    expect(html).toContain(">1<");
    expect(html).toContain(">4<");
    expect(html).toContain(">2<");
  });

  it("renders every multiplier as ×value", () => {
    const html = renderTable();
    expect(html).toContain("How much each source counts");
    expect(html).toContain("×1");
    expect(html).toContain("×0.9");
    expect(html).toContain("×0.6");
    expect(html).toContain("×0.5");
  });

  it("renders each brand line as n label (multiplier) × weight × multiplier = points", () => {
    const html = renderTable();
    expect(html).toContain(
      "2 Mentions that matter (RSS feed) × 3 × 0.9 = 5.4",
    );
    expect(html).toContain("Total 5.4");
  });

  it("renders the empty brand with No signals this week and —", () => {
    const html = renderTable();
    expect(html).toContain("No signals this week");
    expect(html).toContain("—");
  });

  it("wraps each brand block with the how-ranked-brand test id", () => {
    const html = renderTable();
    const matches = html.match(/data-testid="how-ranked-brand"/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});

describe("HowRankedSheet", () => {
  it("renders the trigger text and the title attribute", () => {
    const html = renderSheet();
    expect(html).toContain("How this is ranked");
    expect(html).toContain('title="ranked by what the internet did about each brand this week"');
  });

  it("keeps the trigger's touch target and underline affordances", () => {
    const html = renderSheet();
    expect(html).toContain("min-h-11");
    expect(html).toContain("underline");
    expect(html).toContain("underline-offset-4");
  });

  it("turns the dialog into a bottom sheet below 860px", () => {
    expect(sheetSource).toContain("max-h-[85dvh] overflow-y-auto sm:max-w-lg");
    expect(sheetSource).toContain("max-[859px]:top-auto max-[859px]:bottom-0");
    expect(sheetSource).toContain(
      "max-[859px]:left-0 max-[859px]:max-w-none max-[859px]:translate-x-0 max-[859px]:translate-y-0 max-[859px]:rounded-b-none",
    );
  });
});