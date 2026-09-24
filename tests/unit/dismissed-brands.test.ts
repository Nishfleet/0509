import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

function render(dismissed: readonly DismissedSuggestion[]): string {
  return renderToStaticMarkup(createElement(DismissedBrands, { dismissed }));
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
    expect(render([])).toBe("");
  });

  it("names itself and lists both brands with their domains", () => {
    const html = render([casetta, kindred]);

    expect(html).toContain("Brands you dismissed");
    expect(html).toContain("Kindred");
    expect(html).toContain("kindred.example");
    expect(html).toContain("Casetta");
    expect(html).toContain("casetta.example");
    expect(html).toContain("Dismissed 2026-09-20");
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
});

