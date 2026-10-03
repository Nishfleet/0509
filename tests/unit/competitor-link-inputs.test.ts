import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorSite } from "../../app/components/competitor-site";
import { CompetitorYoutube } from "../../app/components/competitor-youtube";

// Both are address fields, so a phone keyboard would otherwise capitalise the
// first letter of the domain and autocorrect the handle of a YouTube link. The
// sibling address inputs already carry the four hints
// (app/components/one-input.tsx:33-36, app/components/competitor-maybes.tsx:97-100).
// renderToStaticMarkup writes React's camelCase prop names into the markup, so
// the hints are asserted as spellCheck/enterKeyHint, the way tests/unit/
// one-input.test.ts asserts them for the sibling input.
const NEVER = () => new Promise(() => undefined);

const HINTS = ['autoCapitalize="none"', 'autoCorrect="off"', 'spellCheck="false"', 'enterKeyHint="go"'];

function render(element: ReactElement): string {
  const router = createMemoryRouter(
    [
      { path: "/", element: createElement("div", null, "home") },
      { path: "/app/competitors", element, action: NEVER },
    ],
    { initialEntries: ["/app/competitors"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function input(html: string, id: string): string {
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  const found = inputs.find((tag) => tag.includes(`id="${id}"`));
  if (found === undefined) throw new Error(`no input with id="${id}" in the rendered form`);
  return found;
}

describe("the competitor address fields carry the mobile keyboard hints", () => {
  it("hints the another-website input", () => {
    const html = render(createElement(CompetitorSite, { url: null, error: null }));
    const field = input(html, "competitor-site-url");
    for (const hint of HINTS) {
      expect(field).toContain(hint);
    }
  });

  it("hints the YouTube channel input", () => {
    const html = render(createElement(CompetitorYoutube, { url: null, error: null }));
    const field = input(html, "competitor-youtube-url");
    for (const hint of HINTS) {
      expect(field).toContain(hint);
    }
  });
});
