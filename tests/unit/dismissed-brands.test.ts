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
});
