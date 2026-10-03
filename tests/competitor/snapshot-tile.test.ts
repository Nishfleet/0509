import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompetitorSnapshot } from "../../app/components/competitor-snapshot";
import type { SnapshotCell } from "../../app/lib/competitor-snapshot";

// The rank cell the snapshot builds (app/lib/competitor-snapshot.ts rankCell),
// with the week closed: rank 3, up 2 places.
const RANK_MOVED: SnapshotCell = { key: "rank", label: "Rank", value: 3, movement: 2, reason: null };
// The same rank with no movement this week.
const RANK_FLAT: SnapshotCell = { key: "rank", label: "Rank", value: 3, movement: null, reason: null };

function render(cell: SnapshotCell): string {
  return renderToStaticMarkup(createElement(CompetitorSnapshot, { cells: [cell] }));
}

function ddText(html: string): string {
  const match = /<dd[^>]*>([\s\S]*?)<\/dd>/.exec(html);
  expect(match).not.toBeNull();
  return (match?.[1] ?? "").replace(/<[^>]*>/g, "");
}

describe("the competitor snapshot rank tile", () => {
  it("keeps a real-text separator between the rank value and its movement", () => {
    // Old markup rendered "#3up 2" as one run: the value span butted straight
    // against the movement span. The separator must survive tag-stripping so a
    // screen reader reads two words, not one.
    expect(ddText(render(RANK_MOVED))).toBe("#3 up 2");
  });

  it("renders only the rank when there is no movement", () => {
    expect(ddText(render(RANK_FLAT))).toBe("#3");
  });
});
