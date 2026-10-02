import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompetitorSnapshot } from "../../app/components/competitor-snapshot";
import type { SnapshotCell } from "../../app/lib/competitor-snapshot";

const dashReason = "Meta ads did not respond this week.";

const CELLS: readonly SnapshotCell[] = [
  { key: "rank", label: "Rank", value: 2, movement: -1, reason: null },
  { key: "new_creatives", label: "New ads", value: 0, movement: null, reason: null },
  { key: "copy_changes", label: "Ad wording changes", value: 1, movement: null, reason: null },
  {
    key: "site_changes",
    label: "Noteworthy site changes",
    value: null,
    movement: null,
    reason: dashReason,
  },
  { key: "mentions", label: "Mentions that matter", value: 5, movement: null, reason: null },
  { key: "new_roles", label: "New job openings", value: 4, movement: null, reason: null },
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
    expect(html).toContain("--cols");
    expect(html).not.toContain("shadow");
    expect(html).not.toContain("rounded");
  });

  it("draws a tile only for a cell that has a number, in input order", () => {
    const html = snapshot(CELLS);
    const keys = [...html.matchAll(/data-cell="([^"]+)"/g)].map((match) => match[1]);
    expect(keys).toEqual(["rank", "new_creatives", "copy_changes", "mentions", "new_roles"]);
  });

  it("renders a zero as 0 and never as a dash", () => {
    const html = snapshot([cellFor("new_creatives")]);
    expect(html).toContain(">0<");
    expect(html).not.toContain("—");
  });

  it("says why a cell has no number in one line instead of drawing an empty tile", () => {
    const html = snapshot([cellFor("site_changes")]);
    expect(html).not.toContain("data-cell");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("<details");
    expect(visibleText(html)).toBe(`Noteworthy site changes: ${dashReason}`);
  });

  it("groups cells that share a reason into one line", () => {
    const reason = "Not watched for this competitor yet.";
    const html = snapshot([
      { key: "new_creatives", label: "New ads", value: null, movement: null, reason },
      { key: "copy_changes", label: "Ad wording changes", value: null, movement: null, reason },
    ]);
    expect(visibleText(html)).toBe(`New ads, Ad wording changes: ${reason}`);
  });

  it("prefixes the rank value and appends its movement label", () => {
    const html = snapshot([cellFor("rank")]);
    expect(html).toContain('class="text-2xl font-semibold text-ink tabular-nums"');
    expect(visibleText(html)).toContain("#2");
    expect(html).toContain("down 1");
    expect(visibleText(html)).toContain("down 1");
  });
});
