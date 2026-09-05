import { describe, expect, it } from "vitest";

import {
  decodeListCursor,
  encodeListCursor,
  nextListCursorFromPage,
  resolveListPageLimit,
} from "~/lib/list-pagination";

describe("list-pagination", () => {
  it("clamps page limits into a safe D1 range", () => {
    expect(resolveListPageLimit(undefined)).toBe(100);
    expect(resolveListPageLimit(0)).toBe(1);
    expect(resolveListPageLimit(9999)).toBe(500);
    expect(resolveListPageLimit(25, 50)).toBe(25);
  });

  it("round-trips keyset cursors", () => {
    const cursor = encodeListCursor("2026-07-13T00:00:00.000Z", "row-1");
    expect(decodeListCursor(cursor)).toEqual({
      sortValue: "2026-07-13T00:00:00.000Z",
      id: "row-1",
    });
    expect(decodeListCursor("not-a-cursor")).toBeNull();
  });

  it("only emits a next cursor when a page is full", () => {
    const items = [
      { id: "a", updatedAt: "2026-07-13T01:00:00.000Z" },
      { id: "b", updatedAt: "2026-07-13T00:00:00.000Z" },
    ];
    expect(
      nextListCursorFromPage(items, 2, (item) => item.updatedAt, (item) => item.id),
    ).toBe(encodeListCursor("2026-07-13T00:00:00.000Z", "b"));
    expect(
      nextListCursorFromPage(items, 3, (item) => item.updatedAt, (item) => item.id),
    ).toBeNull();
  });
});
