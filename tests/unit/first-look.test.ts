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
        { id: "a", name: "Acme", pages: 3, checkedAt: "2026-10-14T11:48:00.000Z" },
        { id: "b", name: "Beta", pages: 1, checkedAt: "2026-10-14T09:00:00.000Z" },
        { id: "c", name: "Gamma", pages: 0, checkedAt: null },
      ],
      NOW,
    );
    expect(rows.map((row) => row.line)).toEqual([
      "Read 3 pages, 12m ago",
      "Read 1 page, 3h ago",
      "Reading its site now",
    ]);
  });

  it("lists every rival under a heading, and nothing when there are none", () => {
    const html = renderToStaticMarkup(
      createElement(FirstLook, { rivals: [{ id: "a", name: "Acme", line: "Read 3 pages, 12m ago" }] }),
    );
    expect(html).toContain("Where your rivals stand today");
    expect(html).toContain("Acme");
    expect(html).toContain("Read 3 pages, 12m ago");
    expect(renderToStaticMarkup(createElement(FirstLook, { rivals: [] }))).toBe("");
  });

  it("adds what is already held under a rival, and nothing for a rival with no facts", () => {
    const rows = firstLookRows(
      [
        { id: "a", name: "Acme", pages: 2, checkedAt: "2026-10-14T11:48:00.000Z" },
        { id: "b", name: "Beta", pages: 0, checkedAt: null },
      ],
      NOW,
      new Map([
        [
          "a",
          {
            description: "Lifting gear",
            pages: 2,
            reads: 2,
            firstReadAt: "2026-10-14T10:00:00Z",
            changes: 0,
            lastChangeAt: null,
            roles: ["pricing"],
            kinds: [],
            feed: null,
          },
        ],
      ]),
    );
    expect(rows[0]?.facts).toEqual(["In its own words: Lifting gear", "Found on its site: pricing page."]);
    expect(rows[1]?.facts).toBeUndefined();
    const html = renderToStaticMarkup(createElement(FirstLook, { rivals: rows }));
    expect(html).toContain("In its own words: Lifting gear");
  });
});
