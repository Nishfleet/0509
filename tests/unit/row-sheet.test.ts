import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RowExpansion, rowPanelClass, rowSheetPopupClass } from "../../app/components/row-sheet";

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("the row expansion", () => {
  it("slides the phone sheet up and down without scale or bounce", () => {
    for (const token of [
      "h-[85dvh]",
      "border-t",
      "border-ink",
      "duration-sheet-up",
      "data-[ending-style]:duration-sheet-down",
      "ease-push",
      "motion-reduce:transition-none",
      "bottom-0",
    ]) {
      expect(rowSheetPopupClass).toContain(token);
    }
    expect(rowSheetPopupClass).not.toContain("scale");
    expect(rowSheetPopupClass).not.toContain("bounce");
  });

  it("marks an in-place expansion with a green bar that respects reduced motion", () => {
    for (const token of [
      "border-l-4",
      "border-green",
      "duration-row",
      "motion-reduce:transition-none",
    ]) {
      expect(rowPanelClass).toContain(token);
    }
  });

  it("expands in place on the server, which is not a phone", () => {
    const html = render(
      createElement(
        RowExpansion,
        { title: "Kindred", summary: "Kindred", defaultOpen: true },
        "detail",
      ),
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-slot="row-panel"');
    expect(html).toContain("detail");
    expect(html).not.toContain('data-slot="row-sheet"');
  });

  it("stays closed when defaultOpen is omitted", () => {
    const html = render(
      createElement(RowExpansion, { title: "Kindred", summary: "Kindred" }, "detail"),
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-slot="row-panel"');
  });
});
