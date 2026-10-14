import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorNote } from "../../app/components/competitor-note";

function render(note: string, error: string | null): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => createElement(CompetitorNote, { note, error }) }]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("competitor note", () => {
  it("shows the saved note, says it is private, and posts the note intent", () => {
    const html = render("Discounts every Q4", null);
    expect(html).toContain("Discounts every Q4");
    expect(html).toContain("never emailed");
    expect(html).toContain('name="intent" value="note"');
  });

  it("announces a refusal", () => {
    expect(render("", "Keep it under 2000 characters.")).toContain('role="alert"');
  });
});
