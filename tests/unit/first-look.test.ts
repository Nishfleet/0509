import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FirstLook } from "../../app/components/first-look";
import { firstLookRows } from "../../app/lib/first-look";

const NOW = new Date("2026-10-14T12:00:00.000Z");

describe("first look", () => {
  it("says what has been read and how long ago, or that it is still reading", () => {
    const rows = firstLookRows(
      [
        { id: "a", name: "Acme", pages: 3, checkedAt: "2026-10-14T11:48:00.000Z", unreadable: false },
        { id: "b", name: "Beta", pages: 1, checkedAt: "2026-10-14T09:00:00.000Z", unreadable: false },
        { id: "c", name: "Gamma", pages: 0, checkedAt: null, unreadable: false },
        { id: "d", name: "Delta", pages: 0, checkedAt: null, unreadable: true },
      ],
      NOW,
    );
    expect(rows.map((row) => row.line)).toEqual([
      "Read 3 pages, 12m ago",
      "Read 1 page, 3h ago",
      "Reading its site now",
      "We couldn't read their website. We keep trying.",
    ]);
  });

  it("lists every rival under a heading, and nothing when there are none", () => {
    const html = renderToStaticMarkup(
      createElement(FirstLook, { rivals: [{ id: "a", name: "Acme", line: "Read 3 pages, 12m ago" }] }),
    );
    expect(html).toContain("Where your competitors stand today");
    expect(html).toContain("Acme");
    expect(html).toContain("Read 3 pages, 12m ago");
    expect(renderToStaticMarkup(createElement(FirstLook, { rivals: [] }))).toBe("");
  });
});
