import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompetitorSnapshot } from "../../app/components/competitor-snapshot";
import type { SnapshotCell } from "../../app/lib/competitor-snapshot";

// The rank cell as snapshotCells builds it (app/lib/competitor-snapshot.ts rankCell):
// rank 3 up 2 places, and the same rank with no movement this week.
const RANK_MOVED: SnapshotCell = { key: "rank", label: "Rank", value: 3, movement: 2, reason: null };
const RANK_FLAT: SnapshotCell = { key: "rank", label: "Rank", value: 3, movement: null, reason: null };

function render(cell: SnapshotCell): string {
  return renderToStaticMarkup(createElement(CompetitorSnapshot, { cells: [cell] }));
}

// The rank tile's text with tags stripped, the way a screen reader reads it.
function rankTileText(cell: SnapshotCell): string {
  const tiles = [...render(cell).matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)];
  expect(tiles).toHaveLength(1);
  return (tiles[0]?.[1] ?? "").replace(/<[^>]*>/g, "");
}

describe("the competitor snapshot rank tile", () => {
  it("keeps a real-text separator so the value and its movement do not run together", () => {
    // The old markup produced the single run "#3up 2".
    expect(rankTileText(RANK_MOVED)).toBe("#3 up 2");
  });

  it("renders only the rank when there is no movement", () => {
    expect(rankTileText(RANK_FLAT)).toBe("#3");
  });
});
