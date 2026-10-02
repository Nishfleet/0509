import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

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
const ROUTE_PATH = "/app/settings";

// The key each row gives its own fetcher. Nothing here mocks react-router:
// this is the key the component passes to useFetcher, so the row's own live
// fetcher is the one these tests submit through.
function restoreKeyFor(suggestionId: string): string {
  return `restore-${suggestionId}`;
}

// A route action that never settles, so a restore stays in flight for the
// whole render, the way a request the server has not answered yet does.
const NEVER = () => new Promise(() => undefined);

function screen(dismissed: readonly DismissedSuggestion[]): ReactElement {
  return createElement(DismissedBrands, { dismissed });
}

function render(dismissed: readonly DismissedSuggestion[]): string {
  const router = createMemoryRouter(
    [{ id: ROUTE_ID, path: ROUTE_PATH, Component: () => screen(dismissed), action: NEVER }],
    {
      initialEntries: [ROUTE_PATH],
    },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

// The same two rows on the same router, with Kindred's restore post already
// in flight on Kindred's own fetcher: this is the render the browser makes
// while the request runs, which is what a document-reloading form never showed.
async function renderWhileRestoring(): Promise<string> {
  const router = createMemoryRouter(
    [{ id: ROUTE_ID, path: ROUTE_PATH, Component: () => screen([casetta, kindred]), action: NEVER }],
    {
      initialEntries: [ROUTE_PATH],
    },
  );
  const formData = new FormData();
  formData.set("intent", "restore-suggestion");
  formData.set("suggestionId", "sug-dismissed-kindred");
  // Render only once the router has the post in flight, so a change in when
  // that state lands fails loudly here instead of flipping the assertions.
  const inFlight = new Promise<void>((resolve) => {
    router.subscribe((state) => {
      if (state.fetchers.get(restoreKeyFor(kindred.suggestionId))?.state === "submitting") resolve();
    });
  });
  void router.fetch(restoreKeyFor(kindred.suggestionId), ROUTE_ID, ROUTE_PATH, { formMethod: "post", formData });
  await inFlight;
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function rowHtml(html: string, suggestionId: string): string {
  const start = html.indexOf(`value="${suggestionId}"`);
  if (start < 0) throw new Error(`row not found for ${suggestionId}`);
  const liOpen = html.lastIndexOf("<li", start);
  const liClose = html.indexOf("</li>", start);
  if (liOpen < 0 || liClose < 0) throw new Error(`row bounds not found for ${suggestionId}`);
  return html.slice(liOpen, liClose + "</li>".length);
}

// The opening tag and the text between the tags: the class list also holds
// "disabled:" utilities, so the pair is what tells a disabled button apart.
function buttonWith(row: string, name: string): string {
  const labelled = row.indexOf(`aria-label="Bring back ${name}"`);
  if (labelled < 0) throw new Error(`no bring back button for ${name}`);
  const open = row.lastIndexOf("<button", labelled);
  const close = row.indexOf("</button>", labelled);
  if (open < 0 || close < 0) throw new Error(`button bounds not found for ${name}`);
  return row.slice(open, close + "</button>".length);
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
    const row = rowHtml(render([kindred]), "sug-dismissed-kindred");

    expect(buttonWith(row, "Kindred")).toContain(">Bring back</button>");
    expect(buttonWith(row, "Kindred")).not.toContain("Bringing back…");
    expect(buttonWith(row, "Kindred")).not.toContain('disabled=""');
  });

  it("posts to the settings route itself, the route that renders the list", () => {
    const row = rowHtml(render([kindred]), "sug-dismissed-kindred");

    expect(row).toContain(`action="${ROUTE_PATH}"`);
    expect(row).toContain('method="post"');
  });

  it("keeps the restore intent and its own suggestion id while the restore runs", async () => {
    const row = rowHtml(await renderWhileRestoring(), "sug-dismissed-kindred");

    expect(row).toContain('value="restore-suggestion"');
    expect(row).toContain('value="sug-dismissed-kindred"');
    expect(buttonWith(row, "Kindred")).toContain('disabled=""');
    expect(buttonWith(row, "Kindred")).toContain("Bringing back…");
    expect(buttonWith(row, "Kindred")).not.toContain(">Bring back</button>");
  });

  it("disables only the row being restored and leaves the other row's button ready", async () => {
    const row = rowHtml(await renderWhileRestoring(), "sug-dismissed-casetta");

    expect(buttonWith(row, "Casetta")).toContain(">Bring back</button>");
    expect(buttonWith(row, "Casetta")).not.toContain('disabled=""');
    expect(buttonWith(row, "Casetta")).not.toContain("Bringing back…");
  });
});
