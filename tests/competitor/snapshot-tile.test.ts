import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompetitorSnapshot } from "../../app/components/competitor-snapshot";
import type { SnapshotCell } from "../../app/lib/competitor-snapshot";

const RANK_MOVED: SnapshotCell = { key: "rank", label: "Rank", value: 3, movement: 2, reason: null };
const RANK_FLAT: SnapshotCell = { key: "rank", label: "Rank", value: 3, movement: null, reason: null };

function render(cell: SnapshotCell): string {
  return renderToStaticMarkup(createElement(CompetitorSnapshot, { cells: [cell] }));
}

function rankTileText(cell: SnapshotCell): string {
  const tiles = [...render(cell).matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)];
  expect(tiles).toHaveLength(1);
  return (tiles[0]?.[1] ?? "").replace(/<[^>]*>/g, "");
}

describe("the competitor snapshot rank tile", () => {
  it("keeps a real-text separator so the value and its movement do not run together", () => {
    expect(rankTileText(RANK_MOVED)).toBe("#3 up 2");
  });

  it("renders only the rank when there is no movement", () => {
    expect(rankTileText(RANK_FLAT)).toBe("#3");
  });
});
