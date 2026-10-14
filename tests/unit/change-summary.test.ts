import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyChangeButton } from "../../app/components/copy-change-button";
import { changeSummary } from "../../app/lib/change-summary";

const CHANGE = {
  headline: "Acme changed its pricing page.",
  page: "Pricing page",
  mark: { removed: "Starter €40/mo", added: "Starter €46/mo" },
  when: "12 Oct 2026",
};

describe("changeSummary", () => {
  it("reads as one plain paragraph a colleague can paste: what changed, before, after, when", () => {
    expect(changeSummary(CHANGE)).toBe(
      "Acme changed its pricing page (Pricing page). Before: “Starter €40/mo”. After: “Starter €46/mo”. Seen 12 Oct 2026, via Five to Nine.",
    );
  });

  it("copes with a one-sided or missing mark", () => {
    expect(changeSummary({ ...CHANGE, mark: { removed: null, added: "Free tier" } })).toContain("After: “Free tier”.");
    expect(changeSummary({ ...CHANGE, mark: { removed: null, added: "Free tier" } })).not.toContain("Before:");
    expect(changeSummary({ ...CHANGE, mark: null })).toBe(
      "Acme changed its pricing page (Pricing page). Seen 12 Oct 2026, via Five to Nine.",
    );
  });

  it("flattens whitespace and shortens a long side", () => {
    const long = `${"word ".repeat(80)}\n\nend`;
    const text = changeSummary({ ...CHANGE, mark: { removed: long, added: "x" } });
    expect(text).not.toContain("\n");
    expect(text).toContain("…”.");
    expect(text.length).toBeLessThan(400);
  });

  it("strips bidi overrides and zero-width characters from rival text", () => {
    const text = changeSummary({ ...CHANGE, mark: { removed: "Pro \u202Eplan\u200B 40", added: "x\u0007y" } });
    expect(text).toContain("Before: “Pro plan 40”.");
    expect(text).toContain("After: “xy”.");
    expect(text).not.toMatch(/[\p{Cf}\p{Cc}]/u);
  });

  it("cuts on code points so an emoji at the cut is never split", () => {
    const long = `${"a".repeat(138)}😀😀😀`;
    const text = changeSummary({ ...CHANGE, mark: { removed: long, added: "x" } });
    expect(text).toContain(`${"a".repeat(138)}😀…”.`);
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("carries no link and nothing internal", () => {
    expect(changeSummary(CHANGE)).not.toMatch(/https?:|0509\.io|jev|p=/i);
  });
});

describe("CopyChangeButton", () => {
  it("offers a copy button", () => {
    const html = renderToStaticMarkup(createElement(CopyChangeButton, { change: CHANGE }));
    expect(html).toContain("Copy for the team");
    expect(html).not.toContain("Copy failed");
  });
});
