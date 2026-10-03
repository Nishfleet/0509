import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorSite } from "../../app/components/competitor-site";
import { CompetitorYoutube } from "../../app/components/competitor-youtube";

// CompetitorSite and CompetitorYoutube are address fields. On a phone their
// native keyboard otherwise capitalises the first letter, autocorrects the
// handle in a YouTube link, and shows "return" on a field that submits on
// Enter, so the rendered <Input> must carry the full set of mobile hints the
// sibling inputs (app/components/one-input.tsx, app/components/competitor-maybes.tsx)
// already use.
const NEVER = () => new Promise(() => undefined);

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

// renderToStaticMarkup writes React's camelCase prop names into the markup,
// so the hints are asserted as spellCheck/enterKeyHint, the way tests/unit/
// one-input.test.ts asserts them for the sibling input.
const HINTS = [
  'autoCapitalize="none"',
  'autoCorrect="off"',
  'spellCheck="false"',
  'enterKeyHint="go"',
];

describe("CompetitorSite mobile keyboard hints", () => {
  it("adds the full set of phone hints to the website input", () => {
    const html = render(createElement(CompetitorSite, { url: null, error: null }));
    const field = input(html, "competitor-site-url");
    for (const hint of HINTS) {
      expect(field).toContain(hint);
    }
  });

  it("keeps the hints present even when there is an error", () => {
    const html = render(createElement(CompetitorSite, { url: null, error: "bad" }));
    const field = input(html, "competitor-site-url");
    for (const hint of HINTS) {
      expect(field).toContain(hint);
    }
  });
});

describe("CompetitorYoutube mobile keyboard hints", () => {
  it("adds the full set of phone hints to the channel link input", () => {
    const html = render(
      createElement(CompetitorYoutube, { url: null, error: null }),
    );
    const field = input(html, "competitor-youtube-url");
    for (const hint of HINTS) {
      expect(field).toContain(hint);
    }
  });

  it("keeps the hints present even when there is an error", () => {
    const html = render(createElement(CompetitorYoutube, { url: null, error: "bad" }));
    const field = input(html, "competitor-youtube-url");
    for (const hint of HINTS) {
      expect(field).toContain(hint);
    }
  });
});
