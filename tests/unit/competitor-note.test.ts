import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorNote } from "../../app/components/competitor-note";

function render(note: string, error: string | null, saved = false): string {
  const Stub = createRoutesStub([
    { path: "/", Component: () => createElement(CompetitorNote, { note, error, saved }) },
  ]);
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

  it("says Saved. after a save and not before", () => {
    expect(render("x", null, true)).toContain(">Saved.<");
    expect(render("x", null)).not.toContain("Saved.");
  });

  it("shows the refusal and not Saved. when the save was refused", () => {
    const html = render("x", "Too long.", true);
    expect(html).toContain("Too long.");
    expect(html).not.toContain("Saved.");
  });
});
