import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompetitorSnapshot } from "../../app/components/competitor-snapshot";
import type { SnapshotCell } from "../../app/lib/competitor-snapshot";

const dashReason = "Meta ads did not answer this week.";

const CELLS: readonly SnapshotCell[] = [
  { key: "rank", label: "Rank", value: 2, movement: -1, reason: null },
  { key: "new_creatives", label: "New ad creatives", value: 0, movement: null, reason: null },
  { key: "copy_changes", label: "Ad copy changes", value: 1, movement: null, reason: null },
  {
    key: "site_changes",
    label: "Noteworthy site changes",
    value: null,
    movement: null,
    reason: dashReason,
  },
  { key: "mentions", label: "Mentions that matter", value: 5, movement: null, reason: null },
  { key: "new_roles", label: "New roles", value: 4, movement: null, reason: null },
];

function snapshot(cells: readonly SnapshotCell[]): string {
  const element: ReactElement = createElement(CompetitorSnapshot, { cells });
  return renderToStaticMarkup(element);
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function cellFor(key: SnapshotCell["key"]): SnapshotCell {
  const cell = CELLS.find((entry) => entry.key === key);
  if (cell === undefined) throw new Error(`missing cell ${key}`);
  return cell;
}

describe("the competitor snapshot card", () => {
  it("draws a divider-ruled card with no shadow and no rounded corner", () => {
    const html = snapshot(CELLS);
    expect(html).toContain('aria-label="This week in six numbers"');
    expect(html).toContain("border border-line");
    expect(html).toContain("divide-x");
    expect(html).toContain("divide-y");
    expect(html).toContain("divide-line");
    expect(html).toContain("lg:grid-cols-6");
    expect(html).not.toContain("shadow");
    expect(html).not.toContain("rounded");
  });

  it("keeps the six data-cell elements in the input order", () => {
    const html = snapshot(CELLS);
    const keys = [...html.matchAll(/data-cell="([^"]+)"/g)].map((match) => match[1]);
    expect(keys).toEqual([
      "rank",
      "new_creatives",
      "copy_changes",
      "site_changes",
      "mentions",
      "new_roles",
    ]);
  });

  it("renders a zero as 0 and never as a dash", () => {
    const html = snapshot([cellFor("new_creatives")]);
    expect(html).toContain(">0<");
    expect(html).not.toContain("—");
    expect(html).not.toContain("<details");
  });

  it("reveals the reason on tap with the native details element", () => {
    const html = snapshot([cellFor("site_changes")]);
    expect(html).toContain("<details>");
    expect(html).toContain("<summary");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain(`aria-label="No number: ${dashReason}"`);
    expect(html).toContain(`>—</summary>`);
    expect(html).toContain(`<p class="text-meta text-ink-soft">${dashReason}</p>`);
  });

  it("prefixes the rank value and appends its movement label", () => {
    const html = snapshot([cellFor("rank")]);
    expect(html).toContain('class="text-2xl font-semibold text-ink tabular-nums"');
    expect(visibleText(html)).toContain("#2");
    expect(html).toContain("down 1");
    expect(visibleText(html)).toContain("down 1");
  });
});
