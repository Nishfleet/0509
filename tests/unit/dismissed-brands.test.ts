import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactRouterModule from "react-router";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { DismissedSuggestion } from "../../app/components/dismissed-brands";
import { DismissedBrands } from "../../app/components/dismissed-brands";

const kindred: DismissedSuggestion = {
  suggestionId: "sug-dismissed-kindred",
  name: "Kindred",
  domain: "kindred.example",
  dismissedAt: "2026-09-20T09:14:00.000Z",
};

const casetta: DismissedSuggestion = {
  suggestionId: "sug-dismissed-casetta",
  name: "Casetta",
  domain: "casetta.example",
  dismissedAt: "2026-09-21T16:40:00.000Z",
};

const ROUTE_ID = "settings";
const FETCHER_KEY = "restore-kindred";

// Every row calls useFetcher, and a fetcher's key is React's own useId unless
// the caller names it. The rows are rendered inside a real memory router below,
// and these tests name the fetcher so one of them can fetch through the router
// and land in the submitting state a real click produces. useFetcher({ key })
// is the public API for a fetcher the caller addresses.
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return { ...actual, useFetcher: () => actual.useFetcher({ key: FETCHER_KEY }) };
});

// A route action that never settles, so the restore stays in flight for the
// whole render, the way a request the server has not answered yet does.
const NEVER = () => new Promise(() => undefined);

function screen(dismissed: readonly DismissedSuggestion[]): ReactElement {
  return createElement(DismissedBrands, { dismissed });
}

function render(dismissed: readonly DismissedSuggestion[]): string {
  const router = createMemoryRouter([{ id: ROUTE_ID, path: "/", Component: () => screen(dismissed), action: NEVER }], {
    initialEntries: ["/"],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

// The same row and the same router, with the restore post already in flight on
// the row's own fetcher: this is the render the browser makes while the
// request runs, which is what a document-reloading form never showed.
function renderWhileRestoring(): string {
  const router = createMemoryRouter([{ id: ROUTE_ID, path: "/", Component: () => screen([kindred]), action: NEVER }], {
    initialEntries: ["/"],
  });
  const formData = new FormData();
  formData.set("intent", "restore-suggestion");
  formData.set("suggestionId", "sug-dismissed-kindred");
  void router.fetch(FETCHER_KEY, ROUTE_ID, "/", { formMethod: "post", formData });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

// The opening tag and the text between the tags: the class list holds
// "disabled:" utilities, so the pair is what tells a disabled button apart.
function buttonWith(html: string, name: string): string {
  const start = html.indexOf(`aria-label="Bring back ${name}"`);
  if (start < 0) throw new Error(`no bring back button for ${name}`);
  const open = html.lastIndexOf("<button", start);
  const close = html.indexOf("</button>", start);
  return html.slice(open, close + "</button>".length);
}

function rowHtml(html: string, suggestionId: string): string {
  const start = html.indexOf(`value="${suggestionId}"`);
  if (start < 0) throw new Error(`row not found for ${suggestionId}`);
  const liOpen = html.lastIndexOf("<li", start);
  const liClose = html.indexOf("</li>", start);
  if (liOpen < 0 || liClose < 0) throw new Error(`row bounds not found for ${suggestionId}`);
  return html.slice(liOpen, liClose + "</li>".length);
}

describe("the dismissed brands list", () => {
  it("renders nothing when no brand has been dismissed", () => {
    expect(renderToStaticMarkup(createElement(DismissedBrands, { dismissed: [] }))).toBe("");
  });

  it("names itself and lists both brands with their domains", () => {
    const html = render([casetta, kindred]);

    expect(html).toContain("Competitors you dismissed");
    expect(html).toContain("Kindred");
    expect(html).toContain("kindred.example");
    expect(html).toContain("Casetta");
    expect(html).toContain("casetta.example");
    expect(html).toContain("Dismissed 2026-09-20");
  });

  it("shows the count in the heading", () => {
    expect(render([casetta, kindred])).toContain("Competitors you dismissed (2)");
    expect(render([kindred])).toContain("Competitors you dismissed (1)");
  });

  it("posts the restore intent with each brand's own suggestion id", () => {
    const html = render([casetta, kindred]);

    expect(html.match(/name="intent" value="restore-suggestion"/g)).toHaveLength(2);
    expect(html).toContain('value="sug-dismissed-kindred"');
    expect(html).toContain('value="sug-dismissed-casetta"');
  });

  it("names each bring back button after its brand", () => {
    const html = render([casetta, kindred]);

    expect(html).toContain('aria-label="Bring back Kindred"');
    expect(html).toContain('aria-label="Bring back Casetta"');
  });

  it("emits Dismissed <day> as a single text node so a screen reader does not hear two parts", () => {
    const html = render([casetta, kindred]);
    const row = rowHtml(html, "sug-dismissed-kindred");

    const nodes = row.match(/>\s*Dismissed\s+2026-09-20\s*</g) ?? [];
    expect(nodes).toHaveLength(1);

    expect(row).not.toMatch(/>\s*Dismissed\s*</);
    expect(row).not.toMatch(/>\s*2026-09-20\s*</);
  });

  it("leaves the bring back button enabled and at rest while nothing is in flight", () => {
    const button = buttonWith(render([kindred]), "Kindred");

    expect(button).toContain(">Bring back</button>");
    expect(button).not.toContain("Bringing back…");
    expect(button).not.toContain('disabled=""');
  });

  it("keeps the restore intent and its own suggestion id while the restore runs", () => {
    const row = rowHtml(renderWhileRestoring(), "sug-dismissed-kindred");

    expect(row).toContain('value="restore-suggestion"');
    expect(row).toContain('value="sug-dismissed-kindred"');
  });

  it("disables the bring back button and reads Bringing back… while the restore runs", () => {
    const button = buttonWith(renderWhileRestoring(), "Kindred");

    expect(button).toContain('disabled=""');
    expect(button).toContain("Bringing back…");
    expect(button).not.toContain(">Bring back</button>");
  });
});
