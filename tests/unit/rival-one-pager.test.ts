import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RivalOnePager } from "../../app/components/rival-one-pager";
import { rivalOnePager, type OnePagerInput } from "../../app/lib/rival-one-pager";

const INPUT: OnePagerInput = {
  name: "Acme",
  domain: "acme.com",
  pages: 3,
  lastChecked: "14 Oct, 03:10 UTC",
  changes: [
    {
      headline: "Acme changed its pricing page",
      url: "https://acme.com/pricing",
      when: "2 days ago",
      mark: { removed: "Pro $12 a month", added: "Pro $15 a month" },
    },
  ],
  moves: [{ kind: "hiring", title: "Head of Sales", url: "https://acme.com/jobs/1", when: "5 days ago" }],
};

describe("rival one-pager", () => {
  it("writes the rival, the last read, the changes with before and after, and other moves as plain text", () => {
    const text = rivalOnePager(INPUT);
    expect(text).toContain("Acme (acme.com)");
    expect(text).toContain("Last read 14 Oct, 03:10 UTC, 3 pages watched.");
    expect(text).toContain("- 2 days ago: Acme changed its pricing page");
    expect(text).toContain("  Before: Pro $12 a month");
    expect(text).toContain("  After: Pro $15 a month");
    expect(text).toContain("Careers page: Head of Sales");
    expect(text).toContain("https://acme.com/jobs/1");
    expect(text).not.toMatch(/<|&lt;/);
  });

  it("says plainly when nothing has been read or recorded", () => {
    const text = rivalOnePager({ ...INPUT, lastChecked: null, changes: [], moves: [] });
    expect(text).toContain("Not read yet.");
    expect(text.match(/None recorded yet\./g)).toHaveLength(2);
  });

  it("keeps the latest five of each", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      ...INPUT.changes[0],
      headline: `Change ${String(index)}`,
      when: "1 day ago",
    })) as unknown as OnePagerInput["changes"];
    const text = rivalOnePager({ ...INPUT, changes: many });
    expect(text).toContain("Change 4");
    expect(text).not.toContain("Change 5");
  });

  it("draws a copy button and no text until it is used", () => {
    const html = renderToStaticMarkup(createElement(RivalOnePager, INPUT));
    expect(html).toContain("Copy as a one-pager");
    expect(html).not.toContain("Pro $12 a month");
  });
});
