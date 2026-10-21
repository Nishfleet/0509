import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AddCompetitor, CompetitorMaybes } from "../../app/components/competitor-maybes";

const NOTICE = "Switch one off to add another.";
const MAYBES = [
  { suggestionId: "sug-a", name: "Acme", domain: "acme.example", reason: null },
  { suggestionId: "sug-b", name: "Beta", domain: "beta.example", reason: "same buyer" },
];

function render(element: ReactElement): string {
  const router = createMemoryRouter([{ path: "/app/competitors", element }], {
    initialEntries: ["/app/competitors"],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function button(html: string, pattern: RegExp): string {
  const found = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((tag) => pattern.test(tag));
  if (found === undefined) throw new Error(`no button matching ${String(pattern)}`);
  return found;
}

describe("the Add a competitor field when the plan is full", () => {
  it("says to switch one off above the field and marks Add aria-disabled", () => {
    const html = render(createElement(AddCompetitor, { message: null, planFull: true }));
    expect(html).toContain(NOTICE);
    expect(html.indexOf(NOTICE)).toBeLessThan(html.indexOf('id="add-competitor"'));
    expect(button(html, />Add</)).toContain('aria-disabled="true"');
  });

  it("shows no notice and leaves Add enabled while there is room", () => {
    const html = render(createElement(AddCompetitor, { message: null, planFull: false }));
    expect(html).not.toContain(NOTICE);
    expect(button(html, />Add</)).not.toContain("aria-disabled");
    expect(render(createElement(AddCompetitor, { message: null }))).not.toContain(NOTICE);
  });
});

describe("the Possible competitors Watch buttons when the plan is full", () => {
  it("says to switch one off above the list and marks every Watch aria-disabled but not Dismiss", () => {
    const html = render(createElement(CompetitorMaybes, { maybes: MAYBES, planFull: true }));
    expect(html).toContain(NOTICE);
    expect(html.indexOf(NOTICE)).toBeLessThan(html.indexOf("Acme"));
    for (const name of ["Acme", "Beta"]) {
      expect(button(html, new RegExp(`aria-label="Watch ${name}"`))).toContain('aria-disabled="true"');
      expect(button(html, new RegExp(`aria-label="Dismiss ${name}"`))).not.toContain("aria-disabled");
    }
  });

  it("shows no notice and leaves Watch enabled while there is room", () => {
    const html = render(createElement(CompetitorMaybes, { maybes: MAYBES, planFull: false }));
    expect(html).not.toContain(NOTICE);
    expect(button(html, /aria-label="Watch Acme"/)).not.toContain("aria-disabled");
  });
});
