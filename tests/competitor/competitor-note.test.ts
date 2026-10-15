import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorNote } from "../../app/components/competitor-note";

function render(error: string | null, saved: boolean): string {
  const Stub = createRoutesStub([
    { path: "/", Component: () => createElement(CompetitorNote, { note: "x", error, saved }) },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("the private note says when it saved", () => {
  it("shows Saved. after a save", () => {
    expect(render(null, true)).toContain(">Saved.<");
  });

  it("shows nothing before the first save", () => {
    expect(render(null, false)).not.toContain("Saved.");
  });

  it("shows the refusal and not Saved. when the save was refused", () => {
    const html = render("Too long.", true);
    expect(html).toContain("Too long.");
    expect(html).not.toContain("Saved.");
  });
});
