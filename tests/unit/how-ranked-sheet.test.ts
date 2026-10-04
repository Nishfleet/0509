import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HowRankedDialog } from "../../app/components/how-ranked-dialog";
import { HowRankedSheet } from "../../app/components/how-ranked-sheet";
import { HowRankedTable } from "../../app/components/how-ranked-table";
import { DialogContent } from "../../app/components/ui/dialog";
import type { HowRanked } from "../../app/lib/how-ranked";

const RANKED: HowRanked = {
  weekStartAt: "2026-09-21",
  weights: [
    { key: "mention_matters", label: "Mentions that matter", weight: 3 },
    { key: "mention_normal", label: "Mentions", weight: 1 },
    { key: "site_change_noteworthy", label: "Noteworthy site changes", weight: 4 },
    { key: "ad_new_creative", label: "New ads", weight: 2 },
    { key: "ad_copy_change", label: "Ad wording or offer changes", weight: 3 },
    { key: "hiring_new_role", label: "New job openings", weight: 1 },
  ],
  multipliers: [
    { reliability: "official_api", label: "Official data", value: 1 },
    { reliability: "rss", label: "Public feed", value: 0.9 },
    { reliability: "scraped_page", label: "Page we read", value: 0.6 },
    { reliability: "best_effort", label: "Best guess", value: 0.5 },
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

function renderTable(howRanked: HowRanked = RANKED): string {
  return renderToStaticMarkup(createElement(HowRankedTable, { howRanked }));
}

function renderSheet(): string {
  return renderToStaticMarkup(createElement(HowRankedSheet, { howRanked: RANKED }));
}

function findElement(node: ReactNode, type: unknown): ReactElement | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    if (child.type === type) return child;
    const nested = findElement((child.props as { children?: ReactNode }).children, type);
    if (nested !== null) return nested;
  }
  return null;
}

function sheetContent(): ReactElement<{ className?: string }> {
  const content = findElement(HowRankedDialog({ howRanked: RANKED, onClose: () => undefined }), DialogContent);
  if (content === null) throw new Error("HowRankedDialog rendered no DialogContent");
  return content;
}

function brandBlock(html: string, name: string): string {
  const start = html.indexOf(`<h4 class="font-display font-bold">${name}</h4>`);
  if (start < 0) throw new Error(`No brand block for ${name}`);
  return html.slice(start, html.indexOf("</article>", start));
}

describe("HowRankedTable", () => {
  it("renders every weight label and value", () => {
    const html = renderTable();
    expect(html).toContain("Points for each kind of activity");
    expect(html).toContain("Mentions that matter");
    expect(html).toContain("Noteworthy site changes");
    expect(html).toContain("New ads");
    expect(html).toContain("Ad wording or offer changes");
    expect(html).toContain("New job openings");
    expect(html).toContain(">3<");
    expect(html).toContain(">1<");
    expect(html).toContain(">4<");
    expect(html).toContain(">2<");
  });

  it("renders every multiplier as ×value", () => {
    const html = renderTable();
    expect(html).toContain("How much we trust each source");
    expect(html).toContain("×1");
    expect(html).toContain("×0.9");
    expect(html).toContain("×0.6");
    expect(html).toContain("×0.5");
  });

  it("renders each brand line as n label (multiplier) × weight × multiplier = points", () => {
    const block = brandBlock(renderTable(), "Kindred");
    expect(block).toContain("2 Mentions that matter (Public feed) × 3 × 0.9 = 5.4");
    expect(block).toContain("Total 5.4");
    expect(block).not.toContain("Total —");
  });

  it("shows the empty brand a dash total and never 0", () => {
    const block = brandBlock(renderTable(), "Quiet");
    expect(block).toContain("Nothing this week");
    expect(block).toContain("Total —");
    expect(block).not.toContain("Total 0");
  });

  it("wraps each brand block with the how-ranked-brand test id", () => {
    const html = renderTable();
    const matches = html.match(/data-testid="how-ranked-brand"/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("reads every label off the prop and throws instead of printing an internal key", () => {
    const missingWeight: HowRanked = {
      ...RANKED,
      weights: RANKED.weights.filter((entry) => entry.key !== "mention_matters"),
    };
    const missingMultiplier: HowRanked = {
      ...RANKED,
      multipliers: RANKED.multipliers.filter((entry) => entry.reliability !== "rss"),
    };
    expect(() => renderTable(missingWeight)).toThrow(/Missing weight label for bucket mention_matters/);
    expect(() => renderTable(missingMultiplier)).toThrow(/Missing multiplier label for reliability rss/);
  });
});

describe("HowRankedSheet", () => {
  it("renders the trigger text without a title attribute", () => {
    const html = renderSheet();
    expect(html).toContain("How this is ranked");
    expect(html).not.toContain("title=");
  });

  it("keeps the trigger's touch target and underline affordances", () => {
    const html = renderSheet();
    expect(html).toContain("min-h-11");
    expect(html).toContain("underline");
    expect(html).toContain("underline-offset-4");
  });

  it("turns the dialog it renders into a bottom sheet below 860px", () => {
    const className = sheetContent().props.className ?? "";
    expect(className).toContain("max-h-[85dvh] overflow-y-auto");
    expect(className).toContain("sm:max-w-lg");
    expect(className).toContain("max-[859px]:top-auto max-[859px]:bottom-0");
    expect(className).toContain(
      "max-[859px]:left-0 max-[859px]:max-w-none max-[859px]:translate-x-0 max-[859px]:translate-y-0 max-[859px]:rounded-b-none",
    );
  });
});
